import type { BrowserDriver } from "../browser";
import { budgetedStep, Priority, runChain, type BudgetRouter, type ChainAttempt, type ChainStep } from "../budget";
import { jinaRead, type FirecrawlLike } from "../budget/providers";
import type { PoliteFetcher } from "../fetch/polite";
import { normalizeWs } from "../text";
import { analyzePage, CLOSED_PHRASES, identityCheck, isMetadataOnly } from "./page";
import { httpProbe } from "./probe";
import type { ClosedObservation, S1, S3, Signals } from "./signals";
import { decideVerdict, type VerdictResult } from "./verdict";

export * from "./signals";
export * from "./verdict";
export * from "./page";
export * from "./probe";

export interface VerifyDeps {
  http: PoliteFetcher;
  browser?: BrowserDriver;
  router?: BudgetRouter;
  firecrawl?: FirecrawlLike;
  /** A separate PoliteFetcher for r.jina.ai (≥3 s spacing). Undefined disables Jina. */
  jinaHttp?: PoliteFetcher;
  workerName: "oracle" | "gha" | "fallback";
  now?: () => Date;
}

export interface JobForVerify {
  id?: string;
  url: string;
  title: string;
  locations: string[];
  company: { id?: string; name: string; aliases?: string[]; domain?: string | null; extraDomains?: string[] };
  priority?: Priority;
}

export interface VerifyOutcome extends VerdictResult {
  signals: Signals;
  attempts: ChainAttempt[];
  worker: VerifyDeps["workerName"];
  latencyMs: number;
  /** Providers that charged units during this check. */
  spent: { provider: string; units: number }[];
}

