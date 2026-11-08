import { describe, expect, it } from "vitest";
import {
  BudgetRouter,
  budgetedStep,
  canSpend,
  computeAllowance,
  MemoryLedger,
  monthWindow,
  prioritize,
  Priority,
  runChain,
  type Provider,
} from "../src/budget";
import { parseJina } from "../src/budget/providers";

// 2026-11-08 12:00 IST
const NOV8 = new Date("2026-11-08T06:30:00Z");

describe("allowance maths", () => {
  it("month window in IST (Nov has 30 days; on the 8th, 23 days left incl. today)", () => {
    const w = monthWindow(NOV8);
    expect(w.daysLeft).toBe(23);
    expect(w.monthStart.toISOString()).toBe("2026-10-31T18:30:00.000Z");
    expect(w.dayStart.toISOString()).toBe("2026-11-07T18:30:00.000Z");
  });

  it("daily allowance = remaining / days left", () => {
    const a = computeAllowance(1000, 0, 0, new Date("2026-11-01T06:30:00Z"));
    expect(a.daysLeft).toBe(30);
    expect(a.dailyAllowance).toBeCloseTo(33.33, 2);
    expect(a.remainingToday).toBeCloseTo(33.33, 2);
  });

  it("unused allowance rolls over within the month", () => {
    // 7 days in, only 50 credits used → 950 over 23 days ≈ 41.3/day (more than the flat 33.3)
    const a = computeAllowance(1000, 50, 0, NOV8);
    expect(a.dailyAllowance).toBeCloseTo(950 / 23, 5);
    expect(a.dailyAllowance).toBeGreaterThan(1000 / 30);
  });

  it("today's own spend does not shrink today's allowance base", () => {
    const a = computeAllowance(1000, 60, 10, NOV8);
    expect(a.dailyAllowance).toBeCloseTo(950 / 23, 5);
    expect(a.remainingToday).toBeCloseTo(950 / 23 - 10, 5);
  });

  it("projects month-end usage from the burn rate", () => {
    const a = computeAllowance(1000, 700, 0, new Date("2026-11-15T18:30:00Z")); // 15 days elapsed
    expect(a.projectedMonthEnd).toBeCloseTo(1400, 0);
  });
});

describe("canSpend", () => {
  const a = computeAllowance(1000, 0, 0, new Date("2026-11-01T06:30:00Z")); // 33.3/day

  it("stops at the monthly cap, even for user-triggered work", () => {
    const full = computeAllowance(1000, 1000, 0, NOV8);
    expect(canSpend(full, 1, Priority.UserTriggered).ok).toBe(false);
    expect(canSpend(computeAllowance(1000, 999, 0, NOV8), 1, Priority.UserTriggered).ok).toBe(true);
  });

  it("user-triggered checks may borrow beyond today's allowance", () => {
    const used = computeAllowance(1000, 40, 40, new Date("2026-11-01T06:30:00Z"));
    expect(canSpend(used, 1, Priority.UserTriggered).ok).toBe(true);
    expect(canSpend(used, 1, Priority.ShownJobVerify).ok).toBe(false);
  });

  it("lower priorities get a smaller share of the day", () => {
    const at = (usedToday: number) => computeAllowance(1000, usedToday, usedToday, new Date("2026-11-01T06:30:00Z"));
    // 33.3/day: P5 may use 30% (≈10), P4 50% (≈16.7), P3 70% (≈23.3), P2 100%
    expect(canSpend(at(10), 1, Priority.Other).ok).toBe(false);
    expect(canSpend(at(10), 1, Priority.Onboarding).ok).toBe(true);
    expect(canSpend(at(17), 1, Priority.Onboarding).ok).toBe(false);
    expect(canSpend(at(17), 1, Priority.BlockedHighPriorityTenant).ok).toBe(true);
    expect(canSpend(at(24), 1, Priority.BlockedHighPriorityTenant).ok).toBe(false);
    expect(canSpend(at(24), 1, Priority.ShownJobVerify).ok).toBe(true);
    expect(a.dailyAllowance).toBeCloseTo(33.33, 1);
  });
});

describe("priority ordering when the budget is short", () => {
  it("serves the most important tasks first and denies the rest", async () => {
    const ledger = new MemoryLedger();
    const now = new Date("2026-11-30T06:30:00Z"); // last day of month
    ledger.entries.push({ provider: "firecrawl", at: new Date("2026-11-10T00:00:00Z"), units: 996, task: "old" });
    const router = new BudgetRouter({ caps: { firecrawl: 1000, apify: 5 } }, ledger, { now: () => now });
    const tasks = prioritize([
      { id: "onboard", priority: Priority.Onboarding },
      { id: "other", priority: Priority.Other },
      { id: "click", priority: Priority.UserTriggered },
      { id: "shown-a", priority: Priority.ShownJobVerify },
      { id: "shown-b", priority: Priority.ShownJobVerify },
      { id: "tenant", priority: Priority.BlockedHighPriorityTenant },
    ]);
    expect(tasks.map((t) => t.id)).toEqual(["click", "shown-a", "shown-b", "tenant", "onboard", "other"]);
    const served: string[] = [];
    for (const t of tasks) {
      const r = await router.spend({ provider: "firecrawl", estimate: 1, priority: t.priority, task: t.id, call: async () => ({ value: t.id, units: 1 }) });
      if (r.status === "ok") served.push(t.id);
    }
    // 4 credits left today: P1, P2, P2 fit; P3 may use only 70% of 4 = 2.8 → denied.
    expect(served).toEqual(["click", "shown-a", "shown-b"]);
  });
});

