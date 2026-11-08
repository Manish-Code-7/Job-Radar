import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PoliteFetcher, type HttpClient, type HttpRequest, type HttpResponse } from "../../src/fetch";

export const fixture = (name: string) => readFileSync(join(__dirname, "..", "fixtures", name), "utf8");

export type Route = [RegExp, (req: HttpRequest) => Partial<HttpResponse> & { status?: number }];

/** HttpClient that answers from a route table and records every request. */
export function fakeHttp(routes: Route[]) {
  const calls: HttpRequest[] = [];
  const client: HttpClient = {
    async request(req) {
      calls.push(req);
      for (const [re, fn] of routes) {
        if (re.test(req.url)) {
          const r = fn(req);
          return { status: r.status ?? 200, url: r.url ?? req.url, headers: r.headers ?? {}, body: r.body ?? "" };
        }
      }
      return { status: 404, url: req.url, headers: {}, body: "not found" };
    },
  };
  return { client, calls };
}

export function politeFor(client: HttpClient, extra: Partial<ConstructorParameters<typeof PoliteFetcher>[0]> = {}) {
  return new PoliteFetcher({
    http: client,
    contactUrl: "https://example.com/bot",
    minDelayMs: 0,
    maxDelayMs: 0,
    baseBackoffMs: 0,
    respectRobots: false,
    sleep: async () => {},
    ...extra,
  });
}

export const json = (name: string) => () => ({ body: fixture(name), headers: { "content-type": "application/json" } });
