import "server-only";
import { eq, profiles } from "@job-radar/db";
import { db } from "./db";

export const CONSENT_VERSION = "2026-11-08";
export const CONSENT_PURPOSES = ["match jobs to your resume", "verify job links", "send job alerts you opt into"];

/** One profile row per Neon Auth user, created on first visit. */
export async function ensureProfile(user: { id: string; email: string; name?: string | null }) {
  const [p] = await db.select().from(profiles).where(eq(profiles.userId, user.id));
  if (p) return p;
  const [created] = await db.insert(profiles).values({ userId: user.id, email: user.email, name: user.name || null }).onConflictDoNothing().returning();
  return created ?? (await db.select().from(profiles).where(eq(profiles.userId, user.id)))[0]!;
}

export type ProfileRow = Awaited<ReturnType<typeof ensureProfile>>;

/** Where a signed-in user should be right now. */
export function nextStep(p: ProfileRow): "/onboarding" | "/feed" {
  return p.consentAt && !p.consentWithdrawnAt && p.onboardedAt ? "/feed" : "/onboarding";
}
