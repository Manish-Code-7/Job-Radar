import { and, companies, eq, isNull, jobs, lt, or, sql, type CompanyRow } from "@job-radar/db";
import PgBoss from "pg-boss";
import { crawlCompany } from "./crawl";
import type { Deps } from "./deps";
import { detectCompany } from "./detect";
import { env } from "./env";
import { info, warn } from "./log";
import { handleUserReport, maintenance, runAudit, verifyCompanyJobs, verifyOne } from "./verifyjobs";

export const Q = {
  schedule: "schedule:hourly",
  crawl: "crawl:company",
  verifyCompany: "verify:company",
  onClick: "verify:on-click",
  userReport: "verify:user-report",
  audit: "verify:audit",
  detect: "detect:company",
  maintenance: "maintenance:daily",
} as const;

const TZ = "Asia/Kolkata";

function istHour(d = new Date()) {
  return new Date(d.getTime() + 5.5 * 3600_000).getUTCHours();
}

async function company(deps: Deps, id: string): Promise<CompanyRow | undefined> {
  const [c] = await deps.db.select().from(companies).where(eq(companies.id, id));
  return c;
}

export async function startQueue(deps: Deps) {
  const boss = new PgBoss({ connectionString: env.DATABASE_URL!, schema: "pgboss" });
  boss.on("error", (e) => warn("pg-boss error", { err: e.message }));
  await boss.start();
  for (const q of Object.values(Q)) await boss.createQueue(q).catch(() => {});

  // Hourly: enqueue companies whose crawl hour is now (spreads Workday tenants across the day).
  await boss.schedule(Q.schedule, "5 * * * *", {}, { tz: TZ });
  await boss.schedule(Q.audit, "30 2 * * *", {}, { tz: TZ });
  await boss.schedule(Q.maintenance, "15 4 * * *", {}, { tz: TZ });

  await boss.work(Q.schedule, async () => {
    const h = istHour();
    const due = await deps.db
      .select({ id: companies.id })
      .from(companies)
      .where(
        and(
          eq(companies.active, true),
          eq(companies.excluded, false),
          eq(companies.crawlHour, h),
          or(isNull(companies.lastCrawledAt), lt(companies.lastCrawledAt, sql`now() - interval '20 hours'`)),
        ),
      );
    for (const c of due) await boss.send(Q.crawl, { companyId: c.id }, { singletonKey: `crawl:${c.id}`, retryLimit: 1 });
    // Jobs stuck pending/unknown get another look.
    info("scheduled crawls", { hour: h, count: due.length });
  });

  // Crawls: 2 API-tier in parallel is fine (each domain is still serialised by the polite fetcher).
  for (let i = 0; i < 2; i++) {
    await boss.work<{ companyId: string }>(Q.crawl, async ([job]) => {
      const c = await company(deps, job!.data.companyId);
      if (!c) return;
      const r = await crawlCompany(deps, c);
      if (r.status === "ok") await boss.send(Q.verifyCompany, { companyId: c.id }, { singletonKey: `verify:${c.id}` });
    });
  }
  await boss.work<{ companyId: string }>(Q.verifyCompany, async ([job]) => {
    const c = await company(deps, job!.data.companyId);
    if (c) await verifyCompanyJobs(deps, c);
  });
  await boss.work<{ jobId: string }>(Q.onClick, { pollingIntervalSeconds: 1 }, async ([job]) => {
    const [row] = await deps.db.select().from(jobs).innerJoin(companies, eq(jobs.companyId, companies.id)).where(eq(jobs.id, job!.data.jobId));
    if (row) await verifyOne(deps, row.jobs, row.companies, "on-click");
  });
  await boss.work<{ jobId: string; reporterKey: string; reason?: string }>(Q.userReport, { pollingIntervalSeconds: 2 }, async ([job]) => {
    await handleUserReport(deps, job!.data.jobId, job!.data.reporterKey, job!.data.reason);
  });
  await boss.work<{ companyId: string }>(Q.detect, async ([job]) => {
    const c = await company(deps, job!.data.companyId);
    if (c) await detectCompany(deps, c);
  });
  await boss.work(Q.audit, async () => void (await runAudit(deps)));
  await boss.work(Q.maintenance, async () => void (await maintenance(deps)));

  info("worker started", { queues: Object.values(Q), worker: deps.workerName });
  return boss;
}
