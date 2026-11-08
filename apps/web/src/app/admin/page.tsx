"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";
import { ago, cn } from "@/lib/utils";
import { LiveCrawlRuns } from "@/components/live-crawl-runs";
import { useTRPC } from "@/trpc/client";

function Meter({ value, max, alert }: { value: number; max: number; alert?: boolean }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="mt-2 h-2 w-full rounded-full bg-muted" role="meter" aria-valuenow={value} aria-valuemax={max}>
      <div className={cn("h-2 rounded-full", alert ? "bg-bad" : pct > 60 ? "bg-warn" : "bg-ok")} style={{ width: `${pct}%` }} />
    </div>
  );
}

export default function Health() {
  const trpc = useTRPC();
  const { data: h, isLoading, error } = useQuery({ ...trpc.admin.health.queryOptions(), refetchInterval: 30_000 });
  if (isLoading) return <p className="text-muted-foreground">Loading…</p>;
  if (error || !h) return <p className="text-bad">{error?.message}</p>;
  const count = (status: string, eligible?: boolean) => h.statusCounts.filter((s) => s.status === status && (eligible === undefined || s.eligible === eligible)).reduce((a, s) => a + s.n, 0);
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardTitle>Coverage (crawled OK in 48h)</CardTitle>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{(h.coverage.pct * 100).toFixed(0)}%</p>
          <p className="text-xs text-muted-foreground">{h.coverage.ok48}/{h.coverage.total} companies · {h.coverage.unknownAts} need ATS detection · {h.coverage.excluded} excluded</p>
        </Card>
        <Card>
          <CardTitle>Verified open (eligible, &lt;36h)</CardTitle>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{h.verifiedOpen36h}</p>
          <p className="text-xs text-muted-foreground">open {count("open", true)} · pending {count("pending")} · unknown {count("unknown")} · closed {count("closed")}</p>
        </Card>
        <Card>
          <CardTitle>False-open rate (30d audit)</CardTitle>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{h.falseOpen.last30d === null ? "–" : `${(h.falseOpen.last30d * 100).toFixed(1)}%`}</p>
          <p className="text-xs text-muted-foreground">{h.falseOpen.samples} audited · target &lt; 2%</p>
        </Card>
        <Card>
          <CardTitle>AI on job text (24h) · {h.ai.provider}</CardTitle>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{h.ai.enabled ? `${h.ai.usedToday}/${h.ai.dailyBudget}` : "off"}</p>
          <Meter value={h.ai.usedToday} max={h.ai.dailyBudget} alert={h.ai.usedToday >= 0.8 * h.ai.dailyBudget} />
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {h.providers.map((p) => (
          <Card key={p.name} className={cn(p.alert && "border-bad")}>
            <div className="flex items-center justify-between">
              <CardTitle>{p.name} ({p.unit}) — this month</CardTitle>
              {!p.enabled ? <Badge>not configured</Badge> : p.alert ? <Badge tone="bad">≥ 80% used</Badge> : <Badge tone="ok">ok</Badge>}
            </div>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{p.usedMonth.toFixed(p.unit === "USD" ? 2 : 0)} / {p.cap}</p>
            <Meter value={p.usedMonth} max={p.cap} alert={p.alert} />
            <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
              <div><dt className="text-muted-foreground">Today</dt><dd className="tabular-nums">{p.usedToday.toFixed(2)} / {p.dailyAllowance.toFixed(2)}</dd></div>
              <div><dt className="text-muted-foreground">Days left</dt><dd className="tabular-nums">{p.daysLeft}</dd></div>
              <div><dt className="text-muted-foreground">Projected month-end</dt><dd className={cn("tabular-nums", p.projectedMonthEnd > p.cap && "text-bad")}>{p.projectedMonthEnd.toFixed(p.unit === "USD" ? 2 : 0)}</dd></div>
            </dl>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>Failing adapters</CardTitle>
          <div className="mt-2 flex flex-wrap gap-2">{h.adapterFailures.length ? h.adapterFailures.map((a) => <Badge key={a.ats} tone="bad">{a.ats}: {a.failing}</Badge>) : <span className="text-sm text-muted-foreground">none</span>}</div>
          <ul className="mt-3 divide-y text-sm">
            {h.failing.slice(0, 15).map((c) => (
              <li key={c.id} className="py-2">
                <div className="flex justify-between gap-2"><Link className="font-medium hover:underline" href={`/admin/companies?q=${encodeURIComponent(c.name)}`}>{c.name}</Link><span className="text-xs text-muted-foreground">{c.ats} · {c.fails}× · {ago(c.lastCrawledAt)}</span></div>
                {c.error && <p className="truncate text-xs text-muted-foreground" title={c.error}>{c.error}</p>}
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardTitle>Blocked domains (circuit open)</CardTitle>
          <ul className="mt-2 divide-y text-sm">
            {h.blockedDomains.length ? h.blockedDomains.map((d) => <li key={d.domain} className="flex justify-between py-2"><span>{d.domain}</span><span className="text-xs text-muted-foreground">until {d.blockedUntil ? new Date(d.blockedUntil).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "?"} · {d.consecutiveErrors} errors</span></li>) : <li className="py-2 text-muted-foreground">none</li>}
          </ul>
          <CardTitle className="mt-4">False-open by ATS</CardTitle>
          <ul className="mt-2 text-sm">
            {h.falseOpen.perAts.map((a) => <li key={a.ats} className="flex justify-between py-1"><span>{a.ats}</span><span className="tabular-nums">{((a.falseOpenRate ?? 0) * 100).toFixed(1)}% of {a.sampleSize}{a.requireS3 && <Badge tone="warn" className="ml-2">S3 required</Badge>}</span></li>)}
          </ul>
        </Card>
      </div>

      <LiveCrawlRuns />
    </div>
  );
}
