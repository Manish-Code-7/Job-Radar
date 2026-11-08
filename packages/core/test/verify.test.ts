import { describe, expect, it } from "vitest";
import type { BrowserDriver } from "../src/browser";
import { BudgetRouter, MemoryLedger, Priority } from "../src/budget";
import type { FirecrawlLike } from "../src/budget/providers";
import {
  analyzePage,
  decideVerdict,
  displayBadge,
  httpProbe,
  identityCheck,
  isMetadataOnly,
  shouldArchive,
  verifyJob,
  type S2,
  type S3,
  type Signals,
} from "../src/verify";
import { fakeHttp, fixture, politeFor } from "./helpers/fake";

const T0 = "2026-11-08T00:00:00.000Z";
const T6 = "2026-11-08T06:00:00.000Z";
const T3 = "2026-11-08T03:00:00.000Z";

const s2 = (o: Partial<S2>): S2 => ({ outcome: "ok", chain: [], at: T6, ...o });
const s3 = (o: Partial<S3>): S3 => ({ outcome: "ok", via: "playwright", at: T6, ...o });
const pass = { pass: true, companyOk: true, locationOk: true, hostOk: true, reasons: [] };

describe("required verdict cases", () => {
  it("Greenhouse redirect to board ?error=true → closed", async () => {
    const { client } = fakeHttp([
      [/groww\/jobs\/4970739101/, () => ({ status: 302, headers: { location: "https://job-boards.greenhouse.io/groww?error=true" } })],
      [/groww\?error=true/, () => ({ status: 200, body: "<html><h1>Groww</h1><a href='/groww/jobs/1'>x</a></html>" })],
    ]);
    const p = await httpProbe("https://job-boards.greenhouse.io/groww/jobs/4970739101", politeFor(client));
    expect(p.s2).toMatchObject({ outcome: "closed", closedStrength: "definitive" });
    expect(p.s2.chain.map((c) => c.status)).toEqual([302, 200]);
    expect(decideVerdict({ s2: p.s2 }).verdict).toBe("closed");
  });

  it("Ashby metadata-only HTML → unknown (then S3 decides)", async () => {
    const html = fixture("page-ashby.html");
    expect(isMetadataOnly(html)).toBe(true);
    const { client } = fakeHttp([[/jobs\.ashbyhq\.com/, () => ({ body: html })]]);
    const p = await httpProbe("https://jobs.ashbyhq.com/sarvam/c0406fe0-c8c0-44aa-aa3e-b879f2bf1049", politeFor(client));
    expect(p.s2.outcome).toBe("needs_render");
    expect(decideVerdict({ s2: p.s2 }).verdict).toBe("unknown");
    // …and when the rendered check finds a real posting with Apply + identity pass → open
    const s: Signals = { s2: p.s2, s3: s3({ pageType: "job_posting", hasApply: true }), s4: pass };
    expect(decideVerdict(s).verdict).toBe("open");
  });

  it("Workday 403 → unknown", async () => {
    const { client } = fakeHttp([[/myworkdayjobs/, () => ({ status: 403, headers: { server: "cloudflare" }, body: "Just a moment..." })]]);
    const p = await httpProbe("https://x.wd5.myworkdayjobs.com/External/job/India/SE_R123", politeFor(client));
    expect(p.s2.outcome).toBe("error");
    expect(decideVerdict({ s2: p.s2 }).verdict).toBe("unknown");
  });

  it('title drift ("Associate SDE" → "Associate SDE Intern") → changed', () => {
    const s4 = identityCheck(
      { title: "Associate SDE", companyNames: ["Acme"], locations: ["Bengaluru"], companyDomains: ["acme.com"] },
      { title: "Associate SDE Intern", locations: ["Bengaluru"], finalUrl: "https://jobs.lever.co/acme/x" },
    );
    expect(s4.pass).toBe(false);
    const s1 = { snapshotOk: true, complete: true, present: true, at: T6 };
    expect(decideVerdict({ s1, s4 }).verdict).toBe("changed");
  });

  it("single 500 → unknown", async () => {
    const { client } = fakeHttp([[/acme/, () => ({ status: 500 })]]);
    const p = await httpProbe("https://careers.acme.com/jobs/12345", politeFor(client, { maxRetries: 0 }));
    expect(p.s2.outcome).toBe("error");
    expect(decideVerdict({ s2: p.s2 }).verdict).toBe("unknown");
  });

  it("two closed checks 6h apart → closed (but 3h apart → unknown)", () => {
    const now = { s2: s2({ outcome: "closed", closedReason: "HTTP 404", closedStrength: "soft", at: T6 }) };
    expect(decideVerdict(now, []).verdict).toBe("unknown");
    expect(decideVerdict(now, [{ at: T3, reason: "HTTP 404" }]).verdict).toBe("unknown");
    expect(decideVerdict(now, [{ at: T0, reason: "HTTP 404" }]).verdict).toBe("closed");
  });
});

