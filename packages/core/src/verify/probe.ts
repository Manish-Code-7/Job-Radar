import { isFetchError } from "../fetch/http";
import type { PoliteFetcher } from "../fetch/polite";
import { analyzePage, isMetadataOnly, type PageAnalysis } from "./page";
import type { S2, S3 } from "./signals";

const MAX_HOPS = 8;

/** The job-identifying part of a URL: a UUID, a long digit run, or a Workday-style _R12345 suffix. */
export function jobKeyOf(url: string): string | undefined {
  const u = new URL(url);
  const s = u.pathname + u.search;
  return (
    s.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0] ??
    s.match(/_([A-Z]*-?\d{3,}[A-Za-z0-9-]*)$/)?.[1] ??
    s.match(/\d{5,}/)?.[0]
  );
}

export function isRedirectToBoard(original: string, final: string): boolean {
  if (original === final) return false;
  const key = jobKeyOf(original);
  if (!key) return false;
  if (final.includes(key)) return false;
  const depth = (u: string) => new URL(u).pathname.split("/").filter(Boolean).length;
  return depth(final) <= depth(original);
}

export interface ProbeResult {
  s2: S2;
  /** When the HTTP response already contains a real page, S3 can be computed from it without a browser. */
  s3?: S3;
  analysis?: PageAnalysis;
  html?: string;
}

export async function httpProbe(url: string, http: PoliteFetcher, now = () => new Date()): Promise<ProbeResult> {
  const at = now().toISOString();
  const chain: { url: string; status: number }[] = [];
  let current = url;
  try {
    for (let hop = 0; hop <= MAX_HOPS; hop++) {
      const res = await http.fetch({ url: current, redirect: "manual", useCache: false, timeoutMs: 15_000 });
      chain.push({ url: current, status: res.status });
      if (res.status >= 300 && res.status < 400 && res.headers["location"]) {
        current = new URL(res.headers["location"], current).toString();
        continue;
      }
      const finalUrl = current;
      const fu = new URL(finalUrl);
      if (fu.searchParams.get("error") === "true") {
        return { s2: { outcome: "closed", status: res.status, chain, finalUrl, closedReason: "ATS redirected with error=true", closedStrength: "definitive", at } };
      }
      if (res.status === 404 || res.status === 410) {
        return { s2: { outcome: "closed", status: res.status, chain, finalUrl, closedReason: `HTTP ${res.status}`, closedStrength: "soft", at } };
      }
      if (res.status >= 400) {
        return { s2: { outcome: "error", status: res.status, chain, finalUrl, error: `HTTP ${res.status}`, at } };
      }
      if (isRedirectToBoard(url, finalUrl)) {
        return { s2: { outcome: "closed", status: res.status, chain, finalUrl, closedReason: "redirected to job board", closedStrength: "soft", at } };
      }
      if (isMetadataOnly(res.body)) {
        return { s2: { outcome: "needs_render", status: res.status, chain, finalUrl, at }, html: res.body };
      }
      const analysis = analyzePage(res.body, finalUrl);
      if (analysis.closedReason) {
        return {
          s2: { outcome: "closed", status: res.status, chain, finalUrl, closedReason: analysis.closedReason, closedStrength: "soft", at },
          analysis,
          html: res.body,
        };
      }
      const s3: S3 = {
        outcome: "ok",
        pageType: analysis.pageType,
        hasApply: analysis.hasApply,
        extracted: analysis.extracted,
        finalUrl,
        via: "http",
        at,
      };
      return { s2: { outcome: "ok", status: res.status, chain, finalUrl, at }, s3, analysis, html: res.body };
    }
    return { s2: { outcome: "error", chain, error: "too many redirects", at } };
  } catch (e) {
    const err = isFetchError(e) ? `${e.kind}${e.status ? ` ${e.status}` : ""}` : (e as Error).message;
    return { s2: { outcome: "error", chain, error: err, status: isFetchError(e) ? e.status : undefined, at } };
  }
}
