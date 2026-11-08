import { migrate } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";
import { createDb, sql } from "./index";
import { loadRootEnv } from "./load-env";

loadRootEnv();
// Migrations need a direct (non-pooled) connection: PgBouncer transaction mode drops session state.
const { db, pool } = createDb(process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL);
await db.execute(sql`create extension if not exists vector`);
await migrate(db, { migrationsFolder: fileURLToPath(new URL("../migrations", import.meta.url)) });
console.log("migrations applied");
await pool.end();
