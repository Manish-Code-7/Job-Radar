import { eq, profiles } from "@job-radar/db";
import { randomUUID } from "node:crypto";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { ensureProfile } from "@/lib/profile";
import { parseResume, pdfToText } from "@/lib/resume";
import { deleteResume, putResume } from "@/lib/storage";

export const runtime = "nodejs";
const MAX_BYTES = 5 * 1024 * 1024;

/** Upload a resume PDF: encrypt → R2, extract text, parse locally, return the draft for the user to review. */
export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return Response.json({ error: "Sign in first" }, { status: 401 });
  const p = await ensureProfile(s.user);
  if (!p.consentAt || p.consentWithdrawnAt) return Response.json({ error: "Please accept the data notice first." }, { status: 412 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("resume");
  if (!(file instanceof File)) return Response.json({ error: "Choose a PDF file." }, { status: 400 });
  if (file.size > MAX_BYTES) return Response.json({ error: "That file is over 5 MB." }, { status: 413 });
  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.subarray(0, 5).toString("latin1") !== "%PDF-") return Response.json({ error: "That isn't a PDF. Export your resume as PDF and try again." }, { status: 415 });

  let text: string;
  try {
    text = await pdfToText(buf);
  } catch {
    return Response.json({ error: "We couldn't read that PDF. Is it password-protected?" }, { status: 422 });
  }
  if (text.replace(/\s/g, "").length < 200) {
    return Response.json({ error: "This PDF has almost no text (maybe a scanned image). Please upload a text-based PDF." }, { status: 422 });
  }

  const key = `resumes/${p.userId}/${randomUUID()}.pdf.enc`;
  try {
    await putResume(key, buf);
  } catch (e) {
    console.error("resume storage failed", (e as Error).message);
    return Response.json({ error: "We couldn't save your resume right now. Please try again in a minute." }, { status: 503 });
  }
  if (p.resumeKey) await deleteResume(p.resumeKey).catch(() => {});
  const parsed = await parseResume(text);
  await db.update(profiles).set({ resumeKey: key, resumeUploadedAt: new Date(), parsedBy: parsed.parsedBy, updatedAt: new Date() }).where(eq(profiles.userId, p.userId));
  return Response.json({ parsed });
}

/** Download your own resume (decrypted). */
export async function GET() {
  const s = await getSession();
  if (!s) return Response.json({ error: "Sign in first" }, { status: 401 });
  const [p] = await db.select().from(profiles).where(eq(profiles.userId, s.user.id));
  if (!p?.resumeKey) return Response.json({ error: "No resume on file" }, { status: 404 });
  const { getResume } = await import("@/lib/storage");
  const pdf = await getResume(p.resumeKey);
  return new Response(new Uint8Array(pdf), { headers: { "content-type": "application/pdf", "content-disposition": 'attachment; filename="my-resume.pdf"', "cache-control": "no-store" } });
}
