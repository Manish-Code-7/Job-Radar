import "server-only";
import { createDb, type Db } from "@job-radar/db";

const g = globalThis as unknown as { __jrDb?: Db };

/**
 * Neon Postgres over the pooled URL (PgBouncer) — right for request/response traffic from a
 * long-running Next server. Created lazily on first use, so `next build` (e.g. in Docker, where no
 * secrets exist at build time) never needs DATABASE_URL.
 */
function instance(): Db {
  g.__jrDb ??= createDb(process.env.DATABASE_URL, 5).db;
  return g.__jrDb;
}

export const db: Db = new Proxy({} as Db, {
  get(_t, prop) {
    const real = instance() as unknown as Record<PropertyKey, unknown>;
    const v = real[prop];
    return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(real) : v;
  },
});
