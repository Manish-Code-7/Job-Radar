import "server-only";
export const env = {
  DATABASE_URL: process.env.DATABASE_URL ?? "",
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? "",
  BETTER_AUTH_URL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
  ADMIN_EMAILS: (process.env.ADMIN_EMAILS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
  INGEST_TOKEN: process.env.INGEST_TOKEN ?? "",
  CRAWL_CONTACT_URL: process.env.CRAWL_CONTACT_URL ?? "https://github.com/job-radar/job-radar#crawler",
  SMTP_HOST: process.env.SMTP_HOST,
  SMTP_PORT: Number(process.env.SMTP_PORT ?? 587),
  SMTP_USER: process.env.SMTP_USER,
  SMTP_PASS: process.env.SMTP_PASS,
  SMTP_FROM: process.env.SMTP_FROM ?? "Job Radar <no-reply@jobradar.local>",
  FIRECRAWL_MONTHLY_CREDITS: Number(process.env.FIRECRAWL_MONTHLY_CREDITS ?? 1000),
  APIFY_MONTHLY_USD: Number(process.env.APIFY_MONTHLY_USD ?? 5),
  GEMINI_DAILY_REQUESTS: Number(process.env.GEMINI_DAILY_REQUESTS ?? 200),
  FIRECRAWL_ENABLED: !!process.env.FIRECRAWL_API_KEY,
  APIFY_ENABLED: !!(process.env.APIFY_TOKEN && process.env.APIFY_ATS_ACTOR_ID),
  GEMINI_ENABLED: !!process.env.GEMINI_API_KEY,
};
export const isAdminEmail = (email?: string | null) => !!email && env.ADMIN_EMAILS.includes(email.toLowerCase());
