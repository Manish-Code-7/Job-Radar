import {
  apifyEstimateUsd,
  budgetedStep,
  compact,
  getAdapter,
  hasAdapter,
  htmlToText,
  isFetchError,
  Priority,
  runChain,
  toDate,
  type AdapterContext,
  type ListResult,
  type RawJob,
} from "@job-radar/core";
import {
  companies,
  eq,
  ingestSnapshot,
  knownJobIds,
  rawPayloads,
  recordCrawlFailure,
  sourcePolicy,
  startCrawlRun,
  type CompanyRow,
  type IngestReport,
} from "@job-radar/db";
import type { Deps } from "./deps";
import { info, warn } from "./log";

const APIFY_ELIGIBLE = new Set(["workday", "icims", "successfactors"]);
const TRACK_KEYWORDS = ["software engineer", "associate", "devops", "machine learning", "data engineer", "graduate"];

export interface CrawlOptions {
  dry?: boolean;
  force?: boolean;
  maxDetailFetches?: number;
}

export interface CrawlOutcome {
  status: "ok" | "failed" | "blocked" | "skipped";
  via?: string;
  reason?: string;
  report?: IngestReport;
  sample?: RawJob[];
}

/** Map an arbitrary ATS-actor item to RawJob (actor schemas differ, so read common field names). */
export function apifyItemToRawJob(item: Record<string, unknown>, company: CompanyRow): RawJob | null {
  const str = (...keys: string[]) => {
    for (const k of keys) if (typeof item[k] === "string" && item[k]) return item[k] as string;
    return undefined;
  };
  const url = str("url", "jobUrl", "applyUrl", "link");
  const title = str("title", "jobTitle", "name");
  if (!url || !title) return null;
  const loc = item.locations ?? item.location ?? item.city;
  return {
    source: company.ats,
    sourceJobId: str("id", "jobId", "reqId", "requisitionId") ?? url,
    url,
    applyUrl: str("applyUrl"),
    title,
    descriptionText: htmlToText(str("descriptionText", "description", "descriptionHtml") ?? ""),
    locations: compact(Array.isArray(loc) ? (loc as string[]) : [loc as string]),
    employmentTypeHint: str("employmentType", "timeType"),
    postedAt: toDate(str("postedAt", "datePosted", "postedDate")),
    detailFetched: !!str("descriptionText", "description", "descriptionHtml"),
  };
}

async function sourceEnabled(deps: Deps, company: CompanyRow): Promise<boolean> {
  const [p] = await deps.db.select().from(sourcePolicy).where(eq(sourcePolicy.source, company.ats));
  return p ? p.enabled : true;
}

export async function crawlCompany(deps: Deps, company: CompanyRow, o: CrawlOptions = {}): Promise<CrawlOutcome> {
  if (company.excluded) return { status: "skipped", reason: `excluded: ${company.excludedReason ?? ""}` };
  if (!company.active && !o.force) return { status: "skipped", reason: "inactive" };
  if (!hasAdapter(company.ats) || company.ats === "unknown") return { status: "skipped", reason: `no adapter for ats=${company.ats} (run detect)` };
  if (company.blockedUntil && company.blockedUntil > new Date() && !o.force) return { status: "skipped", reason: `backing off until ${company.blockedUntil.toISOString()}` };
  if (!(await sourceEnabled(deps, company))) return { status: "skipped", reason: `source_policy disabled for ${company.ats}` };

  const adapter = getAdapter(company.ats);
  const ref = { id: company.id, name: company.name, domain: company.domain, aliases: company.aliases, ats: company.ats, atsSlug: company.atsSlug, careersUrl: company.careersUrl };
  const ctx: AdapterContext = {
    http: deps.http,
    browser: adapter.tier === "browser" || company.ats === "workday" ? deps.browser() : undefined,
    knownJobIds: o.dry ? new Set() : await knownJobIds(deps.db, company.id),
    maxDetailFetches: o.maxDetailFetches ?? (o.dry ? 5 : 40),
    ai: deps.ai,
    log: (m, meta) => info(m, { company: company.name, ...meta }),
  };

  const runId = await startCrawlRun(deps.db, company, { dry: o.dry, worker: deps.workerName });
  const ownLabel = adapter.tier === "browser" ? "own-playwright" : "own-http";

  // Escalation: own adapter (which already falls back to own Playwright where supported) → Apify → skip.
  const steps = [
    {
      name: ownLabel,
      run: async (): Promise<ListResult | null> => adapter.listJobs(ref, ctx),
    },
  ];
  const canApify = APIFY_ELIGIBLE.has(company.ats) && deps.apify && company.careersUrl;
  if (canApify) {
    const weeklyFull = !company.lastApifyFullAt || Date.now() - company.lastApifyFullAt.getTime() > 7 * 864e5;
    const maxJobs = 50;
    steps.push(
      budgetedStep(deps.router, "apify", {
        provider: "apify",
        estimate: apifyEstimateUsd(maxJobs),
        priority: company.priority === 1 ? Priority.BlockedHighPriorityTenant : Priority.Other,
        task: weeklyFull ? "list:full" : "list:recent",
        companyId: company.id,
        cacheKey: `${company.careersUrl}:${weeklyFull ? "full" : "recent"}`,
        async call() {
          const r = await deps.apify!.runAtsActor({
            queries: [company.careersUrl!],
            location: "India",
            keywords: TRACK_KEYWORDS,
            ...(weeklyFull ? {} : { postedWithinDays: 3 }),
            maxJobsPerCompany: maxJobs,
          });
          if (weeklyFull && !o.dry) await deps.db.update(companies).set({ lastApifyFullAt: new Date() }).where(eq(companies.id, company.id));
          const jobs = r.items.map((i) => apifyItemToRawJob(i as Record<string, unknown>, company)).filter((j): j is RawJob => !!j);
          return { value: { jobs, complete: false } satisfies ListResult, units: r.usageTotalUsd };
        },
      }),
    );
  }

  const res = await runChain(steps);
  const firstErr = res.attempts.find((a) => a.outcome === "error")?.detail ?? "";
  if (!res.value) {
    const blocked = /blocked|circuit_open|403|challenge/i.test(firstErr);
    const reason = res.attempts.map((a) => `${a.step}:${a.outcome}${a.detail ? ` (${a.detail})` : ""}`).join(" → ");
    warn("crawl failed", { company: company.name, reason });
    if (!o.dry) await recordCrawlFailure(deps.db, company, runId, reason, blocked ? "blocked" : "failed");
    return { status: blocked ? "blocked" : "failed", reason };
  }

  const via = res.via!;
  const spent = via === "apify" ? [{ provider: "apify", units: 0 }] : undefined;
  if (runId) {
    // Keep the raw snapshot 30 days for debugging adapters (TTL enforced by maintenance).
    await deps.db.insert(rawPayloads).values({ crawlRunId: runId, payload: { count: res.value.jobs.length, complete: res.value.complete, sample: res.value.jobs.slice(0, 20).map(({ raw: _r, ...j }) => j) } });
  }
  const report = await ingestSnapshot(deps.db, company, res.value, runId, {
    dry: o.dry,
    worker: deps.workerName,
    via,
    ai: deps.ai,
    embed: o.dry ? undefined : deps.embed,
    providerUnits: spent,
  });
  info("crawl ok", { company: company.name, via, found: report.found, new: report.newJobs.length, closed: report.closed.length, complete: report.complete });
  return { status: "ok", via, report, sample: res.value.jobs.slice(0, 5) };
}

export function isBlockedError(e: unknown): boolean {
  return isFetchError(e) && (e.kind === "blocked" || e.kind === "circuit_open");
}
