import { defineConfig } from "@neon/config/v1";

/**
 * Neon services for Job Radar (branch `production`). Apply with `neon deploy`.
 * - Postgres: the app database (pooled DATABASE_URL for app traffic; DATABASE_URL_UNPOOLED for
 *   migrations and pg-boss, which needs session-level advisory locks).
 * - Auth: Managed Better Auth (email OTP + Google) used by apps/web.
 * - AI Gateway: job-text enrichment from the worker (public job postings only).
 * - Functions: `jobstats`, a small read-only JSON API next to the database.
 * - Realtime: live admin views (crawl runs) without polling.
 */
export default defineConfig({
  preview: {
    realtime: {
      // Every browser origin that subscribes to live queries.
      allowedOrigins: ["http://localhost:3000", "https://localhost:3000", "https://jobradar-in.duckdns.org"],
    },
  },
  auth: true,
  aiGateway: true,
  functions: {
    jobstats: { name: "Job Radar stats", source: "./packages/db/src/functions/jobstats.ts" },
  },
  // Branch policy: per-branch tuning
  branch: (branch) => {
    if (branch.isDefault) return {};
    // New non-default branches (previews, experiments) auto-expire.
    if (!branch.exists) return { ttl: "7d" };
    return {};
  },
});
