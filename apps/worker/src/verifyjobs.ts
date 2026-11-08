import { getAdapter, Priority, shouldArchive, verifyJob, type VerifyOutcome } from "@job-radar/core";
import {
  and,
  atsPolicy,
  companies,
  eq,
  gte,
  inArray,
  isNull,
  jobReports,
  jobs,
  lt,
  or,
  persistVerdict,
  priorClosed,
  rawPayloads,
  sql,
  verificationAudits,
  type CompanyRow,
  type JobRow,
} from "@job-radar/db";
import type { Deps } from "./deps";
import { info } from "./log";

export type CheckKind = "company" | "on-click" | "user-report" | "audit" | "manual";

function priorityFor(job: JobRow, kind: CheckKind): Priority {
  if (kind === "on-click" || kind === "user-report") return Priority.UserTriggered;
  return job.shownAt ? Priority.ShownJobVerify : Priority.Other;
}

async function requiresS3(deps: Deps, ats: CompanyRow["ats"]): Promise<boolean> {
  const [p] = await deps.db.select().from(atsPolicy).where(eq(atsPolicy.ats, ats));
  return !!p?.requireS3;
}

/** Run the verification agent on one job (S2→S3→S4; S1 comes from the latest crawl) and persist the result. */
export async function verifyOne(deps: Deps, job: JobRow, company: CompanyRow, kind: CheckKind, opts: { useBrowser?: boolean } = {}): Promise<VerifyOutcome> {
  const outcome = await verifyJob(
    {
      id: job.id,
      url: job.url,
      title: job.title,
      locations: job.locations,
      company: { id: company.id, name: company.name, aliases: company.aliases, domain: company.domain, extraDomains: company.extraDomains },
      priority: priorityFor(job, kind),
    },
    {
      http: deps.http,
      browser: opts.useBrowser === false ? undefined : deps.browser(),
      router: deps.router,
      firecrawl: deps.firecrawl,
      jinaHttp: deps.jinaHttp,
      workerName: deps.workerName,
    },
    { priorClosed: await priorClosed(deps.db, job.id), forceProbe: await requiresS3(deps, company.ats) },
  );
  await persistVerdict(deps.db, job.id, outcome, kind);

  // `changed`: re-read the posting through the adapter so the classifier sees the new version.
  if (outcome.verdict === "changed") {
    try {
      const fresh = await getAdapter(company.ats).getJob(job.url, { ...company, atsSlug: company.atsSlug }, { http: deps.http, browser: deps.browser() });
      if (fresh) {
        const { classify } = await import("@job-radar/core");
        const c = await classify(fresh, { name: company.name, kind: company.kind }, deps.ai);
        await deps.db
          .update(jobs)
          .set({ title: fresh.title, normalizedTitle: c.normalizedTitle, summary: c.summary, freshersEligible: c.freshersEligible, rejectReasons: c.rejectReasons, flags: c.flags, track: c.track, skills: c.skills, minYears: c.minYears ?? null, maxYears: c.maxYears ?? null, classifierVersion: c.classifierVersion, status: "pending", updatedAt: new Date() })
          .where(eq(jobs.id, job.id));
      }
    } catch {
      /* stays `changed`; next pass retries */
    }
  }
  return outcome;
}

/**
 * verify:company — after the daily snapshot, check the company's jobs that S1 could not decide
 * (browser-tier sites, partial snapshots, and jobs missing from a partial snapshot).
 */
export async function verifyCompanyJobs(deps: Deps, company: CompanyRow, limit = 60) {
  const since = new Date(Date.now() - 20 * 3600_000);
  const list = await deps.db
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.companyId, company.id),
        inArray(jobs.status, ["pending", "open", "unknown", "changed"]),
        or(isNull(jobs.lastVerifiedAt), lt(jobs.lastVerifiedAt, since)),
        eq(jobs.freshersEligible, true),
      ),
    )
    .orderBy(sql`${jobs.shownAt} is null`, jobs.lastVerifiedAt)
    .limit(limit);
  const tally: Record<string, number> = {};
  for (const j of list) {
    const o = await verifyOne(deps, j, company, "company");
    tally[o.verdict] = (tally[o.verdict] ?? 0) + 1;
  }
  info("verify:company", { company: company.name, checked: list.length, ...tally });
  return tally;
}

