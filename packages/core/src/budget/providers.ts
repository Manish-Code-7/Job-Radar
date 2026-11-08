import { FetchError } from "../fetch/http";
import type { PoliteFetcher } from "../fetch/polite";

/** What we need from Firecrawl. The worker implements it with @mendable/firecrawl-js. */
export interface FirecrawlScrape {
  markdown?: string;
  rawHtml?: string;
  links?: string[];
  json?: unknown;
  statusCode?: number;
  finalUrl?: string;
  creditsUsed?: number;
}
export interface FirecrawlLike {
  scrape(
    url: string,
    opts: { formats: ("markdown" | "rawHtml" | "links" | "json")[]; jsonSchema?: Record<string, unknown> },
  ): Promise<FirecrawlScrape>;
}

/** Credits per Firecrawl call (free plan): scrape/map = 1, JSON extraction = +4. */
export function firecrawlCost(formats: string[]): number {
  return 1 + (formats.includes("json") ? 4 : 0);
}

/** What we need from Apify. The worker implements it with apify-client. */
export interface ApifyAtsInput {
  queries: string[];
  location: string;
  keywords?: string[];
  postedWithinDays?: number;
  maxJobsPerCompany: number;
}
export interface ApifyLike {
  runAtsActor(input: ApifyAtsInput): Promise<{ items: unknown[]; usageTotalUsd: number }>;
}

/** Rough pre-call estimate for the allowance check: ~$1 per 1,000 results plus a small run overhead. */
export function apifyEstimateUsd(maxJobs: number): number {
  return 0.01 + maxJobs * 0.001;
}

/* --------------------------------- Jina Reader --------------------------------- */
export interface JinaResult {
  title?: string;
  sourceUrl?: string;
  markdown: string;
  /** Jina reports upstream errors as a "Warning:" line. */
  upstreamStatus?: number;
}

/** r.jina.ai: free, no key, ~20 requests/min. Pass a PoliteFetcher configured with ≥3 s spacing. */
export async function jinaRead(http: PoliteFetcher, url: string): Promise<JinaResult> {
  const res = await http.fetch({
    url: `https://r.jina.ai/${url}`,
    headers: { accept: "text/plain", "x-return-format": "markdown" },
    useCache: false,
    skipRobots: true, // the target's robots.txt is checked by the caller before escalating
    timeoutMs: 30_000,
  });
  if (res.status !== 200) throw new FetchError("http", `jina HTTP ${res.status}`, url, res.status);
  return parseJina(res.body);
}

export function parseJina(body: string): JinaResult {
  const title = body.match(/^Title:\s*(.*)$/m)?.[1]?.trim();
  const sourceUrl = body.match(/^URL Source:\s*(.*)$/m)?.[1]?.trim();
  const warn = body.match(/^Warning:.*?(\d{3})/m);
  const idx = body.indexOf("Markdown Content:");
  const markdown = idx >= 0 ? body.slice(idx + "Markdown Content:".length).trim() : body;
  return { title, sourceUrl, markdown, upstreamStatus: warn ? Number(warn[1]) : undefined };
}
