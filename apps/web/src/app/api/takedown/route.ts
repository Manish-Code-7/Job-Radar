import { companies, ilike, takedownRequests } from "@job-radar/db";
import { z } from "zod";
import { db } from "@/lib/db";

const Body = z.object({
  requesterName: z.string().min(2).max(200),
  requesterEmail: z.string().email(),
  company: z.string().min(1).max(200),
  scope: z.enum(["company", "job"]),
  jobUrl: z.string().url().optional().or(z.literal("")),
  message: z.string().max(4000).optional(),
});

export async function POST(req: Request) {
  const form = await req.formData();
  const parsed = Body.safeParse(Object.fromEntries(form));
  if (!parsed.success) return Response.json({ error: "Please fill in all required fields." }, { status: 400 });
  const b = parsed.data;
  const [c] = await db.select({ id: companies.id }).from(companies).where(ilike(companies.name, b.company)).limit(1);
  await db.insert(takedownRequests).values({ requesterName: b.requesterName, requesterEmail: b.requesterEmail, companyId: c?.id ?? null, scope: b.scope, jobUrl: b.jobUrl || null, message: `${b.company}\n\n${b.message ?? ""}` });
  return Response.redirect(new URL("/takedown?sent=1", req.url), 303);
}