describe("verdict rules", () => {
  it("S1 missing from a complete snapshot → closed; from a partial snapshot → not closed", () => {
    expect(decideVerdict({ s1: { snapshotOk: true, complete: true, present: false, at: T0 } }).verdict).toBe("closed");
    expect(decideVerdict({ s1: { snapshotOk: true, complete: false, present: false, at: T0 } }).verdict).toBe("unknown");
    expect(decideVerdict({ s1: { snapshotOk: false, complete: true, present: false, at: T0 } }).verdict).toBe("unknown");
  });
  it("S1 present → open", () => {
    expect(decideVerdict({ s1: { snapshotOk: true, complete: false, present: true, at: T0 } }).verdict).toBe("open");
  });
  it("job_posting without Apply is never open", () => {
    expect(decideVerdict({ s2: s2({}), s3: s3({ pageType: "job_posting", hasApply: false }), s4: pass }).verdict).toBe("unknown");
  });
  it("a job list page is never open", () => {
    expect(decideVerdict({ s2: s2({}), s3: s3({ pageType: "job_list", hasApply: true }), s4: pass }).verdict).toBe("unknown");
  });
});

describe("page analysis", () => {
  it("real Greenhouse posting page → job_posting with Apply", () => {
    const a = analyzePage(fixture("page-greenhouse-open.html"), "https://job-boards.eu.greenhouse.io/groww/jobs/4970739101");
    expect(a.pageType).toBe("job_posting");
    expect(a.hasApply).toBe(true);
    expect(a.extracted.title).toBeTruthy();
  });
  it("synthetic JSON-LD page", () => {
    const a = analyzePage(fixture("page-jsonld.html"), "https://careers.acme.in/jobs/12345/x");
    expect(a).toMatchObject({ pageType: "job_posting", hasApply: true, extracted: { title: "Associate Software Engineer", company: "Acme Technologies" } });
  });
  it("closed text in headline", () => {
    const a = analyzePage("<html><title>Acme</title><h1>This position has been filled</h1></html>", "https://acme.com/jobs/1");
    expect(a.closedReason).toMatch(/position has been filled/);
  });
  it("'expired' deep in a long body is not a closure", () => {
    const body = "<p>" + "We build great things. ".repeat(200) + "Your passport must not be expired.</p>";
    expect(analyzePage(`<html><h1>Backend Engineer</h1>${body}</html>`, "https://acme.com/jobs/1").closedReason).toBeUndefined();
  });
  it("validThrough in the past → closed", () => {
    const html = fixture("page-jsonld.html").replace("2027-01-31", "2026-01-31");
    expect(analyzePage(html, "https://careers.acme.in/jobs/12345/x").closedReason).toMatch(/validThrough/);
  });
});

describe("identity", () => {
  const exp = { title: "Associate Software Engineer", companyNames: ["Acme"], locations: ["Bengaluru, India"], companyDomains: ["acme.com"] };
  it("passes on same job", () =>
    expect(identityCheck(exp, { title: "Associate Software Engineer", company: "Acme Technologies", locations: ["Bengaluru"], finalUrl: "https://careers.acme.com/j/1" }).pass).toBe(true));
  it("fails on foreign host", () =>
    expect(identityCheck(exp, { title: "Associate Software Engineer", locations: [], finalUrl: "https://www.naukri.com/job/1" }).hostOk).toBe(false));
  it("ignores label-only 'locations' scraped by selectors", () =>
    expect(identityCheck(exp, { title: "Associate Software Engineer", locations: ["Location (City) *"], finalUrl: "https://acme.com/j/1" }).pass).toBe(true));
  it("noisy page company name is fine on an allowlisted host, not elsewhere", () => {
    expect(identityCheck(exp, { title: "Associate Software Engineer", company: "JPMC Candidate Experience page", locations: [], finalUrl: "https://acme.com/j/1" }).pass).toBe(true);
    expect(identityCheck(exp, { title: "Associate Software Engineer", company: "Other Corp", locations: [], finalUrl: "https://elsewhere.io/j/1" }).companyOk).toBe(false);
  });
  it("stored 'India' matches a page saying 'Bengaluru, India'", () =>
    expect(identityCheck({ ...exp, locations: ["3 Locations", "India"] }, { title: "Associate Software Engineer", locations: ["India, Bengaluru, India"], finalUrl: "https://acme.com/j/1" }).pass).toBe(true));
  it("generic page heading is inconclusive, not a change", () => {
    const s4 = identityCheck(exp, { title: "CAREERS AT NVIDIA", locations: [], finalUrl: "https://acme.com/j/1" });
    expect(s4).toMatchObject({ pass: false, inconclusive: true });
    expect(decideVerdict({ s2: s2({}), s3: s3({ pageType: "job_posting", hasApply: true }), s4 }).verdict).toBe("unknown");
  });
  it("fails on location mismatch", () =>
    expect(identityCheck(exp, { title: "Associate Software Engineer", locations: ["London, UK"], finalUrl: "https://acme.com/j/1" }).locationOk).toBe(false));
});

