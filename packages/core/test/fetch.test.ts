import { describe, expect, it } from "vitest";
import { FetchError, parseRetryAfter, parseRobots, PoliteFetcher } from "../src/fetch";
import { fakeHttp } from "./helpers/fake";

function clocked(routes: Parameters<typeof fakeHttp>[0], opts: Partial<ConstructorParameters<typeof PoliteFetcher>[0]> = {}) {
  let t = 1_000_000;
  const sleeps: number[] = [];
  const { client, calls } = fakeHttp(routes);
  const f = new PoliteFetcher({
    http: client,
    contactUrl: "https://jobradar.example/bot",
    now: () => t,
    sleep: async (ms) => {
      sleeps.push(ms);
      t += ms;
    },
    random: () => 0.5,
    ...opts,
  });
  return { f, calls, sleeps, advance: (ms: number) => (t += ms) };
}

describe("robots.txt", () => {
  const txt = `User-agent: *\nDisallow: /private\nAllow: /private/jobs\nDisallow: /*.pdf$\n\nUser-agent: JobRadarBot\nDisallow: /search\nCrawl-delay: 4`;
  it("uses the most specific group", () => {
    const r = parseRobots(txt, "JobRadarBot/1.0 (+x)");
    expect(r.isAllowed("/search?q=1")).toBe(false);
    expect(r.isAllowed("/private")).toBe(true); // our group doesn't disallow it
    expect(r.crawlDelaySec).toBe(4);
  });
  it("longest match, allow wins ties, wildcards", () => {
    const r = parseRobots(txt, "OtherBot");
    expect(r.isAllowed("/private/x")).toBe(false);
    expect(r.isAllowed("/private/jobs/1")).toBe(true);
    expect(r.isAllowed("/a/b.pdf")).toBe(false);
    expect(r.isAllowed("/a/b.pdf?x")).toBe(true);
  });
  it("is enforced and cached for 24h", async () => {
    const { f, calls } = clocked([
      [/robots\.txt/, () => ({ body: "User-agent: *\nDisallow: /secret" })],
      [/./, () => ({ body: "ok" })],
    ], { minDelayMs: 0, maxDelayMs: 0 });
    await expect(f.fetch({ url: "https://a.com/secret/1" })).rejects.toMatchObject({ kind: "robots_disallowed" });
    await f.fetch({ url: "https://a.com/open" });
    expect(calls.filter((c) => c.url.endsWith("robots.txt"))).toHaveLength(1);
  });
});

describe("politeness", () => {
  it("one request at a time per domain with a 2–5 s gap", async () => {
    const { f, sleeps } = clocked([[/./, () => ({ body: "ok" })]], { respectRobots: false });
    await Promise.all([f.fetch({ url: "https://a.com/1" }), f.fetch({ url: "https://a.com/2" }), f.fetch({ url: "https://a.com/3" })]);
    // random 0.5 → 3500 ms gap between consecutive requests to a.com
    expect(sleeps).toEqual([3500, 3500]);
  });

  it("sends the bot User-Agent", async () => {
    const { f, calls } = clocked([[/./, () => ({ body: "ok" })]], { respectRobots: false });
    await f.fetch({ url: "https://a.com/1" });
    expect(calls[0]!.headers!["user-agent"]).toBe("JobRadarBot/1.0 (+https://jobradar.example/bot)");
  });

  it("honours Retry-After on 429 and retries", async () => {
    let n = 0;
    const { f, sleeps } = clocked([[/./, () => (n++ === 0 ? { status: 429, headers: { "retry-after": "30" } } : { body: "ok" })]], {
      respectRobots: false,
      minDelayMs: 0,
      maxDelayMs: 0,
    });
    const r = await f.fetch({ url: "https://a.com/x" });
    expect(r.status).toBe(200);
    expect(sleeps.some((s) => s >= 30_000)).toBe(true);
  });

  it("exponential backoff on 5xx, then a typed error", async () => {
    const { f, sleeps } = clocked([[/./, () => ({ status: 503 })]], { respectRobots: false, minDelayMs: 0, maxDelayMs: 0, maxRetries: 3, baseBackoffMs: 1000 });
    await expect(f.fetch({ url: "https://a.com/x" })).rejects.toBeInstanceOf(FetchError);
    expect(sleeps.filter((s) => s > 0)).toEqual([1000, 2000, 4000]);
  });

  it("Cloudflare challenge → 'blocked' without retries", async () => {
    const { f, calls } = clocked([[/./, () => ({ status: 403, headers: { server: "cloudflare" }, body: "Just a moment..." })]], { respectRobots: false, minDelayMs: 0, maxDelayMs: 0 });
    await expect(f.fetch({ url: "https://a.com/x" })).rejects.toMatchObject({ kind: "blocked", status: 403 });
    expect(calls).toHaveLength(1);
  });

  it("circuit breaker opens after repeated failures", async () => {
    const { f } = clocked([[/./, () => ({ status: 500 })]], { respectRobots: false, minDelayMs: 0, maxDelayMs: 0, maxRetries: 0, breakerThreshold: 2 });
    await expect(f.fetch({ url: "https://a.com/1" })).rejects.toMatchObject({ kind: "http" });
    await expect(f.fetch({ url: "https://a.com/2" })).rejects.toMatchObject({ kind: "http" });
    await expect(f.fetch({ url: "https://a.com/3" })).rejects.toMatchObject({ kind: "circuit_open" });
  });

  it("ETag revalidation returns the cached body on 304", async () => {
    let n = 0;
    const { f, calls } = clocked(
      [[/./, (req) => (n++ === 0 ? { body: "v1", headers: { etag: '"abc"' } } : req.headers?.["if-none-match"] === '"abc"' ? { status: 304 } : { body: "v2" })]],
      { respectRobots: false, minDelayMs: 0, maxDelayMs: 0 },
    );
    await f.fetch({ url: "https://a.com/feed" });
    const r = await f.fetch({ url: "https://a.com/feed" });
    expect(r.body).toBe("v1");
    expect(calls[1]!.headers!["if-none-match"]).toBe('"abc"');
  });

  it("parses Retry-After dates", () => {
    expect(parseRetryAfter("Wed, 21 Oct 2015 07:28:10 GMT", Date.parse("Wed, 21 Oct 2015 07:28:00 GMT"))).toBe(10_000);
  });
});
