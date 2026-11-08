import "server-only";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set (run \`neon env pull\` or check .env)`);
  return v;
}

export const env = {
  get NEON_AUTH_BASE_URL() {
    return required("NEON_AUTH_BASE_URL");
  },
  /** Signs the cached session cookie. Not provided by Neon: `openssl rand -base64 32`. */
  get NEON_AUTH_COOKIE_SECRET() {
    return required("NEON_AUTH_COOKIE_SECRET");
  },
  get NEON_REALTIME_URL() {
    return required("NEON_REALTIME_URL");
  },
  get NEON_REALTIME_SECRET() {
    return required("NEON_REALTIME_SECRET");
  },
  ADMIN_EMAILS: (process.env.ADMIN_EMAILS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
  INGEST_TOKEN: process.env.INGEST_TOKEN ?? "",
  CRAWL_CONTACT_URL: process.env.CRAWL_CONTACT_URL ?? "https://github.com/job-radar/job-radar#crawler",
  FIRECRAWL_MONTHLY_CREDITS: Number(process.env.FIRECRAWL_MONTHLY_CREDITS ?? 1000),
  APIFY_MONTHLY_USD: Number(process.env.APIFY_MONTHLY_USD ?? 5),
  GEMINI_DAILY_REQUESTS: Number(process.env.GEMINI_DAILY_REQUESTS ?? 200),
  FIRECRAWL_ENABLED: !!process.env.FIRECRAWL_API_KEY,
  APIFY_ENABLED: !!(process.env.APIFY_TOKEN && process.env.APIFY_ATS_ACTOR_ID),
  AI_ENABLED: !!(process.env.NEON_AI_GATEWAY_TOKEN || process.env.GEMINI_API_KEY),
  AI_PROVIDER: process.env.NEON_AI_GATEWAY_TOKEN ? "Neon AI Gateway" : process.env.GEMINI_API_KEY ? "Gemini free tier" : "off",
};
export const isAdminEmail = (email?: string | null) => !!email && env.ADMIN_EMAILS.includes(email.toLowerCase());
