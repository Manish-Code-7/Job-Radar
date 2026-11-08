import { eq, profiles } from "@job-radar/db";
import { randomUUID } from "node:crypto";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { ensureProfile } from "@/lib/profile";
import { docxToText, isDocx, isPdf, parseResume, pdfToText } from "@/lib/resume";
import { deleteResume, putResume } from "@/lib/storage";

export const runtime = "nodejs";
const MAX_BYTES = 10 * 1024 * 1024;

/** Log every rejected upload with its reason (no file contents, no names), so failures are diagnosable. */
function reject(userId: string, status: number, reason: string, error: string) {
  console.warn(JSON.stringify({ t: new Date().toISOString(), msg: "resume upload rejected", userId, status, reason }));
  return Response.json({ error }, { status });
}

/** Upload a resume PDF: encrypt → R2, extract text, parse locally, return the draft for the user to review. */
export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return Response.json({ error: "Sign in first" }, { status: 401 });
  const p = await ensureProfile(s.user);
  if (!p.consentAt || p.consentWithdrawnAt) return Response.json({ error: "Please accept the data notice first." }, { status: 412 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("resume");
  if (!(file instanceof File)) return reject(p.userId, 400, "no file", "Choose your resume file (PDF or Word).");
  if (file.size === 0) return reject(p.userId, 400, "empty file", "That file is empty. Try exporting your resume again.");
  if (file.size > MAX_BYTES) return reject(p.userId, 413, `too large ${file.size}`, "That file is over 10 MB. Export a smaller PDF (without large images) and try again.");
  const buf = Buffer.from(await file.arrayBuffer());

  let text: string;
  let kind: "pdf" | "docx";
  if (isPdf(buf)) {
    kind = "pdf";
    try {
      text = await pdfToText(buf);
    } catch (e) {
      return reject(p.userId, 422, `pdf parse: ${(e as Error).message.slice(0, 120)}`, "We couldn't read that PDF. If it's password-protected, remove the password and try again.");
    }
  } else if (isDocx(buf)) {
    kind = "docx";
    try {
      text = docxToText(buf);
    } catch (e) {
      return reject(p.userId, 422, `docx parse: ${(e as Error).message.slice(0, 120)}`, "We couldn't read that Word file. Save it as PDF and try again.");
    }
  } else {
    const ext = file.name.split(".").pop()?.toLowerCase();
    return reject(p.userId, 415, `unsupported type ${file.type || "?"} .${ext ?? "?"}`, ext === "doc" ? "Old .doc files aren't supported. Save it as PDF or .docx and try again." : "Please upload a PDF or Word (.docx) file.");
  }
  if (text.replace(/\s/g, "").length < 200) {
    return reject(p.userId, 422, `too little text (${kind}, ${text.replace(/\s/g, "").length} chars)`, "We couldn't find text in this file. It may be a scanned image. Upload a text-based PDF, or fill in your details by hand below.");
  }

  const key = `resumes/${p.userId}/${randomUUID()}.${kind}.enc`;
  try {
    await putResume(key, buf);
  } catch (e) {
    return reject(p.userId, 503, `storage: ${(e as Error).message.slice(0, 120)}`, "We couldn't save your resume right now. Please try again in a minute.");
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
  const docx = p.resumeKey.includes(".docx.");
  return new Response(new Uint8Array(pdf), {
    headers: {
      "content-type": docx ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "application/pdf",
      "content-disposition": `attachment; filename="my-resume.${docx ? "docx" : "pdf"}"`,
      "cache-control": "no-store",
    },
  });
}
