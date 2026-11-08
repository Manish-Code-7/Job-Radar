"use client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { use } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { ago } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";

export default function JobInspector({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const trpc = useTRPC();
  const { data, isLoading, refetch } = useQuery(trpc.admin.job.queryOptions({ id }));
  const recheck = useMutation(trpc.admin.recheckJob.mutationOptions({ onSuccess: () => setTimeout(() => refetch(), 8000) }));
  if (isLoading || !data) return <p className="text-muted-foreground">Loading…</p>;
  const { job: j, company: c, checks, audits } = data;
  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-start gap-2">
          <div>
            <h1 className="text-lg font-semibold">{j.title}</h1>
            <p className="text-sm text-muted-foreground">{c.name} · {c.ats} · <a className="underline" href={j.url} target="_blank" rel="noreferrer">{j.url}</a></p>
          </div>
          <div className="ml-auto flex gap-2">
            <Badge tone={j.status === "open" ? "ok" : j.status === "closed" ? "bad" : "warn"}>{j.status}</Badge>
            <Button size="sm" onClick={() => recheck.mutate({ id })} disabled={recheck.isPending}>{recheck.isSuccess ? "Re-check queued" : "Re-check now"}</Button>
          </div>
        </div>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
          <div><dt className="text-muted-foreground">Eligible (0–2y)</dt><dd>{j.freshersEligible ? "yes" : `no — ${j.rejectReasons.join("; ")}`}</dd></div>
          <div><dt className="text-muted-foreground">Experience</dt><dd>{j.minYears ?? "?"}–{j.maxYears ?? "?"} yrs {j.expText && <span className="text-muted-foreground">(“{j.expText}”)</span>}</dd></div>
          <div><dt className="text-muted-foreground">Seniority · track</dt><dd>{j.seniority} · {j.track}</dd></div>
          <div><dt className="text-muted-foreground">Location</dt><dd>{j.cities.join(", ") || "–"} · {j.workplace}{j.remoteIndia && " (remote India)"}</dd></div>
          <div><dt className="text-muted-foreground">Salary</dt><dd>{j.salaryText ?? "not stated"}</dd></div>
          <div><dt className="text-muted-foreground">Seen</dt><dd>first {ago(j.firstSeenAt)} · last {ago(j.lastSeenAt)} · verified {ago(j.lastVerifiedAt)}</dd></div>
          <div className="sm:col-span-3"><dt className="text-muted-foreground">Summary (ours)</dt><dd>{j.summary}</dd></div>
          <div className="sm:col-span-3"><dt className="text-muted-foreground">Skills · flags</dt><dd>{j.skills.join(", ") || "–"} {j.flags.map((f) => <Badge key={f} className="ml-1">{f}</Badge>)}</dd></div>
        </dl>
      </Card>
      <Card>
        <CardTitle>Check history ({checks.length})</CardTitle>
        <ol className="mt-2 divide-y text-sm">
          {checks.map((k) => (
            <li key={k.id} className="py-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={k.verdict === "open" ? "ok" : k.verdict === "closed" ? "bad" : "warn"}>{k.verdict}</Badge>
                <span>{k.kind}</span><span className="text-xs text-muted-foreground">{new Date(k.at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })} · {k.worker} · {k.latencyMs ?? 0}ms</span>
                <span className="text-xs">{k.reason}</span>
              </div>
              <details className="mt-1"><summary className="cursor-pointer text-xs text-muted-foreground">signals</summary><pre className="mt-1 max-h-80 overflow-auto rounded bg-muted p-2 text-xs">{JSON.stringify({ signals: k.signals, attempts: k.attempts, providerUnits: k.providerUnits }, null, 2)}</pre></details>
            </li>
          ))}
        </ol>
      </Card>
      {audits.length > 0 && (
        <Card>
          <CardTitle>Apply-click audits</CardTitle>
          <ul className="mt-2 text-sm">{audits.map((a) => <li key={a.id}>{new Date(a.at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}: {a.outcome}{a.falseOpen && <Badge tone="bad" className="ml-2">false open</Badge>}</li>)}</ul>
        </Card>
      )}
    </div>
  );
}
