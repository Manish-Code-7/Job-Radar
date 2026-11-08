import "server-only";
import PgBoss from "pg-boss";

const g = globalThis as unknown as { __boss?: Promise<PgBoss> };

/** Producer-only pg-boss client: the web app enqueues; the worker processes. */
export function boss(): Promise<PgBoss> {
  g.__boss ??= (async () => {
    const b = new PgBoss({ connectionString: process.env.DATABASE_URL!, schema: "pgboss", supervise: false, schedule: false, migrate: false });
    b.on("error", (e) => console.error("pg-boss", e.message));
    await b.start();
    return b;
  })();
  return g.__boss;
}

export async function enqueue(queue: string, data: object, opts: PgBoss.SendOptions = {}) {
  const b = await boss();
  await b.createQueue(queue).catch(() => {});
  return b.send(queue, data, opts);
}
