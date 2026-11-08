import { httpProbe, PoliteFetcher, nativeHttpClient, decideVerdict } from "@job-radar/core";
import { companies, eq, jobs, persistVerdict, priorClosed } from "@job-radar/db";
import { enqueue } from "@/lib/boss";
import { db } from "@/lib/db";

const RECHECK_AFTER_MS = 12 * 3600_000;
const INLINE_BUDGET_MS = 4000;

// A single user-triggered request: no politeness gap, but robots.txt and the bot UA still apply.
const fetcher = new PoliteFetcher({ http: nativeHttpClient, contactUrl: process.env.CRAWL_CONTACT_URL ?? "", minDelayMs: 0, maxDelayMs: 0, maxRetries: 0 });

/**
 * Apply click. If the job was verified < 12h ago, redirect straight away. Otherwise re-check inline
 * (≤ 4 s, HTTP probe only); if it is clearly closed, say so instead of sending the user to a dead page.
 * Anything inconclusive → redirect anyway and queue a full re-check (Playwright/Firecrawl) at top priority.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [row] = await db.select().from(jobs).innerJoin(companies, eq(jobs.companyId, companies.id)).where(eq(jobs.id, id));
  if (!row || row.jobs.status === "archived") return new Response("Job not found", { status: 404 });
  const job = row.jobs;
  const target = job.applyUrl ?? job.url;
  if (job.lastVerifiedAt && Date.now() - job.lastVerifiedAt.getTime() < RECHECK_AFTER_MS) return Response.redirect(target, 302);

  const probe = await Promise.race([
    httpProbe(job.url, fetcher),
    new Promise<null>((r) => setTimeout(() => r(null), INLINE_BUDGET_MS)),
  ]);
  if (probe) {
    const v = decideVerdict({ s2: probe.s2, ...(probe.s3 ? { s3: probe.s3 } : {}) }, await priorClosed(db, job.id));
    await persistVerdict(db, job.id, { ...v, signals: { s2: probe.s2, s3: probe.s3 }, attempts: [{ step: "http", outcome: "ok" }], worker: "oracle", latencyMs: 0, spent: [] }, "on-click");
    if (v.verdict === "closed" || probe.s2.outcome === "closed") {
      if (v.verdict !== "closed") await enqueue("verify:on-click", { jobId: job.id }, { singletonKey: `click:${job.id}` });
      return new Response(
        `<!doctype html><meta name=viewport content="width=device-width"><title>Job closed</title><body style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem"><h1>This job looks closed</h1><p>We just checked <b>${escapeHtml(job.title)}</b> at ${escapeHtml(row.companies.name)} and the company's page says it is no longer open (${escapeHtml(probe.s2.closedReason ?? "")}).</p><p><a href="${escapeHtml(job.url)}">Open the company page anyway</a></p></body>`,
        { status: 410, headers: { "content-type": "text/html; charset=utf-8" } },
      );
    }
    if (v.verdict === "open") return Response.redirect(target, 302);
  }
  await enqueue("verify:on-click", { jobId: job.id }, { singletonKey: `click:${job.id}` });
  return Response.redirect(target, 302);
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
