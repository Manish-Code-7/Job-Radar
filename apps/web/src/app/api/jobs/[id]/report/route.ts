import { createHash } from "node:crypto";
import { enqueue } from "@/lib/boss";
import { getSession } from "@/lib/auth";

/** "Link not working?" — queue a top-priority re-check; 3 distinct reporters in 24h hide the job. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession().catch(() => null);
  const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown";
  const reporterKey = session?.user.id ?? `ip:${createHash("sha256").update(ip + (process.env.BETTER_AUTH_SECRET ?? "")).digest("hex").slice(0, 16)}`;
  const body = (await req.json().catch(() => ({}))) as { reason?: string };
  await enqueue("verify:user-report", { jobId: id, reporterKey, reason: body.reason?.slice(0, 300) }, { singletonKey: `report:${id}:${reporterKey}`, singletonHours: 24 } as never);
  return Response.json({ ok: true });
}
