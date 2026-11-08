import {
  classify,
  decideVerdict,
  identityCheck,
  titleSimilarity,
  TITLE_SIM_THRESHOLD,
  type ClassifiedJob,
  type ClosedObservation,
  type JobEnricher,
  type ListResult,
  type RawJob,
  type S1,
  type VerifyOutcome,
} from "@job-radar/core";
import { and, desc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as s from "./schema";

type Db = NodePgDatabase<typeof s>;
export type CompanyRow = typeof s.companies.$inferSelect;
export type JobRow = typeof s.jobs.$inferSelect;
type Worker = "oracle" | "gha" | "fallback";

export interface IngestOptions {
  dry?: boolean;
  worker?: Worker;
  via?: string;
  shard?: number;
  ai?: JobEnricher;
  /** Embeds title+summary+skills locally; return null to skip. */
  embed?: (texts: string[]) => Promise<number[][] | null>;
  providerUnits?: { provider: string; units: number }[];
  now?: Date;
}

export interface IngestReport {
  crawlRunId?: string;
  company: string;
  complete: boolean;
  found: number;
  skippedNonIndia: number;
  newJobs: { title: string; url: string; classified: ClassifiedJob }[];
  updated: number;
  changed: { title: string; from: string; url: string }[];
  closed: { title: string; url: string }[];
}

const OPENISH = ["pending", "open", "changed", "unknown"] as const;

function jobValues(raw: RawJob, c: ClassifiedJob) {
  return {
    source: raw.source,
    sourceJobId: raw.sourceJobId,
    url: raw.url,
    applyUrl: raw.applyUrl ?? null,
    title: raw.title,
    normalizedTitle: c.normalizedTitle,
    summary: c.summary,
    descriptionHash: c.descriptionHash,
    locations: c.locations,
    cities: c.cities,
    workplace: c.workplace,
    remoteIndia: c.remoteIndia,
    employmentType: c.employmentType,
    minYears: c.minYears ?? null,
    maxYears: c.maxYears ?? null,
    expText: c.expText ?? null,
    seniority: c.seniority,
    track: c.track,
    skills: c.skills,
    salaryMinLpa: c.salaryMinLpa ?? null,
    salaryMaxLpa: c.salaryMaxLpa ?? null,
    salaryText: c.salaryText ?? null,
    freshersEligible: c.freshersEligible,
    rejectReasons: c.rejectReasons,
    flags: c.flags,
    classifierVersion: c.classifierVersion,
    postedAt: raw.postedAt ?? null,
  };
}

/** IDs we already hold full details for — adapters skip per-job detail fetches for these. */
export async function knownJobIds(db: Db, companyId: string): Promise<Set<string>> {
  const rows = await db
    .select({ id: s.jobs.sourceJobId, flags: s.jobs.flags })
    .from(s.jobs)
    .where(eq(s.jobs.companyId, companyId));
  return new Set(rows.filter((r) => !r.flags.includes("thin description")).map((r) => r.id));
}

export async function startCrawlRun(db: Db, company: CompanyRow, o: IngestOptions): Promise<string | undefined> {
  if (o.dry) return undefined;
  const [r] = await db
    .insert(s.crawlRuns)
    .values({ companyId: company.id, adapter: company.ats, worker: o.worker ?? "oracle", shard: o.shard ?? null, dryRun: false })
    .returning({ id: s.crawlRuns.id });
  return r!.id;
}

/** A failed snapshot never closes anything: record it and back off the company. */
export async function recordCrawlFailure(db: Db, company: CompanyRow, runId: string | undefined, err: string, status: "failed" | "blocked" | "skipped" = "failed") {
  if (!runId) return;
  await db.update(s.crawlRuns).set({ status, finishedAt: new Date(), error: err.slice(0, 2000) }).where(eq(s.crawlRuns.id, runId));
  const fails = company.consecutiveFailures + 1;
  await db
    .update(s.companies)
    .set({
      lastCrawledAt: new Date(),
      lastCrawlStatus: status,
      lastCrawlError: err.slice(0, 500),
      consecutiveFailures: fails,
      // Back off exponentially: 1, 2, 4 … days, capped at 7.
      blockedUntil: fails >= 3 ? new Date(Date.now() + Math.min(7, 2 ** (fails - 3)) * 864e5) : null,
      updatedAt: new Date(),
    })
    .where(eq(s.companies.id, company.id));
}

/**
 * Apply one adapter snapshot: upsert jobs (classify new/changed ones), record S1 for every
 * tracked job of the company, and close jobs missing from a *complete* snapshot.
 */
export async function ingestSnapshot(
  db: Db,
  company: CompanyRow,
  result: ListResult,
  runId: string | undefined,
  o: IngestOptions = {},
): Promise<IngestReport> {
  const now = o.now ?? new Date();
  const at = now.toISOString();
  const report: IngestReport = { crawlRunId: runId, company: company.name, complete: result.complete, found: result.jobs.length, skippedNonIndia: 0, newJobs: [], updated: 0, changed: [], closed: [] };

  const existing = await db
    .select()
    .from(s.jobs)
    .where(and(eq(s.jobs.companyId, company.id), inArray(s.jobs.status, [...OPENISH, "closed"])));
  const byId = new Map(existing.map((j) => [j.sourceJobId, j]));
  const seen = new Set<string>();
  const companyRef = { name: company.name, kind: company.kind };
  const toEmbed: { id: string; text: string }[] = [];

  // Dedupe within the snapshot (multi-search adapters can repeat a posting).
  const unique = new Map<string, RawJob>();
  for (const r of result.jobs) if (!unique.has(r.sourceJobId)) unique.set(r.sourceJobId, r);

  for (const raw of unique.values()) {
    seen.add(raw.sourceJobId);
    const prev = byId.get(raw.sourceJobId);
    if (!prev) {
      const c = await classify(raw, companyRef, o.ai);
      if (!c.inIndia) {
        report.skippedNonIndia++;
        continue;
      }
      report.newJobs.push({ title: raw.title, url: raw.url, classified: c });
      if (o.dry) continue;
      const [ins] = await db
        .insert(s.jobs)
        .values({ companyId: company.id, ...jobValues(raw, c), status: "pending", firstSeenAt: now, lastSeenAt: now })
        .onConflictDoNothing()
        .returning({ id: s.jobs.id });
      if (!ins) continue; // same URL already stored under another company/source
      await recordS1(db, ins.id, raw, result, at, o, true);
      toEmbed.push({ id: ins.id, text: `${raw.title}. ${c.skills.join(", ")}. ${c.summary}` });
      continue;
    }

    // Existing job: S1 present. Title drift → changed + re-classify.
    const sim = raw.title ? titleSimilarity(prev.title, raw.title) : 1;
    const drift = sim < TITLE_SIM_THRESHOLD;
    const needsReclass = drift || (raw.detailFetched && raw.descriptionText && prev.flags.includes("thin description"));
    if (drift) report.changed.push({ title: raw.title, from: prev.title, url: raw.url });
    report.updated++;
    if (o.dry) continue;
    const patch: Partial<typeof s.jobs.$inferInsert> = { lastSeenAt: now, updatedAt: now };
    if (needsReclass) {
      const c = await classify(raw, companyRef, o.ai);
      Object.assign(patch, jobValues(raw, c));
      toEmbed.push({ id: prev.id, text: `${raw.title}. ${c.skills.join(", ")}. ${c.summary}` });
    }
    await db.update(s.jobs).set(patch).where(eq(s.jobs.id, prev.id));
    await recordS1(db, prev.id, raw, result, at, o, true, prev.title);
  }

  // Jobs we track that the snapshot did not contain.
  for (const prev of existing) {
    if (seen.has(prev.sourceJobId) || prev.status === "closed") continue;
    if (!result.complete) continue; // partial snapshot: S1 can't close; verify:job will probe these
    report.closed.push({ title: prev.title, url: prev.url });
    if (o.dry) continue;
    await recordS1(db, prev.id, null, result, at, o, false);
  }

  if (!o.dry) {
    if (o.embed && toEmbed.length) {
      const vecs = await o.embed(toEmbed.map((e) => e.text)).catch(() => null);
      if (vecs) for (let i = 0; i < toEmbed.length; i++) await db.update(s.jobs).set({ embedding: vecs[i]! }).where(eq(s.jobs.id, toEmbed[i]!.id));
    }
    if (runId) {
      await db
        .update(s.crawlRuns)
        .set({ status: "ok", finishedAt: new Date(), complete: result.complete, jobsFound: result.jobs.length, jobsNew: report.newJobs.length, jobsClosed: report.closed.length, via: o.via ?? null, providerUnits: o.providerUnits ?? null })
        .where(eq(s.crawlRuns.id, runId));
    }
    await db
      .update(s.companies)
      .set({ lastCrawledAt: now, lastCrawlStatus: "ok", lastCrawlError: null, consecutiveFailures: 0, blockedUntil: null, ...(result.complete ? { lastFullSnapshotAt: now } : {}), updatedAt: now })
      .where(eq(s.companies.id, company.id));
  }
  return report;
}

async function recordS1(db: Db, jobId: string, raw: RawJob | null, result: ListResult, at: string, o: IngestOptions, present: boolean, prevTitle?: string) {
  const s1: S1 = { snapshotOk: true, complete: result.complete, present, feedTitle: raw?.title, at };
  const s4 = present && prevTitle && raw?.title ? identityCheck({ title: prevTitle, companyNames: [], locations: [], companyDomains: [] }, { title: raw.title, locations: [] }) : undefined;
  const signals = { s1, ...(s4 ? { s4 } : {}) };
  const v = decideVerdict(signals);
  await persistVerdict(db, jobId, { ...v, signals, attempts: [{ step: "feed", outcome: "ok" }], worker: o.worker ?? "oracle", latencyMs: 0, spent: [] }, "company");
}

/** Last 7 days of "saw it closed" observations for this job (for the 6h confirmation rule). */
export async function priorClosed(db: Db, jobId: string): Promise<ClosedObservation[]> {
  const rows = await db
    .select({ o: s.jobChecks.closedObservation })
    .from(s.jobChecks)
    .where(and(eq(s.jobChecks.jobId, jobId), isNotNull(s.jobChecks.closedObservation), gte(s.jobChecks.at, sql`now() - interval '7 days'`)))
    .orderBy(desc(s.jobChecks.at))
    .limit(10);
  return rows.map((r) => r.o as ClosedObservation);
}

/** Store a check and move the job's status. `unknown` never closes and never refreshes lastVerifiedAt. */
export async function persistVerdict(db: Db, jobId: string, v: VerifyOutcome, kind: string) {
  const now = new Date();
  await db.insert(s.jobChecks).values({
    jobId,
    at: now,
    kind,
    signals: v.signals,
    verdict: v.verdict,
    reason: v.reason,
    closedObservation: v.closedObservation ?? null,
    attempts: v.attempts,
    latencyMs: v.latencyMs,
    worker: v.worker,
    providerUnits: v.spent.length ? v.spent : null,
  });
  const patch: Partial<typeof s.jobs.$inferInsert> = { updatedAt: now };
  switch (v.verdict) {
    case "open":
      Object.assign(patch, { status: "open", lastVerifiedAt: now, checkFailures: 0, closedAt: null, closedReason: null });
      break;
    case "closed":
      Object.assign(patch, { status: "closed", closedAt: now, closedReason: v.reason });
      break;
    case "changed":
      Object.assign(patch, { status: "changed" });
      break;
    case "unknown":
      patch.checkFailures = sql`${s.jobs.checkFailures} + 1` as unknown as number;
      break;
  }
  await db.update(s.jobs).set(patch).where(eq(s.jobs.id, jobId));
  if (v.verdict === "unknown") {
    await db.update(s.jobs).set({ status: "unknown" }).where(and(eq(s.jobs.id, jobId), eq(s.jobs.status, "pending")));
  }
}

