"use client";
import { displayBadge } from "@job-radar/core/display";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ago } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";

const STATUSES = ["", "pending", "open", "changed", "unknown", "closed", "archived"];

export default function Jobs() {
  const trpc = useTRPC();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [eligible, setEligible] = useState<"" | "yes" | "no">("yes");
  const { data, isLoading } = useQuery(trpc.admin.jobs.queryOptions({ q: q || undefined, status: status || undefined, eligible: eligible === "" ? undefined : eligible === "yes" }));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Input className="max-w-sm" placeholder="Title, company or exact URL" value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label="Status" className="h-9 rounded-lg border bg-card px-2 text-sm" value={status} onChange={(e) => setStatus(e.target.value)}>{STATUSES.map((s) => <option key={s} value={s}>{s || "any status"}</option>)}</select>
        <select aria-label="Eligibility" className="h-9 rounded-lg border bg-card px-2 text-sm" value={eligible} onChange={(e) => setEligible(e.target.value as never)}><option value="yes">eligible 0–2y</option><option value="no">not eligible</option><option value="">all</option></select>
      </div>
      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="border-b text-left text-xs text-muted-foreground"><tr><th className="p-2">Job</th><th>Company</th><th>Status</th><th>Badge</th><th>Checked</th><th>Exp</th></tr></thead>
          <tbody className="divide-y">
            {isLoading && <tr><td className="p-2 text-muted-foreground">Loading…</td></tr>}
            {data?.map(({ j, company, ats }) => {
              const b = displayBadge(j.status, j.lastVerifiedAt ? new Date(j.lastVerifiedAt) : null);
              return (
                <tr key={j.id}>
                  <td className="p-2"><Link className="font-medium hover:underline" href={`/admin/jobs/${j.id}`}>{j.title}</Link><div className="text-xs text-muted-foreground">{j.cities.join(", ") || j.workplace} · {j.track}</div></td>
                  <td>{company} <span className="text-xs text-muted-foreground">({ats})</span></td>
                  <td><Badge tone={j.status === "open" ? "ok" : j.status === "closed" ? "bad" : "warn"}>{j.status}</Badge></td>
                  <td>{b.badge === "verified" ? <Badge tone="ok">Verified · {b.hoursAgo}h</Badge> : b.badge === "rechecking" ? <Badge tone="warn">Rechecking</Badge> : <Badge>hidden</Badge>}</td>
                  <td className="text-xs text-muted-foreground">{ago(j.lastVerifiedAt)}</td>
                  <td className="text-xs">{j.minYears ?? "?"}–{j.maxYears ?? "?"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