describe("BudgetRouter", () => {
  const mk = (caps: Record<Provider, number> = { firecrawl: 1000, apify: 5 }) => {
    const ledger = new MemoryLedger();
    const alerts: string[] = [];
    const router = new BudgetRouter({ caps }, ledger, { now: () => NOV8, sleep: async () => {}, onAlert: (p) => alerts.push(p) });
    return { ledger, router, alerts };
  };

  it("records actual units (Apify USD from usageTotalUsd)", async () => {
    const { ledger, router } = mk();
    const r = await router.spend({ provider: "apify", estimate: 0.06, priority: Priority.BlockedHighPriorityTenant, task: "list", call: async () => ({ value: [1, 2], units: 0.043 }) });
    expect(r).toMatchObject({ status: "ok", units: 0.043 });
    expect(ledger.entries[0]).toMatchObject({ provider: "apify", units: 0.043, task: "list" });
  });

  it("never spends twice on the same URL within 6h (cache)", async () => {
    const { ledger, router } = mk();
    let calls = 0;
    const req = { provider: "firecrawl" as const, estimate: 1, priority: Priority.ShownJobVerify, task: "verify", cacheKey: "https://x/1", call: async () => (calls++, { value: "page", units: 1 }) };
    await router.spend(req);
    const again = await router.spend(req);
    expect(again).toMatchObject({ status: "ok", cached: true, units: 0 });
    expect(calls).toBe(1);
    expect(ledger.entries).toHaveLength(1);
  });

  it("backs off on 429 without charging, and a failed URL is not retried within 6h", async () => {
    const { ledger, router } = mk();
    let calls = 0;
    const err = Object.assign(new Error("rate limited"), { status: 429 });
    const step = budgetedStep(router, "firecrawl", { provider: "firecrawl", estimate: 1, priority: Priority.ShownJobVerify, task: "verify", cacheKey: "https://x/2", call: async () => { calls++; throw err; } });
    await expect(step.run()).rejects.toThrow("rate limited");
    expect(calls).toBe(3);
    expect(ledger.entries).toHaveLength(0);
    await expect(step.run()).rejects.toThrow(/within 6h/);
    expect(calls).toBe(3);
  });

  it("limits concurrency to the free plan (Firecrawl: 2)", async () => {
    const { router } = mk();
    let active = 0;
    let peak = 0;
    const call = async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return { value: 1, units: 1 };
    };
    await Promise.all(Array.from({ length: 6 }, (_, i) => router.spend({ provider: "firecrawl", estimate: 1, priority: Priority.UserTriggered, task: "t", cacheKey: `u${i}`, call })));
    expect(peak).toBe(2);
  });

  it("alerts once at 80%", async () => {
    const { ledger, router, alerts } = mk();
    ledger.entries.push({ provider: "firecrawl", at: new Date("2026-11-02T00:00:00Z"), units: 799, task: "old" });
    await router.spend({ provider: "firecrawl", estimate: 1, priority: Priority.UserTriggered, task: "a", call: async () => ({ value: 1, units: 1 }) });
    await router.spend({ provider: "firecrawl", estimate: 1, priority: Priority.UserTriggered, task: "b", call: async () => ({ value: 1, units: 1 }) });
    expect(alerts).toEqual(["firecrawl"]);
  });

  it("unconfigured provider (no key → cap 0) is denied", async () => {
    const { router } = mk({ firecrawl: 0, apify: 0 });
    expect((await router.spend({ provider: "firecrawl", estimate: 1, priority: Priority.UserTriggered, task: "x", call: async () => ({ value: 1, units: 1 }) })).status).toBe("denied");
  });
});

describe("escalation chain", () => {
  it("falls back to Jina, then unknown, when credits are exhausted", async () => {
    const ledger = new MemoryLedger();
    ledger.entries.push({ provider: "firecrawl", at: new Date("2026-11-02T00:00:00Z"), units: 1000, task: "old" });
    const router = new BudgetRouter({ caps: { firecrawl: 1000, apify: 5 } }, ledger, { now: () => NOV8 });
    const fc = budgetedStep(router, "firecrawl", { provider: "firecrawl", estimate: 1, priority: Priority.UserTriggered, task: "v", call: async () => ({ value: "fc", units: 1 }) });
    const ownHttp = { name: "http", run: async () => null };
    const ownPw = { name: "playwright", run: async () => { throw new Error("blocked"); } };

    const withJina = await runChain([ownHttp, ownPw, fc, { name: "jina", run: async () => "jina" }]);
    expect(withJina.via).toBe("jina");
    expect(withJina.attempts.map((a) => a.outcome)).toEqual(["null", "error", "denied", "ok"]);

    const jinaDown = await runChain([ownHttp, ownPw, fc, { name: "jina", run: async () => { throw new Error("429"); } }]);
    expect(jinaDown.value).toBeNull(); // caller marks the job `unknown`
  });
});

describe("jina parsing", () => {
  it("reads title, source and upstream warnings", () => {
    const r = parseJina("Title: Oops\nURL Source: https://a/b\nWarning: Target URL returned error 404: Not Found\n\nMarkdown Content:\nNot here");
    expect(r).toMatchObject({ title: "Oops", sourceUrl: "https://a/b", upstreamStatus: 404, markdown: "Not here" });
  });
});