/** "Link not working?" — record the report, hide after 3 in 24h, and re-check now at top priority. */
export async function handleUserReport(deps: Deps, jobId: string, reporterKey: string, reason?: string) {
  await deps.db.insert(jobReports).values({ jobId, reporterKey, reason: reason ?? null });
  const [r] = await deps.db
    .select({ n: sql<number>`count(distinct ${jobReports.reporterKey})::int` })
    .from(jobReports)
    .where(and(eq(jobReports.jobId, jobId), gte(jobReports.at, sql`now() - interval '24 hours'`)));
  const n = r?.n ?? 0;
  await deps.db.update(jobs).set({ userReports24h: n, hiddenByReports: n >= 3 }).where(eq(jobs.id, jobId));
  const [row] = await deps.db.select().from(jobs).innerJoin(companies, eq(jobs.companyId, companies.id)).where(eq(jobs.id, jobId));
  if (row) await verifyOne(deps, row.jobs, row.companies, "user-report");
}

/** Nightly audit: click Apply on 30 random open jobs and track the false-open rate per ATS. */
export async function runAudit(deps: Deps, sample = 30) {
  const rows = await deps.db
    .select()
    .from(jobs)
    .innerJoin(companies, eq(jobs.companyId, companies.id))
    .where(and(eq(jobs.status, "open"), eq(jobs.freshersEligible, true)))
    .orderBy(sql`random()`)
    .limit(sample);
  const browser = deps.browser();
  for (const { jobs: j, companies: c } of rows) {
    if (!(await deps.http.isAllowed(j.url))) continue;
    const r = await browser.applyProbe(j.url);
    const falseOpen = r.outcome === "closed" || r.outcome === "no_button";
    await deps.db.insert(verificationAudits).values({ jobId: j.id, ats: c.ats, statusBefore: j.status, outcome: r.outcome, falseOpen, detail: r.detail ?? null, finalUrl: r.finalUrl ?? null });
    if (r.outcome === "closed") await verifyOne(deps, j, c, "audit");
  }
  // Recompute per-ATS false-open rate over 30 days; > 5% with ≥ 10 samples → S3 mandatory for that ATS.
  const rates = await deps.db
    .select({
      ats: verificationAudits.ats,
      n: sql<number>`count(*)::int`,
      bad: sql<number>`count(*) filter (where ${verificationAudits.falseOpen})::int`,
    })
    .from(verificationAudits)
    .where(and(gte(verificationAudits.at, sql`now() - interval '30 days'`), sql`${verificationAudits.outcome} <> 'error'`))
    .groupBy(verificationAudits.ats);
  for (const r of rates) {
    const rate = r.n ? r.bad / r.n : 0;
    const requireS3 = r.n >= 10 && rate > 0.05;
    await deps.db
      .insert(atsPolicy)
      .values({ ats: r.ats, requireS3, falseOpenRate: rate, sampleSize: r.n, updatedAt: new Date() })
      .onConflictDoUpdate({ target: atsPolicy.ats, set: { requireS3, falseOpenRate: rate, sampleSize: r.n, updatedAt: new Date() } });
  }
  info("verify:audit", { sampled: rows.length, rates });
  return rates;
}

/** Daily maintenance: archive stale/closed jobs (21 days) and drop raw payloads past their 30-day TTL. */
export async function maintenance(deps: Deps) {
  const candidates = await deps.db.select().from(jobs).where(inArray(jobs.status, ["closed", "pending", "unknown", "changed", "open"]));
  const now = new Date();
  const ids = candidates.filter((j) => shouldArchive(j, now)).map((j) => j.id);
  for (let i = 0; i < ids.length; i += 500) {
    await deps.db.update(jobs).set({ status: "archived", updatedAt: now }).where(inArray(jobs.id, ids.slice(i, i + 500)));
  }
  await deps.db.delete(rawPayloads).where(lt(rawPayloads.expiresAt, now));
  info("maintenance", { archived: ids.length });
}
