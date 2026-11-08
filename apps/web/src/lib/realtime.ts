import "server-only";
import { createRealtime, rawSql } from "@neon/realtime/server";
import { env } from "./env";

export interface LiveCrawlRun {
  id: string;
  company: string | null;
  status: string;
  via: string | null;
  worker: string;
  jobs_found: number | null;
  jobs_new: number | null;
  jobs_closed: number | null;
  started_at: string; // ISO text, so server and browser rows have the same shape
}

let server: ReturnType<typeof createRealtime> | undefined;

/** Realtime server (seals queries locally with NEON_REALTIME_SECRET; no network call). */
export function realtime() {
  if (!server) {
    const dbName = new URL(process.env.DATABASE_URL ?? "postgres://x/neondb").pathname.slice(1) || "neondb";
    server = createRealtime({ secret: env.NEON_REALTIME_SECRET, db: dbName });
  }
  return server;
}

/** Admin-only live view: the 25 most recent crawl runs with their company. Read-only, deterministic. */
export function recentCrawlRunsQuery() {
  return rawSql<LiveCrawlRun>(
    `SELECT crawl_runs.id, companies.name AS company, crawl_runs.status, crawl_runs.via, crawl_runs.worker,
            crawl_runs.jobs_found, crawl_runs.jobs_new, crawl_runs.jobs_closed,
            to_char(crawl_runs.started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS started_at
       FROM crawl_runs LEFT JOIN companies ON companies.id = crawl_runs.company_id
      ORDER BY crawl_runs.started_at DESC
      LIMIT 25`,
  );
}
