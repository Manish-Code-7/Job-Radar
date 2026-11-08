import { consentRecords, eq, matches, profiles } from "@job-radar/db";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";

/** Data export (DPDP right to access): everything we hold about the signed-in user, as JSON. */
export async function GET() {
  const s = await getSession();
  if (!s) return Response.json({ error: "Sign in first" }, { status: 401 });
  const [p] = await db.select().from(profiles).where(eq(profiles.userId, s.user.id));
  const consents = await db.select().from(consentRecords).where(eq(consentRecords.userId, s.user.id));
  const m = await db.select().from(matches).where(eq(matches.userId, s.user.id));
  const { embedding: _e, ...profile } = p ?? ({} as Record<string, unknown>);
  const body = {
    exportedAt: new Date().toISOString(),
    account: { id: s.user.id, email: s.user.email, name: s.user.name },
    profile,
    consentHistory: consents,
    matches: m.map(({ userId: _u, ...r }) => r),
    note: "Your resume file is stored encrypted. Download it from Settings, or ask us for a copy.",
  };
  return new Response(JSON.stringify(body, null, 2), {
    headers: { "content-type": "application/json", "content-disposition": `attachment; filename="job-radar-data-${new Date().toISOString().slice(0, 10)}.json"`, "cache-control": "no-store" },
  });
}
