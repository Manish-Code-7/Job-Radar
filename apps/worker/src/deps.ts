import { BudgetRouter, PoliteFetcher, type BrowserDriver, type Provider } from "@job-radar/core";
import { createDb, DbDomainStateStore, DbUsageLedger, type Db } from "@job-radar/db";
import { GeminiJobAi } from "./ai";
import { PlaywrightDriver } from "./browser";
import { embed } from "./embeddings";
import { env } from "./env";
import { routedHttpClient } from "./http";
import { info, warn } from "./log";
import { makeApify, makeFirecrawl } from "./providers";

export interface Deps {
  db: Db;
  close(): Promise<void>;
  http: PoliteFetcher;
  jinaHttp: PoliteFetcher;
  browser(): BrowserDriver;
  router: BudgetRouter;
  firecrawl: ReturnType<typeof makeFirecrawl>;
  apify: ReturnType<typeof makeApify>;
  ai?: GeminiJobAi;
  embed: typeof embed;
  workerName: "oracle" | "gha" | "fallback";
}

export function makeDeps(opts: { withDb?: boolean } = {}): Deps {
  const { db, pool } = opts.withDb === false ? { db: undefined as unknown as Db, pool: undefined } : createDb(env.DATABASE_URL);
  const store = pool ? new DbDomainStateStore(db) : undefined;
  const http = new PoliteFetcher({
    http: routedHttpClient,
    contactUrl: env.CRAWL_CONTACT_URL,
    store,
    log: (m, meta) => warn(m, meta),
  });
  // r.jina.ai allows ~20 requests/min without a key → ≥3 s spacing.
  const jinaHttp = new PoliteFetcher({ http: routedHttpClient, contactUrl: env.CRAWL_CONTACT_URL, minDelayMs: 3000, maxDelayMs: 3500, respectRobots: false });
  let browser: PlaywrightDriver | undefined;
  const caps: Record<Provider, number> = {
    firecrawl: env.FIRECRAWL_API_KEY ? env.FIRECRAWL_MONTHLY_CREDITS : 0,
    apify: env.APIFY_TOKEN && env.APIFY_ATS_ACTOR_ID ? env.APIFY_MONTHLY_USD : 0,
  };
  const ledger = pool ? new DbUsageLedger(db) : { sum: async () => 0, record: async () => {} };
  const router = new BudgetRouter({ caps, concurrency: { firecrawl: 2, apify: 1 } }, ledger, {
    onAlert: (p, a) => warn("budget alert: provider at ≥80% of monthly cap", { provider: p, used: a.usedMonth, cap: a.cap, projected: a.projectedMonthEnd }),
  });
  return {
    db,
    http,
    jinaHttp,
    browser() {
      browser ??= new PlaywrightDriver(http.userAgent);
      return browser;
    },
    router,
    firecrawl: makeFirecrawl(),
    apify: makeApify(),
    ai: pool ? GeminiJobAi.maybe(db) : undefined,
    embed,
    workerName: env.WORKER_NAME,
    async close() {
      await browser?.close();
      await pool?.end();
      info("deps closed");
    },
  };
}
