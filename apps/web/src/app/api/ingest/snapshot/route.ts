import { hostAllowed, type ListResult, type RawJob } from "@job-radar/core";
import { companies, eq, ingestSnapshot, recordCrawlFailure, startCrawlRun } from "@job-radar/db";
import { z } from "zod";
import { db } from "@/lib/db";
import { ingestAuthorized } from "../auth";

const Body = z.object({
  companyId: z.string().uuid(),
  shard: z.number().int().optional(),
  error: z.string().optional(),
  result: z
    .object({
      complete: z.boolean(),
      jobs: z.array(
        z.object({
          source: z.string(),
          sourceJobId: z.string(),
          url: z.string().url(),
          applyUrl: z.string().optional(),
          title: z.string(),
          descriptionText: z.string(),
          locations: z.array(z.string()),
          workplaceHint: z.string().optional(),
          employmentTypeHint: z.string().optional(),
          postedAt: z.coerce.date().optional(),
          salaryHint: z.string().optional(),
          department: z.string().optional(),
          detailFetched: z.boolean().optional(),
          applyable: z.boolean().optional(),
        }).passthrough(),
      ),
    })
    .nullable(),
});

/** GitHub Actions pool posts each company snapshot here; the same ingest code as the VM worker applies it. */
export async function POST(req: Request) {
  if (!ingestAuthorized(req)) return new Response("unauthorized", { status: 401 });
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  const b = parsed.data;
  const [company] = await db.select().from(companies).where(eq(companies.id, b.companyId));
  if (!company) return new Response("unknown company", { status: 404 });
  const runId = await startCrawlRun(db, company, { worker: "gha", shard: b.shard });
  if (!b.result) {
    await recordCrawlFailure(db, company, runId, `gha: ${b.error ?? "no result"}`);
    return Response.json({ ok: false });
  }
  // Only accept jobs whose URL host belongs to this company's ATS/domain (defence against a leaked token).
  const domains = [company.domain ?? "", ...company.extraDomains];
  const jobsIn = b.result.jobs as unknown as RawJob[];
  const kept = jobsIn.filter((j) => hostAllowed(j.url, domains));
  // If anything was dropped the snapshot is no longer complete, so it must not close jobs.
  const result: ListResult = { jobs: kept, complete: b.result.complete && kept.length === jobsIn.length };
  const report = await ingestSnapshot(db, company, result, runId, { worker: "gha", via: "own-http", shard: b.shard });
  return Response.json({ ok: true, new: report.newJobs.length, closed: report.closed.length });
}
