import FirecrawlApp from "@mendable/firecrawl-js";
import type { ApifyAtsInput, ApifyLike, FirecrawlLike } from "@job-radar/core";
import { ApifyClient } from "apify-client";
import { env } from "./env";

/** Firecrawl free plan: 1,000 credits/month, 2 concurrent. Only ever called through the BudgetRouter. */
export function makeFirecrawl(): FirecrawlLike | undefined {
  if (!env.FIRECRAWL_API_KEY) return undefined;
  const app = new FirecrawlApp({ apiKey: env.FIRECRAWL_API_KEY });
  return {
    async scrape(url, opts) {
      const res = await app.scrapeUrl(url, {
        formats: opts.formats,
        ...(opts.jsonSchema ? { jsonOptions: { schema: opts.jsonSchema } } : {}),
        timeout: 30_000,
      } as Parameters<typeof app.scrapeUrl>[1]);
      if (!res.success) {
        const err = Object.assign(new Error(`firecrawl: ${res.error}`), { status: (res as { statusCode?: number }).statusCode });
        throw err;
      }
      const md = res.metadata as { statusCode?: number; url?: string; sourceURL?: string } | undefined;
      return {
        markdown: res.markdown,
        rawHtml: res.rawHtml,
        links: res.links,
        json: (res as { json?: unknown }).json,
        statusCode: md?.statusCode,
        finalUrl: md?.url ?? md?.sourceURL,
        creditsUsed: opts.formats.includes("json") ? 5 : 1,
      };
    },
  };
}

/** Apify free plan ($5/month): a pay-per-result ATS actor for tenants that block our own adapter. */
export function makeApify(): ApifyLike | undefined {
  if (!env.APIFY_TOKEN || !env.APIFY_ATS_ACTOR_ID) return undefined;
  const client = new ApifyClient({ token: env.APIFY_TOKEN });
  return {
    async runAtsActor(input: ApifyAtsInput) {
      const run = await client.actor(env.APIFY_ATS_ACTOR_ID!).call(input, { waitSecs: 600, memory: 1024 });
      const { items } = await client.dataset(run.defaultDatasetId).listItems({ limit: input.maxJobsPerCompany * Math.max(1, input.queries.length) });
      // Re-read the run: usage is final only after it finishes.
      const final = await client.run(run.id).get();
      return { items, usageTotalUsd: Number((final as { usageTotalUsd?: number } | undefined)?.usageTotalUsd ?? 0) };
    },
  };
}