function analyzeMarkdown(md: string, title: string | undefined, url: string, at: string): S3 {
  const lower = normalizeWs(md.slice(0, 2000)).toLowerCase();
  const closed = md.length < 2000 ? CLOSED_PHRASES.find((p) => lower.includes(p)) : undefined;
  if (closed) return { outcome: "ok", pageType: "error", hasApply: false, closedReason: `closed text: "${closed}"`, via: "jina", finalUrl: url, extracted: { locations: [] }, at };
  const heading = md.match(/^#{1,2}\s+(.+)$/m)?.[1]?.trim();
  const hasApply = /\[\s*(apply( now| for this (job|position|role))?|submit application|i'?m interested)\s*\]\(/i.test(md) || /^\s*apply( now)?\s*$/im.test(md);
  const t = heading ?? title;
  return {
    outcome: "ok",
    pageType: t && md.length > 500 && hasApply ? "job_posting" : "other",
    hasApply,
    extracted: { title: t, locations: [] },
    finalUrl: url,
    via: "jina",
    at,
  };
}

/**
 * Verify one job. S1 comes from the company's latest snapshot (computed by the caller).
 * When S1 decides, no page is fetched. Otherwise: HTTP probe → (if needed) rendered check via
 * own Playwright → Firecrawl (budgeted) → Jina → unknown.
 */
export async function verifyJob(
  job: JobForVerify,
  deps: VerifyDeps,
  opts: { s1?: S1; priorClosed?: ClosedObservation[]; forceProbe?: boolean } = {},
): Promise<VerifyOutcome> {
  const now = deps.now ?? (() => new Date());
  const t0 = Date.now();
  const signals: Signals = { s1: opts.s1 };
  const attempts: ChainAttempt[] = [];
  const spent: { provider: string; units: number }[] = [];
  let worker = deps.workerName;
  const expected = {
    title: job.title,
    companyNames: [job.company.name, ...(job.company.aliases ?? [])],
    locations: job.locations,
    companyDomains: [job.company.domain ?? "", ...(job.company.extraDomains ?? [])],
  };
  const done = (): VerifyOutcome => ({
    ...decideVerdict(signals, opts.priorClosed),
    signals,
    attempts,
    worker,
    latencyMs: Date.now() - t0,
    spent,
  });

  // S1 decides on its own when available.
  if (opts.s1?.snapshotOk && !opts.forceProbe) {
    if (opts.s1.present) {
      if (opts.s1.feedTitle) signals.s4 = identityCheck(expected, { title: opts.s1.feedTitle, locations: [], finalUrl: job.url });
      return done();
    }
    if (opts.s1.complete) return done();
  }

  // S2 HTTP probe.
  const probe = await httpProbe(job.url, deps.http, now);
  signals.s2 = probe.s2;
  attempts.push({ step: "http", outcome: probe.s2.outcome === "error" ? "error" : "ok", detail: probe.s2.closedReason ?? probe.s2.error });
  if (probe.s2.outcome === "closed") return done();
  if (probe.s3?.pageType === "job_posting" && probe.s3.hasApply) {
    signals.s3 = probe.s3;
    signals.s4 = identityCheck(expected, { ...probe.s3.extracted!, finalUrl: probe.s3.finalUrl });
    return done();
  }
  // A robots.txt disallow means we must not escalate to any other fetcher either.
  if (probe.s2.error?.startsWith("robots_disallowed")) return done();

  // S3 rendered check, escalating through the chain.
  const at = () => now().toISOString();
  const steps: ChainStep<S3>[] = [];
  if (deps.browser) {
    const browser = deps.browser;
    steps.push({
      name: "playwright",
      async run() {
        const page = await browser.render(job.url, { waitMs: 2000 });
        if (page.status && page.status >= 400 && page.status !== 404 && page.status !== 410) return null; // blocked
        if (isMetadataOnly(page.html)) return null;
        const a = analyzePage(page.html, page.finalUrl);
        return { outcome: "ok", pageType: a.pageType, hasApply: a.hasApply, closedReason: a.closedReason, extracted: a.extracted, finalUrl: page.finalUrl, via: "playwright", at: at() };
      },
    });
  }
  if (deps.router && deps.firecrawl) {
    const fc = deps.firecrawl;
    steps.push(
      budgetedStep(deps.router, "firecrawl", {
        provider: "firecrawl",
        estimate: 1,
        priority: job.priority ?? Priority.Other,
        task: "verify:scrape",
        cacheKey: job.url,
        jobId: job.id,
        companyId: job.company.id,
        url: job.url,
        async call() {
          const r = await fc.scrape(job.url, { formats: ["rawHtml", "markdown"] });
          spent.push({ provider: "firecrawl", units: r.creditsUsed ?? 1 });
          const html = r.rawHtml ?? "";
          const finalUrl = r.finalUrl ?? job.url;
          let s3: S3;
          if (r.statusCode === 404 || r.statusCode === 410) {
            s3 = { outcome: "ok", pageType: "error", hasApply: false, closedReason: `HTTP ${r.statusCode} (firecrawl)`, extracted: { locations: [] }, finalUrl, via: "firecrawl", at: at() };
          } else {
            const a = analyzePage(html, finalUrl);
            s3 = { outcome: "ok", pageType: a.pageType, hasApply: a.hasApply, closedReason: a.closedReason, extracted: a.extracted, finalUrl, via: "firecrawl", at: at() };
          }
          return { value: s3, units: r.creditsUsed ?? 1 };
        },
      }),
    );
  }
  if (deps.jinaHttp) {
    const jh = deps.jinaHttp;
    steps.push({
      name: "jina",
      async run() {
        const r = await jinaRead(jh, job.url);
        if (r.upstreamStatus === 404 || r.upstreamStatus === 410) {
          return { outcome: "ok", pageType: "error", hasApply: false, closedReason: `HTTP ${r.upstreamStatus} (jina)`, extracted: { locations: [] }, finalUrl: job.url, via: "jina", at: at() };
        }
        if (r.upstreamStatus && r.upstreamStatus >= 400) return null;
        return analyzeMarkdown(r.markdown, r.title, r.sourceUrl ?? job.url, at());
      },
    });
  }

  const res = await runChain(steps);
  attempts.push(...res.attempts);
  if (res.value) {
    signals.s3 = res.value;
    if (res.via === "firecrawl" || res.via === "jina") worker = "fallback";
    if (!res.value.closedReason && res.value.pageType === "job_posting") {
      signals.s4 = identityCheck(expected, { ...res.value.extracted!, finalUrl: res.value.finalUrl });
    }
  } else if (probe.s3) {
    signals.s3 = probe.s3; // metadata-only/other page from plain HTTP: never enough to open
  }
  return done();
}
