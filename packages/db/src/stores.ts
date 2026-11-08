import type { DomainState, DomainStateStore, Provider, UsageEntry, UsageLedger } from "@job-radar/core";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

type Db = NodePgDatabase<typeof schema>;
const d = (n?: number) => (n === undefined ? null : new Date(n));

/** Persists per-domain throttle/backoff/robots state so every worker (and restarts) share it. */
export class DbDomainStateStore implements DomainStateStore {
  constructor(private db: Db) {}
  async get(domain: string): Promise<DomainState | undefined> {
    const [r] = await this.db.select().from(schema.domainState).where(eq(schema.domainState.domain, domain));
    if (!r) return undefined;
    return {
      domain,
      lastRequestAt: r.lastRequestAt?.getTime(),
      consecutiveErrors: r.consecutiveErrors,
      blockedUntil: r.blockedUntil?.getTime(),
      robotsTxt: r.robotsTxt,
      robotsFetchedAt: r.robotsFetchedAt?.getTime(),
    };
  }
  async set(s: DomainState): Promise<void> {
    const v = {
      domain: s.domain,
      lastRequestAt: d(s.lastRequestAt),
      consecutiveErrors: s.consecutiveErrors,
      blockedUntil: d(s.blockedUntil),
      robotsTxt: s.robotsTxt ?? null,
      robotsFetchedAt: d(s.robotsFetchedAt),
      updatedAt: new Date(),
    };
    await this.db.insert(schema.domainState).values(v).onConflictDoUpdate({ target: schema.domainState.domain, set: v });
  }
}

/** Budget ledger backed by provider_usage. */
export class DbUsageLedger implements UsageLedger {
  constructor(private db: Db) {}
  async sum(provider: Provider, from: Date, to: Date): Promise<number> {
    const [r] = await this.db
      .select({ s: sql<number>`coalesce(sum(${schema.providerUsage.units}), 0)::float` })
      .from(schema.providerUsage)
      .where(and(eq(schema.providerUsage.provider, provider), gte(schema.providerUsage.at, from), lt(schema.providerUsage.at, to)));
    return Number(r?.s ?? 0);
  }
  async record(e: UsageEntry): Promise<void> {
    await this.db.insert(schema.providerUsage).values({
      provider: e.provider,
      at: e.at,
      units: e.units,
      task: e.task,
      jobId: e.jobId ?? null,
      companyId: e.companyId ?? null,
      url: e.url ?? null,
    });
  }
}