describe("display", () => {
  const now = new Date("2026-11-08T12:00:00Z");
  const h = (n: number) => new Date(now.getTime() - n * 3600_000);
  it("badges", () => {
    expect(displayBadge("open", h(10), now)).toEqual({ badge: "verified", hoursAgo: 10 });
    expect(displayBadge("open", h(40), now).badge).toBe("rechecking");
    expect(displayBadge("open", h(80), now).badge).toBe("hidden");
    expect(displayBadge("unknown", h(1), now).badge).toBe("hidden");
  });
  it("archive at 21 days", () => {
    expect(shouldArchive({ status: "closed", closedAt: h(21 * 24), firstSeenAt: h(900) }, now)).toBe(true);
    expect(shouldArchive({ status: "closed", closedAt: h(20 * 24), firstSeenAt: h(900) }, now)).toBe(false);
  });
});

describe("verifyJob escalation", () => {
  const job = {
    url: "https://jobs.ashbyhq.com/acme/c0406fe0-c8c0-44aa-aa3e-b879f2bf1049",
    title: "Associate Software Engineer",
    locations: ["Bengaluru"],
    company: { name: "Acme", domain: "acme.com" },
    priority: Priority.ShownJobVerify,
  };
  const shell = () => ({ body: fixture("page-ashby.html") });
  const posting = fixture("page-jsonld.html");

  it("S1 present: no page fetch at all", async () => {
    const { client, calls } = fakeHttp([]);
    const r = await verifyJob(job, { http: politeFor(client), workerName: "oracle" }, { s1: { snapshotOk: true, complete: true, present: true, feedTitle: job.title, at: T0 } });
    expect(r.verdict).toBe("open");
    expect(calls).toHaveLength(0);
  });

  it("metadata-only → own Playwright renders → open", async () => {
    const { client } = fakeHttp([[/ashbyhq/, shell]]);
    const browser: BrowserDriver = {
      render: async (url) => ({ requestedUrl: url, finalUrl: url, status: 200, html: posting, text: "", title: "", links: [], requestUrls: [], frameUrls: [], json: [] }),
      applyProbe: async () => ({ outcome: "form" }),
    };
    const r = await verifyJob(job, { http: politeFor(client), browser, workerName: "oracle" });
    expect(r.verdict).toBe("open");
    expect(r.signals.s3?.via).toBe("playwright");
  });

  it("browser blocked + Firecrawl out of credits → falls back to Jina", async () => {
    const { client } = fakeHttp([[/ashbyhq/, shell]]);
    const { client: jinaClient } = fakeHttp([
      [/r\.jina\.ai/, () => ({ body: `Title: Associate Software Engineer\nURL Source: ${job.url}\n\nMarkdown Content:\n# Associate Software Engineer\n\n${"Build things. ".repeat(60)}\n\n[Apply for this Job](${job.url}/application)` })],
    ]);
    const browser: BrowserDriver = {
      render: async (url) => ({ requestedUrl: url, finalUrl: url, status: 403, html: "", text: "", title: "", links: [], requestUrls: [], frameUrls: [], json: [] }),
      applyProbe: async () => ({ outcome: "error" }),
    };
    const ledger = new MemoryLedger();
    const now = new Date("2026-11-20T06:00:00Z");
    ledger.entries.push({ provider: "firecrawl", at: new Date("2026-11-05T00:00:00Z"), units: 1000, task: "x" });
    const router = new BudgetRouter({ caps: { firecrawl: 1000, apify: 5 } }, ledger, { now: () => now });
    let firecrawlCalls = 0;
    const firecrawl: FirecrawlLike = { scrape: async () => (firecrawlCalls++, { rawHtml: posting }) };
    const r = await verifyJob(job, { http: politeFor(client), browser, router, firecrawl, jinaHttp: politeFor(jinaClient), workerName: "oracle" });
    expect(firecrawlCalls).toBe(0);
    expect(r.attempts.map((a) => `${a.step}:${a.outcome}`)).toEqual(["http:ok", "playwright:null", "firecrawl:denied", "jina:ok"]);
    expect(r.signals.s3?.via).toBe("jina");
    expect(r.worker).toBe("fallback");
    expect(r.verdict).toBe("open");
  });

  it("everything exhausted → unknown, never closed", async () => {
    const { client } = fakeHttp([[/ashbyhq/, () => ({ status: 503 })]]);
    const r = await verifyJob(job, { http: politeFor(client, { maxRetries: 0 }), workerName: "oracle" });
    expect(r.verdict).toBe("unknown");
  });
});
