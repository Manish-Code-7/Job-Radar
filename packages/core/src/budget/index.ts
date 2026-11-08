/**
 * Budget router: the one place that decides whether a paid-but-free-tier provider may be used
 * for a task, and walks the escalation chain (own HTTP → own Playwright → Firecrawl/Apify → Jina → unknown).
 */

export type Provider = "firecrawl" | "apify";

/** 1 = most important. */
export enum Priority {
  UserTriggered = 1, // Apply click, "Link not working?"
  ShownJobVerify = 2, // verifying jobs already shown to users
  BlockedHighPriorityTenant = 3,
  Onboarding = 4,
  Other = 5,
}

/** Share of *today's* allowance each priority may consume. P1 may also borrow from the rest of the month. */
export const PRIORITY_SHARE: Record<Priority, number> = {
  [Priority.UserTriggered]: 1,
  [Priority.ShownJobVerify]: 1,
  [Priority.BlockedHighPriorityTenant]: 0.7,
  [Priority.Onboarding]: 0.5,
  [Priority.Other]: 0.3,
};

export interface UsageEntry {
  provider: Provider;
  at: Date;
  units: number;
  task: string;
  jobId?: string | null;
  companyId?: string | null;
  url?: string | null;
}

export interface UsageLedger {
  sum(provider: Provider, from: Date, to: Date): Promise<number>;
  record(e: UsageEntry): Promise<void>;
}

export class MemoryLedger implements UsageLedger {
  entries: UsageEntry[] = [];
  async sum(p: Provider, from: Date, to: Date) {
    return this.entries.filter((e) => e.provider === p && e.at >= from && e.at < to).reduce((a, e) => a + e.units, 0);
  }
  async record(e: UsageEntry) {
    this.entries.push(e);
  }
}

/* ------------------------------ Allowance maths ------------------------------ */
/** Month boundaries in IST (the product's timezone). */
const IST_OFFSET_MS = 5.5 * 3600_000;

export function istParts(now: Date) {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  return { y: ist.getUTCFullYear(), m: ist.getUTCMonth(), d: ist.getUTCDate() };
}
export function istMidnight(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m, d) - IST_OFFSET_MS);
}
export function monthWindow(now: Date) {
  const { y, m, d } = istParts(now);
  const monthStart = istMidnight(y, m, 1);
  const nextMonth = istMidnight(y, m + 1, 1);
  const dayStart = istMidnight(y, m, d);
  const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const daysLeft = daysInMonth - d + 1; // including today
  return { monthStart, nextMonth, dayStart, daysLeft, daysInMonth };
}

export interface Allowance {
  cap: number;
  usedMonth: number;
  usedToday: number;
  remainingMonth: number;
  daysLeft: number;
  /** Today's allowance = (cap − used before today) / days left incl. today. Unused days roll over. */
  dailyAllowance: number;
  remainingToday: number;
  pctUsed: number;
  /** Straight-line projection of month-end usage from the month-to-date burn rate. */
  projectedMonthEnd: number;
}

export function computeAllowance(cap: number, usedMonth: number, usedToday: number, now: Date): Allowance {
  const w = monthWindow(now);
  const usedBeforeToday = usedMonth - usedToday;
  const dailyAllowance = Math.max(0, (cap - usedBeforeToday) / w.daysLeft);
  const remainingMonth = Math.max(0, cap - usedMonth);
  const elapsedDays = (now.getTime() - w.monthStart.getTime()) / 864e5;
  return {
    cap,
    usedMonth,
    usedToday,
    remainingMonth,
    daysLeft: w.daysLeft,
    dailyAllowance,
    remainingToday: Math.max(0, Math.min(remainingMonth, dailyAllowance - usedToday)),
    pctUsed: cap > 0 ? usedMonth / cap : 1,
    projectedMonthEnd: elapsedDays > 0.25 ? (usedMonth / elapsedDays) * w.daysInMonth : usedMonth,
  };
}

