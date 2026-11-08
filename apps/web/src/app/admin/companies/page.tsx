"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ago } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";

const ATS = ["lever","greenhouse","ashby","smartrecruiters","workable","recruitee","workday","icims","successfactors","oracle","phenom","keka","kula","darwinbox","zoho","freshteam","amazon","google","custom","unknown"] as const;

function TestResult({ jobId }: { jobId: string }) {
  const trpc = useTRPC();
  const { data } = useQuery({ ...trpc.admin.testResult.queryOptions({ jobId }), refetchInterval: (q) => (q.state.data?.state === "completed" || q.state.data?.state === "failed" ? false : 2000) });
  if (!data || (data.state !== "completed" && data.state !== "failed")) return <p className="text-xs text-muted-foreground">Running in the worker… ({data?.state ?? "queued"})</p>;
  const o = data.output as { status: string; via?: string; reason?: string; rawCount: number; complete: boolean; samples: { title: string; url: string; freshersEligible: boolean; cities: string[]; track: string; minYears?: number; rejectReasons: string[] }[] } | null;
  if (!o) return <p className="text-xs text-bad">failed</p>;
  return (
    <div className="mt-2 rounded-md bg-muted p-3 text-xs">
      <p><b>{o.status}</b>{o.via && ` via ${o.via}`} · raw count {o.rawCount} · complete snapshot: {String(o.complete)}</p>
      {o.reason && <p className="text-bad">{o.reason}</p>}
      <ul className="mt-2 space-y-1">
        {o.samples.map((s) => (
          <li key={s.url}>
            {s.freshersEligible ? "✓" : "✗"} <a className="underline" href={s.url} target="_blank" rel="noreferrer">{s.title}</a> — {s.cities.join(", ") || "–"} · {s.track} · min {s.minYears ?? "?"}y
            {s.rejectReasons.length > 0 && <span className="text-muted-foreground"> ({s.rejectReasons.join("; ")})</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Row({ c, open, total }: { c: any; open: number; total: number }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const [edit, setEdit] = useState(false);
  const [testJob, setTestJob] = useState<string | null>(null);
  const [form, setForm] = useState({ ats: c.ats, atsSlug: c.atsSlug ?? "", careersUrl: c.careersUrl ?? "", priority: c.priority, excluded: c.excluded });
  const invalidate = () => qc.invalidateQueries({ queryKey: trpc.admin.companies.queryKey() });
  const crawl = useMutation(trpc.admin.crawlNow.mutationOptions());
  const detect = useMutation(trpc.admin.detectNow.mutationOptions());
  const test = useMutation(trpc.admin.testAdapter.mutationOptions({ onSuccess: (r) => setTestJob(r.jobId) }));
  const save = useMutation(trpc.admin.updateCompany.mutationOptions({ onSuccess: () => { setEdit(false); invalidate(); } }));
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{c.name}</span>
        <Badge>{c.ats}</Badge>
        <Badge tone="primary">P{c.priority}</Badge>
        {c.excluded && <Badge tone="warn">excluded{c.excludedReason ? `: ${c.excludedReason}` : ""}</Badge>}
        {c.consecutiveFailures > 0 && <Badge tone="bad">{c.consecutiveFailures} failures</Badge>}
        <span className="text-xs text-muted-foreground">{open} open / {total} jobs · {c.lastCrawlStatus ?? "never crawled"} {ago(c.lastCrawledAt)} · {c.crawlHour}:00 IST</span>
        <div className="ml-auto flex flex-wrap gap-1">
          <Button size="sm" variant="outline" onClick={() => crawl.mutate({ id: c.id })} disabled={crawl.isPending}>{crawl.isSuccess ? "Queued" : "Crawl now"}</Button>
          <Button size="sm" variant="outline" onClick={() => test.mutate({ id: c.id })} disabled={test.isPending}>Test adapter</Button>
          <Button size="sm" variant="outline" onClick={() => detect.mutate({ id: c.id })}>{detect.isSuccess ? "Queued" : "Detect ATS"}</Button>
          <Button size="sm" variant="ghost" onClick={() => setEdit(!edit)}>Edit</Button>
        </div>
      </div>
      {c.careersUrl && <a className="text-xs text-muted-foreground underline" href={c.careersUrl} target="_blank" rel="noreferrer">{c.careersUrl}</a>}
      {c.lastCrawlError && <p className="text-xs text-bad">{c.lastCrawlError}</p>}
      {testJob && <TestResult jobId={testJob} />}
      {edit && (
        <form className="mt-2 grid gap-2 sm:grid-cols-5" onSubmit={(e) => { e.preventDefault(); save.mutate({ id: c.id, ats: form.ats, atsSlug: form.atsSlug || null, careersUrl: form.careersUrl || null, priority: Number(form.priority), excluded: form.excluded }); }}>
          <select aria-label="ATS" className="h-9 rounded-lg border bg-card px-2 text-sm" value={form.ats} onChange={(e) => setForm({ ...form, ats: e.target.value })}>{ATS.map((a) => <option key={a}>{a}</option>)}</select>
          <Input aria-label="ATS slug" placeholder="slug" value={form.atsSlug} onChange={(e) => setForm({ ...form, atsSlug: e.target.value })} />
          <Input aria-label="Careers URL" placeholder="careers URL" value={form.careersUrl} onChange={(e) => setForm({ ...form, careersUrl: e.target.value })} />
          <select aria-label="Priority" className="h-9 rounded-lg border bg-card px-2 text-sm" value={form.priority} onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })}>{[1, 2, 3].map((p) => <option key={p} value={p}>P{p}</option>)}</select>
          <div className="flex items-center gap-2"><label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={form.excluded} onChange={(e) => setForm({ ...form, excluded: e.target.checked })} /> excluded</label><Button size="sm" type="submit">Save</Button></div>
          {save.error && <p className="text-xs text-bad sm:col-span-5">{save.error.message}</p>}
        </form>
      )}
    </li>
  );
}

function Companies() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const [q, setQ] = useState(useSearchParams().get("q") ?? "");
  const [problem, setProblem] = useState(false);
  const { data, isLoading } = useQuery(trpc.admin.companies.queryOptions({ q: q || undefined, problem: problem || undefined }));
  const [add, setAdd] = useState({ name: "", domainOrUrl: "" });
  const addM = useMutation(trpc.admin.addCompany.mutationOptions({ onSuccess: () => { setAdd({ name: "", domainOrUrl: "" }); qc.invalidateQueries({ queryKey: trpc.admin.companies.queryKey() }); } }));
  return (
    <div className="space-y-4">
      <Card>
        <h2 className="mb-2 font-medium">Add company by domain</h2>
        <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); addM.mutate(add); }}>
          <Input placeholder="Company name" value={add.name} onChange={(e) => setAdd({ ...add, name: e.target.value })} required />
          <Input placeholder="example.com or careers URL" value={add.domainOrUrl} onChange={(e) => setAdd({ ...add, domainOrUrl: e.target.value })} required />
          <Button type="submit" disabled={addM.isPending}>Add + detect ATS</Button>
        </form>
        {addM.error && <p className="mt-1 text-sm text-bad">{addM.error.message}</p>}
      </Card>
      <div className="flex flex-wrap items-center gap-3">
        <Input className="max-w-xs" placeholder="Search companies" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={problem} onChange={(e) => setProblem(e.target.checked)} /> failing only</label>
        <span className="text-sm text-muted-foreground">{data?.length ?? 0} shown</span>
      </div>
      <Card>
        {isLoading ? <p className="text-muted-foreground">Loading…</p> : <ul className="divide-y">{data?.map((r) => <Row key={r.c.id} c={r.c} open={r.open} total={r.total} />)}</ul>}
      </Card>
    </div>
  );
}

export default function Page() {
  return <Suspense><Companies /></Suspense>;
}
