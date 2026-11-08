import "server-only";
import { account, session, user, verification } from "@job-radar/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { emailOTP } from "better-auth/plugins";
import { headers } from "next/headers";
import { db } from "./db";
import { env, isAdminEmail } from "./env";
import { sendMail } from "./mail";

export const auth = betterAuth({
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  database: drizzleAdapter(db, { provider: "pg", schema: { user, session, account, verification } }),
  socialProviders:
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } } : {},
  plugins: [
    emailOTP({
      otpLength: 6,
      expiresIn: 600,
      async sendVerificationOTP({ email, otp }) {
        await sendMail(email, `Your Job Radar code: ${otp}`, `Your sign-in code is ${otp}. It expires in 10 minutes.\n\nIf you didn't ask for this, ignore this email.`);
      },
    }),
    nextCookies(),
  ],
});

export async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

export async function requireAdmin() {
  const s = await getSession();
  if (!s || !isAdminEmail(s.user.email)) return null;
  return s;
}