/** Pure decision: may a task of this priority spend `units` now? */
export function canSpend(a: Allowance, units: number, priority: Priority): { ok: boolean; reason: string } {
  if (a.usedMonth + units > a.cap) return { ok: false, reason: "monthly cap reached" };
  if (priority === Priority.UserTriggered) return { ok: true, reason: "user-triggered (may borrow from month)" };
  const share = PRIORITY_SHARE[priority];
  const limit = a.dailyAllowance * share;
  if (a.usedToday + units > limit) {
    return { ok: false, reason: `daily allowance for P${priority} exhausted (${a.usedToday.toFixed(2)}/${limit.toFixed(2)})` };
  }
  return { ok: true, reason: "within daily allowance" };
}

/** When the budget is short, order a batch so the most important work gets the units first. */
export function prioritize<T extends { priority: Priority; createdAt?: Date }>(tasks: T[]): T[] {
  return [...tasks].sort(
    (a, b) => a.priority - b.priority || (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0),
  );
}

/* ------------------------------ Concurrency + cache ------------------------------ */
export class Semaphore {
  private waiters: (() => void)[] = [];
  private active = 0;
  constructor(private readonly max: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>((r) => this.waiters.push(r));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.waiters.shift()?.();
    }
  }
}

export interface ResultCache {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttlMs: number): Promise<void>;
}
export class MemoryResultCache implements ResultCache {
  private m = new Map<string, { v: unknown; exp: number }>();
  constructor(private now: () => number = Date.now) {}
  async get<T>(k: string) {
    const e = this.m.get(k);
    if (!e || e.exp < this.now()) return undefined;
    return e.v as T;
  }
  async set<T>(k: string, v: T, ttl: number) {
    this.m.set(k, { v, exp: this.now() + ttl });
  }
}

/* ------------------------------ The router ------------------------------ */
export interface BudgetConfig {
  caps: Record<Provider, number>; // firecrawl: credits, apify: USD
  concurrency?: Partial<Record<Provider, number>>;
  alertPct?: number;
}

export interface SpendRequest<T> {
  provider: Provider;
  /** Estimated units before the call (used for the allowance check). */
  estimate: number;
  priority: Priority;
  task: string;
  cacheKey?: string;
  jobId?: string | null;
  companyId?: string | null;
  url?: string | null;
  /** Performs the call. Returns the value and the units actually charged (e.g. Apify usageTotalUsd). */
  call: () => Promise<{ value: T; units: number }>;
}

export type SpendOutcome<T> =
  | { status: "ok"; value: T; units: number; cached: boolean }
  | { status: "denied"; reason: string }
  | { status: "failed"; error: string };

export const SAME_URL_TTL_MS = 6 * 3600_000;

export class BudgetRouter {
  private sems: Record<Provider, Semaphore>;
  private cache: ResultCache;
  constructor(
    private cfg: BudgetConfig,
    private ledger: UsageLedger,
    opts: { cache?: ResultCache; now?: () => Date; sleep?: (ms: number) => Promise<void>; onAlert?: (p: Provider, a: Allowance) => void } = {},
  ) {
    this.now = opts.now ?? (() => new Date());
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.cache = opts.cache ?? new MemoryResultCache(() => this.now().getTime());
    this.onAlert = opts.onAlert;
    this.sems = {
      firecrawl: new Semaphore(cfg.concurrency?.firecrawl ?? 2),
      apify: new Semaphore(cfg.concurrency?.apify ?? 1),
    };
  }
  private now: () => Date;
  private sleep: (ms: number) => Promise<void>;
  private onAlert?: (p: Provider, a: Allowance) => void;
  private alerted = new Set<string>();

  async allowance(p: Provider): Promise<Allowance> {
    const now = this.now();
    const w = monthWindow(now);
    const [usedMonth, usedToday] = await Promise.all([
      this.ledger.sum(p, w.monthStart, w.nextMonth),
      this.ledger.sum(p, w.dayStart, w.nextMonth),
    ]);
    return computeAllowance(this.cfg.caps[p], usedMonth, usedToday, now);
  }

