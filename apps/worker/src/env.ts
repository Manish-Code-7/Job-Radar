import { loadRootEnv } from "@job-radar/db";
import { z } from "zod";

loadRootEnv();

const num = (d: number) => z.coerce.number().default(d);

const Env = z.object({
  DATABASE_URL: z.string().optional(),
  /** Direct (non-pooled) URL: pg-boss uses advisory locks/session state that PgBouncer transaction mode breaks. */
  DATABASE_URL_UNPOOLED: z.string().optional(),
  WORKER_NAME: z.enum(["oracle", "gha", "fallback"]).default("oracle"),
  CRAWL_CONTACT_URL: z.string().default("https://github.com/job-radar/job-radar#crawler"),
  /** Neon AI Gateway (preferred when set; pulled by `neon deploy`). Needs prepaid gateway credits. */
  NEON_AI_GATEWAY_TOKEN: z.string().optional(),
  NEON_AI_GATEWAY_BASE_URL: z.string().optional(),
  AI_GATEWAY_MODEL: z.string().default("gemini-3-5-flash-lite"),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default("gemini-2.5-flash-lite"),
  GEMINI_DAILY_REQUESTS: num(200),
  GEMINI_RPM: num(10),
  OLLAMA_URL: z.string().default("http://localhost:11434"),
  FIRECRAWL_API_KEY: z.string().optional(),
  FIRECRAWL_MONTHLY_CREDITS: num(1000),
  APIFY_TOKEN: z.string().optional(),
  APIFY_ATS_ACTOR_ID: z.string().optional(),
  APIFY_MONTHLY_USD: num(5),
  /** GitHub Actions pool: post results to the web app instead of writing to Postgres. */
  INGEST_URL: z.string().optional(),
  INGEST_TOKEN: z.string().optional(),
  EMBEDDINGS: z.enum(["on", "off"]).default("on"),
  EMBEDDING_MODEL: z.string().default("Xenova/bge-small-en-v1.5"),
  BROWSER_CONCURRENCY: num(3),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  ADMIN_TELEGRAM_CHAT_ID: z.string().optional(),
});

export type WorkerEnv = z.infer<typeof Env>;
export const env: WorkerEnv = Env.parse(process.env);
