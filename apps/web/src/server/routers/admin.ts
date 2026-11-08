import { API_TIER_ATS, ATS_VALUES, COMPANY_KINDS, computeAllowance, monthWindow } from "@job-radar/core";
import {
  and,
  atsPolicy,
  companies,
  crawlRuns,
  desc,
  domainState,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  jobChecks,
  jobs,
  or,
  providerUsage,
  sql,
  takedownRequests,
  verificationAudits,
  type Db,
} from "@job-radar/db";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { boss, enqueue } from "@/lib/boss";
import { env } from "@/lib/env";
import { adminProcedure, router } from "../trpc";

const Ats = z.enum(ATS_VALUES);
const Kind = z.enum(COMPANY_KINDS);

function normalizeDomain(input: string): { domain: string; careersUrl?: string } {
  const s = input.trim();
  const url = /^https?:\/\//.test(s) ? new URL(s) : new URL(`https://${s}`);
  const domain = url.hostname.replace(/^www\./, "");
  return { domain, careersUrl: url.pathname.length > 1 ? url.toString() : undefined };
}

async function providerStats(db: Db, provider: "firecrawl" | "apify", cap: number) {
  const now = new Date();
  const w = monthWindow(now);
  const [r] = await db
    .select({
      month: sql<number>`coalesce(sum(${providerUsage.units}) filter (where ${providerUsage.at} >= ${w.monthStart}), 0)::float`,
      today: sql<number>`coalesce(sum(${providerUsage.units}) filter (where ${providerUsage.at} >= ${w.dayStart}), 0)::float`,
    })
    .from(providerUsage)
    .where(eq(providerUsage.provider, provider));
  return computeAllowance(cap, Number(r?.month ?? 0), Number(r?.today ?? 0), now);
}

