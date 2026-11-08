import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

export * from "./schema";
export * from "./stores";
export * from "./ingest";
export { loadRootEnv } from "./load-env";
export { schema };
export { and, asc, desc, eq, gt, gte, ilike, inArray, isNotNull, isNull, lt, lte, ne, not, or, sql } from "drizzle-orm";

export type Db = NodePgDatabase<typeof schema>;

export function createDb(url = process.env.DATABASE_URL, max = 10): { db: Db; pool: pg.Pool } {
  if (!url) throw new Error("DATABASE_URL is not set");
  const pool = new pg.Pool({ connectionString: url, max });
  return { db: drizzle(pool, { schema }), pool };
}