  async spend<T>(req: SpendRequest<T>): Promise<SpendOutcome<T>> {
    if (!(this.cfg.caps[req.provider] > 0)) return { status: "denied", reason: `${req.provider} not configured` };
    if (req.cacheKey) {
      const hit = await this.cache.get<T>(`${req.provider}:${req.cacheKey}`);
      if (hit !== undefined) return { status: "ok", value: hit, units: 0, cached: true };
    }
    return this.sems[req.provider].run(async () => {
      const a = await this.allowance(req.provider);
      const d = canSpend(a, req.estimate, req.priority);
      if (!d.ok) return { status: "denied", reason: d.reason } as const;
      let lastErr = "";
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const { value, units } = await req.call();
          await this.ledger.record({
            provider: req.provider,
            at: this.now(),
            units,
            task: req.task,
            jobId: req.jobId,
            companyId: req.companyId,
            url: req.url,
          });
          if (req.cacheKey) await this.cache.set(`${req.provider}:${req.cacheKey}`, value, SAME_URL_TTL_MS);
          await this.maybeAlert(req.provider);
          return { status: "ok", value, units, cached: false } as const;
        } catch (e) {
          lastErr = (e as Error).message;
          const status = (e as { status?: number; statusCode?: number }).status ?? (e as { statusCode?: number }).statusCode;
          if (status !== 429) break;
          await this.sleep(2000 * 2 ** attempt);
        }
      }
      // Cache the failure too, so we never burn credits on the same URL again within 6h.
      if (req.cacheKey) await this.cache.set(`${req.provider}:${req.cacheKey}:failed`, true, SAME_URL_TTL_MS);
      return { status: "failed", error: lastErr } as const;
    });
  }

  async recentlyFailed(p: Provider, key: string): Promise<boolean> {
    return (await this.cache.get<boolean>(`${p}:${key}:failed`)) === true;
  }

  private async maybeAlert(p: Provider) {
    const a = await this.allowance(p);
    const pct = this.cfg.alertPct ?? 0.8;
    const { y, m } = istParts(this.now());
    const key = `${p}:${y}-${m}`;
    if (a.pctUsed >= pct && !this.alerted.has(key)) {
      this.alerted.add(key);
      this.onAlert?.(p, a);
    }
  }
}

/* ------------------------------ Escalation chains ------------------------------ */
export interface ChainStep<T> {
  name: string;
  run: () => Promise<T | null>;
}

export interface ChainAttempt {
  step: string;
  outcome: "ok" | "null" | "error" | "denied";
  detail?: string;
}

export class DeniedError extends Error {}

/** Try each step in order; a step returning null or throwing passes to the next. */
export async function runChain<T>(steps: ChainStep<T>[]): Promise<{ value: T | null; via?: string; attempts: ChainAttempt[] }> {
  const attempts: ChainAttempt[] = [];
  for (const s of steps) {
    try {
      const v = await s.run();
      if (v !== null && v !== undefined) {
        attempts.push({ step: s.name, outcome: "ok" });
        return { value: v, via: s.name, attempts };
      }
      attempts.push({ step: s.name, outcome: "null" });
    } catch (e) {
      attempts.push({ step: s.name, outcome: e instanceof DeniedError ? "denied" : "error", detail: (e as Error).message });
    }
  }
  return { value: null, attempts };
}

/** Wrap a budgeted call as a chain step (denied → DeniedError so the chain records it and moves on). */
export function budgetedStep<T>(router: BudgetRouter, name: string, req: SpendRequest<T>): ChainStep<T> {
  return {
    name,
    async run() {
      if (req.cacheKey && (await router.recentlyFailed(req.provider, req.cacheKey))) {
        throw new DeniedError("failed within 6h; not retrying");
      }
      const r = await router.spend(req);
      if (r.status === "denied") throw new DeniedError(r.reason);
      if (r.status === "failed") throw new Error(r.error);
      return r.value;
    },
  };
}
