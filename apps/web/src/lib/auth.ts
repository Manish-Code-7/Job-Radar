import "server-only";
import { createNeonAuth } from "@neon/auth/next/server";
import { env, isAdminEmail } from "./env";

/**
 * Neon Auth (Managed Better Auth). Users and sessions live in the `neon_auth` schema of our Neon
 * branch; Neon sends the OTP emails. This app only proxies /api/auth/* and reads the session.
 */
let instance: ReturnType<typeof createNeonAuth> | undefined;

/** Created on first use, so `next build` without secrets (Docker) still works. */
export function neonAuth() {
  instance ??= createNeonAuth({
    baseUrl: env.NEON_AUTH_BASE_URL,
    cookies: { secret: env.NEON_AUTH_COOKIE_SECRET },
  });
  return instance;
}

export async function getSession() {
  const { data } = await neonAuth().getSession();
  return data?.user ? data : null;
}

export async function requireAdmin() {
  const s = await getSession();
  return s && isAdminEmail(s.user.email) ? s : null;
}
