"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useTRPC } from "@/trpc/client";

export default function Takedowns() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const [status, setStatus] = useState("new");
  const { data } = useQuery(trpc.admin.takedowns.queryOptions({ status: status || undefined }));
  const [notes, setNotes] = useState<Record<string, string>>({});
  const resolve = useMutation(trpc.admin.resolveTakedown.mutationOptions({ onSuccess: () => qc.invalidateQueries({ queryKey: trpc.admin.takedowns.queryKey() }) }));
  return (
    <div className="space-y-4">
      <div className="flex gap-2">{["new", "actioned", "rejected", ""].map((s) => <Button key={s} size="sm" variant={status === s ? "default" : "outline"} onClick={() => setStatus(s)}>{s || "all"}</Button>)}</div>
      {data?.length === 0 && <p className="text-muted-foreground">Inbox empty.</p>}
      {data?.map(({ t, company }) => (
        <Card key={t.id} className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <b>{t.requesterName}</b><span className="text-sm text-muted-foreground">{t.requesterEmail}</span>
            <Badge>{t.scope}</Badge><Badge tone={t.status === "new" ? "warn" : "neutral"}>{t.status}</Badge>
            <span className="ml-auto text-xs text-muted-foreground">{new Date(t.at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</span>
          </div>
          <p className="text-sm">Matched company: {company ?? <i>no match — check the name</i>}</p>
          {t.jobUrl && <p className="text-sm">Job: <a className="underline" href={t.jobUrl}>{t.jobUrl}</a></p>}
          <pre className="whitespace-pre-wrap text-sm text-muted-foreground">{t.message}</pre>
          {t.status === "new" && (
            <div className="flex flex-wrap gap-2">
              <Input className="max-w-sm" placeholder="Note (sent to no one; internal)" value={notes[t.id] ?? ""} onChange={(e) => setNotes({ ...notes, [t.id]: e.target.value })} />
              {t.scope === "company" && t.companyId && <Button size="sm" variant="destructive" onClick={() => resolve.mutate({ id: t.id, status: "actioned", note: notes[t.id], excludeCompanyId: t.companyId! })}>Exclude company + archive jobs</Button>}
              {t.scope === "job" && t.jobUrl && <Button size="sm" variant="destructive" onClick={() => resolve.mutate({ id: t.id, status: "actioned", note: notes[t.id], archiveJobUrl: t.jobUrl! })}>Archive job</Button>}
              <Button size="sm" variant="outline" onClick={() => resolve.mutate({ id: t.id, status: "rejected", note: notes[t.id] })}>Reject</Button>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}
