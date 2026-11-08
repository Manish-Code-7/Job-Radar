import "server-only";
import { createDb, type Db } from "@job-radar/db";

const g = globalThis as unknown as { __jrDb?: Db };
export const db: Db = g.__jrDb ?? createDb(process.env.DATABASE_URL, 5).db;
if (process.env.NODE_ENV !== "production") g.__jrDb = db;
