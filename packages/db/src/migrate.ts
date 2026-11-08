import { migrate } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";
import { createDb, sql } from "./index";

const { db, pool } = createDb();
await db.execute(sql`create extension if not exists vector`);
await migrate(db, { migrationsFolder: fileURLToPath(new URL("../migrations", import.meta.url)) });
console.log("migrations applied");
await pool.end();
