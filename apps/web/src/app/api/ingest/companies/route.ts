import { and, companies, eq, jobs } from "@job-radar/db";
import { db } from "@/lib/db";
import { ingestAuthorized } from "../auth";

/** GitHub Actions pool: which companies belong to shard N of M (API tier only; browser tier stays on the VM). */
export async function GET(req: Request) {
  if (!ingestAuthorized(req)) return new Response("unauthorized", { status: 401 });
  const u = new URL(req.url);
  const shard = Number(u.searchParams.get("shard") ?? 0);
  const of = Math.max(1, Number(u.searchParams.get("of") ?? 1));
  const all = await db.select().from(companies).where(and(eq(companies.active, true), eq(companies.excluded, false), eq(companies.tier, "api"))).orderBy(companies.name);
  const mine = all.filter((_, i) => i % of === shard);
  const out = [];
  for (const c of mine) {
    const known = await db.select({ id: jobs.sourceJobId }).from(jobs).where(eq(jobs.companyId, c.id));
    out.push({ ...c, knownJobIds: known.map((k) => k.id) });
  }
  return Response.json({ companies: out });
}