export const adminRouter = router({
  /* ------------------------------ Health ------------------------------ */
  health: adminProcedure.query(async ({ ctx: { db } }) => {
    const since48h = sql`now() - interval '48 hours'`;
    const [cov] = await db
      .select({
        total: sql<number>`count(*) filter (where ${companies.active} and not ${companies.excluded} and ${companies.ats} <> 'unknown')::int`,
        ok48: sql<number>`count(*) filter (where ${companies.active} and not ${companies.excluded} and ${companies.lastCrawlStatus} = 'ok' and ${companies.lastCrawledAt} > ${since48h})::int`,
        unknownAts: sql<number>`count(*) filter (where ${companies.ats} = 'unknown' and not ${companies.excluded})::int`,
        excluded: sql<number>`count(*) filter (where ${companies.excluded})::int`,
      })
      .from(companies);
    const failing = await db
      .select({ id: companies.id, name: companies.name, ats: companies.ats, status: companies.lastCrawlStatus, error: companies.lastCrawlError, fails: companies.consecutiveFailures, blockedUntil: companies.blockedUntil, lastCrawledAt: companies.lastCrawledAt })
      .from(companies)
      .where(and(eq(companies.excluded, false), or(gt(companies.consecutiveFailures, 0), sql`${companies.lastCrawlStatus} in ('failed','blocked')`)))
      .orderBy(desc(companies.consecutiveFailures))
      .limit(50);
    const adapterFailures = await db
      .select({ ats: companies.ats, failing: sql<number>`count(*)::int` })
      .from(companies)
      .where(and(eq(companies.excluded, false), gt(companies.consecutiveFailures, 0)))
      .groupBy(companies.ats);
    const blockedDomains = await db.select().from(domainState).where(gt(domainState.blockedUntil, new Date())).limit(50);
    const statusCounts = await db
      .select({ status: jobs.status, eligible: jobs.freshersEligible, n: sql<number>`count(*)::int` })
      .from(jobs)
      .groupBy(jobs.status, jobs.freshersEligible);
    const verified36 = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(jobs)
      .where(and(eq(jobs.status, "open"), eq(jobs.freshersEligible, true), gt(jobs.lastVerifiedAt, sql`now() - interval '36 hours'`)));
    const falseOpen = await db.select().from(atsPolicy).orderBy(desc(atsPolicy.falseOpenRate));
    const [audit] = await db
      .select({ n: sql<number>`count(*)::int`, bad: sql<number>`count(*) filter (where ${verificationAudits.falseOpen})::int` })
      .from(verificationAudits)
      .where(gte(verificationAudits.at, sql`now() - interval '30 days'`));
    const [gem] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(providerUsage)
      .where(and(inArray(providerUsage.provider, ["gemini", "ai_gateway"]), gt(providerUsage.at, sql`now() - interval '1 day'`)));
    const recentRuns = await db
      .select({ id: crawlRuns.id, company: companies.name, status: crawlRuns.status, via: crawlRuns.via, worker: crawlRuns.worker, found: crawlRuns.jobsFound, new: crawlRuns.jobsNew, closed: crawlRuns.jobsClosed, startedAt: crawlRuns.startedAt, error: crawlRuns.error })
      .from(crawlRuns)
      .leftJoin(companies, eq(crawlRuns.companyId, companies.id))
      .orderBy(desc(crawlRuns.startedAt))
      .limit(25);
    const firecrawl = await providerStats(db, "firecrawl", env.FIRECRAWL_MONTHLY_CREDITS);
    const apify = await providerStats(db, "apify", env.APIFY_MONTHLY_USD);
    return {
      coverage: { ...cov!, pct: cov!.total ? cov!.ok48 / cov!.total : 0 },
      failing,
      adapterFailures,
      blockedDomains,
      statusCounts,
      verifiedOpen36h: verified36[0]?.n ?? 0,
      falseOpen: { perAts: falseOpen, last30d: audit!.n ? audit!.bad / audit!.n : null, samples: audit!.n },
      ai: { enabled: env.AI_ENABLED, provider: env.AI_PROVIDER, usedToday: gem?.n ?? 0, dailyBudget: env.GEMINI_DAILY_REQUESTS },
      providers: [
        { name: "Firecrawl", unit: "credits", enabled: env.FIRECRAWL_ENABLED, ...firecrawl, alert: firecrawl.pctUsed >= 0.8 },
        { name: "Apify", unit: "USD", enabled: env.APIFY_ENABLED, ...apify, alert: apify.pctUsed >= 0.8 },
      ],
      recentRuns,
    };
  }),

  /* ------------------------------ Companies ------------------------------ */
  companies: adminProcedure
    .input(z.object({ q: z.string().optional(), ats: Ats.optional(), problem: z.boolean().optional() }))
    .query(async ({ ctx: { db }, input }) => {
      const where = and(
        input.q ? ilike(companies.name, `%${input.q}%`) : undefined,
        input.ats ? eq(companies.ats, input.ats) : undefined,
        input.problem ? gt(companies.consecutiveFailures, 0) : undefined,
      );
      return db
        .select({
          c: companies,
          open: sql<number>`(select count(*) from jobs j where j.company_id = ${companies.id} and j.status = 'open' and j.freshers_eligible)::int`,
          total: sql<number>`(select count(*) from jobs j where j.company_id = ${companies.id} and j.status <> 'archived')::int`,
        })
        .from(companies)
        .where(where)
        .orderBy(companies.priority, companies.name)
        .limit(500);
    }),

  addCompany: adminProcedure
    .input(z.object({ name: z.string().min(1), domainOrUrl: z.string().min(3), kind: Kind.default("product"), priority: z.number().int().min(1).max(3).default(2) }))
    .mutation(async ({ ctx: { db }, input }) => {
      const { domain, careersUrl } = normalizeDomain(input.domainOrUrl);
      const [c] = await db
        .insert(companies)
        .values({ name: input.name, domain, careersUrl: careersUrl ?? null, kind: input.kind, priority: input.priority })
        .onConflictDoNothing()
        .returning();
      if (!c) throw new TRPCError({ code: "CONFLICT", message: "A company with that name exists" });
      await enqueue("detect:company", { companyId: c.id });
      return c;
    }),

  updateCompany: adminProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().optional(),
        domain: z.string().nullable().optional(),
        aliases: z.array(z.string()).optional(),
        extraDomains: z.array(z.string()).optional(),
        kind: Kind.optional(),
        ats: Ats.optional(),
        atsSlug: z.string().nullable().optional(),
        careersUrl: z.string().url().nullable().optional(),
        active: z.boolean().optional(),
        excluded: z.boolean().optional(),
        excludedReason: z.string().nullable().optional(),
        priority: z.number().int().min(1).max(3).optional(),
        crawlHour: z.number().int().min(0).max(23).optional(),
      }),
    )
    .mutation(async ({ ctx: { db }, input: { id, ...patch } }) => {
      const extra = patch.ats ? { tier: (API_TIER_ATS.includes(patch.ats) || patch.ats === "workday" || patch.ats === "oracle" ? "api" : "browser") as "api" | "browser" } : {};
      const [c] = await db.update(companies).set({ ...patch, ...extra, updatedAt: new Date() }).where(eq(companies.id, id)).returning();
      return c;
    }),

  crawlNow: adminProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ input }) => {
    await enqueue("crawl:company", { companyId: input.id }, { singletonKey: `crawl:${input.id}` });
    return { queued: true };
  }),

  detectNow: adminProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ input }) => {
    await enqueue("detect:company", { companyId: input.id });
    return { queued: true };
  }),

  testAdapter: adminProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ input }) => {
    const jobId = await enqueue("admin:test-adapter", { companyId: input.id }, { expireInSeconds: 300 });
    return { jobId };
  }),

  testResult: adminProcedure.input(z.object({ jobId: z.string() })).query(async ({ input }) => {
    const b = await boss();
    const j = await b.getJobById("admin:test-adapter", input.jobId);
    return j ? { state: j.state, output: j.output as unknown } : { state: "missing", output: null };
  }),

  /* ------------------------------ Jobs inspector ------------------------------ */
  jobs: adminProcedure
    .input(z.object({ q: z.string().optional(), status: z.string().optional(), companyId: z.string().uuid().optional(), eligible: z.boolean().optional() }))
    .query(async ({ ctx: { db }, input }) =>
      db
        .select({ j: jobs, company: companies.name, ats: companies.ats })
        .from(jobs)
        .innerJoin(companies, eq(jobs.companyId, companies.id))
        .where(
          and(
            input.q ? or(ilike(jobs.title, `%${input.q}%`), ilike(companies.name, `%${input.q}%`), eq(jobs.url, input.q)) : undefined,
            input.status ? eq(jobs.status, input.status as never) : undefined,
            input.companyId ? eq(jobs.companyId, input.companyId) : undefined,
            input.eligible !== undefined ? eq(jobs.freshersEligible, input.eligible) : undefined,
          ),
        )
        .orderBy(desc(jobs.updatedAt))
        .limit(200),
    ),

  job: adminProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ ctx: { db }, input }) => {
    const [row] = await db.select().from(jobs).innerJoin(companies, eq(jobs.companyId, companies.id)).where(eq(jobs.id, input.id));
    if (!row) throw new TRPCError({ code: "NOT_FOUND" });
    const checks = await db.select().from(jobChecks).where(eq(jobChecks.jobId, input.id)).orderBy(desc(jobChecks.at)).limit(100);
    const audits = await db.select().from(verificationAudits).where(eq(verificationAudits.jobId, input.id)).orderBy(desc(verificationAudits.at));
    const { embedding: _e, ...job } = row.jobs;
    return { job, company: row.companies, checks, audits };
  }),

  recheckJob: adminProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ input }) => {
    await enqueue("verify:on-click", { jobId: input.id });
    return { queued: true };
  }),

  /* ------------------------------ Takedowns ------------------------------ */
  takedowns: adminProcedure.input(z.object({ status: z.string().optional() })).query(async ({ ctx: { db }, input }) =>
    db
      .select({ t: takedownRequests, company: companies.name })
      .from(takedownRequests)
      .leftJoin(companies, eq(takedownRequests.companyId, companies.id))
      .where(input.status ? eq(takedownRequests.status, input.status) : undefined)
      .orderBy(desc(takedownRequests.at))
      .limit(200),
  ),

  resolveTakedown: adminProcedure
    .input(z.object({ id: z.string().uuid(), status: z.enum(["actioned", "rejected"]), note: z.string().optional(), excludeCompanyId: z.string().uuid().optional(), archiveJobUrl: z.string().optional() }))
    .mutation(async ({ ctx: { db, session }, input }) => {
      if (input.excludeCompanyId) {
        await db.update(companies).set({ excluded: true, excludedReason: "employer takedown request", updatedAt: new Date() }).where(eq(companies.id, input.excludeCompanyId));
        await db.update(jobs).set({ status: "archived" }).where(eq(jobs.companyId, input.excludeCompanyId));
      }
      if (input.archiveJobUrl) await db.update(jobs).set({ status: "archived" }).where(eq(jobs.url, input.archiveJobUrl));
      await db
        .update(takedownRequests)
        .set({ status: input.status, note: input.note ?? null, resolvedAt: new Date(), resolvedBy: session.user.email })
        .where(eq(takedownRequests.id, input.id));
      return { ok: true };
    }),
});
