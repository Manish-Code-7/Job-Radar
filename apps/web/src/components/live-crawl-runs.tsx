"use client";
import { createRealtimeClient, type SealedLiveQuery } from "@neon/realtime/client";
import { RealtimeProvider, useLiveQuery } from "@neon/realtime-react";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";
import type { LiveCrawlRun } from "@/lib/realtime";
import { ago } from "@/lib/utils";

type Sealed = SealedLiveQuery<LiveCrawlRun>;

async function fetchSealed(): Promise<{ sealed: Sealed; url: string }> {
  const r = await fetch("/api/admin/live/crawl-runs", { method: "POST", cache: "no-store" });
  if (!r.ok) throw new Error(`could not start live updates (${r.status})`);
  return r.json();
}

function Rows({ sealed }: { sealed: Sealed }) {
  const refreshQuery = useCallback(async () => (await fetchSealed()).sealed, []);
  const { data, status, error } = useLiveQuery(sealed, { refreshQuery });
  if (status === "error") return <p role="alert" className="mt-2 text-sm text-bad">Live updates stopped: {error.message}</p>;
  if (data === undefined) return <p className="mt-2 text-sm text-muted-foreground">Connecting…</p>;
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-1">Company</th><th>Status</th><th>Via</th><th>Worker</th><th className="text-right">Found</th><th className="text-right">New</th><th className="text-right">Closed</th><th className="pl-6">When</th></tr></thead>
        <tbody className="divide-y">
          {data.map((r) => (
            <tr key={r.id}>
              <td className="py-1.5">{r.company ?? "–"}</td>
              <td><Badge tone={r.status === "ok" ? "ok" : r.status === "running" ? "primary" : "bad"}>{r.status}</Badge></td>
              <td className="text-xs">{r.via ?? "–"}</td>
              <td className="text-xs">{r.worker}</td>
              <td className="text-right tabular-nums">{r.jobs_found ?? "–"}</td>
              <td className="text-right tabular-nums">{r.jobs_new ?? "–"}</td>
              <td className="text-right tabular-nums">{r.jobs_closed ?? "–"}</td>
              <td className="pl-6 text-xs text-muted-foreground">{ago(r.started_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {status === "stale" && <p role="status" className="mt-1 text-xs text-muted-foreground">Reconnecting…</p>}
    </div>
  );
}

/** Recent crawl runs, pushed live from Postgres by Neon Realtime (no polling). */
export function LiveCrawlRuns() {
  const [state, setState] = useState<{ sealed: Sealed; client: ReturnType<typeof createRealtimeClient> } | { error: string } | null>(null);
  useEffect(() => {
    let client: ReturnType<typeof createRealtimeClient> | undefined;
    fetchSealed()
      .then(({ sealed, url }) => {
        client = createRealtimeClient({ url }); // one client per page, created in the browser
        setState({ sealed, client });
      })
      .catch((e: Error) => setState({ error: e.message }));
    return () => client?.close?.();
  }, []);
  return (
    <Card>
      <div className="flex items-center justify-between">
        <CardTitle>Recent crawl runs</CardTitle>
        <Badge tone="primary">live</Badge>
      </div>
      {!state ? <p className="mt-2 text-sm text-muted-foreground">Connecting…</p> : "error" in state ? <p role="alert" className="mt-2 text-sm text-bad">{state.error}</p> : (
        <RealtimeProvider client={state.client}>
          <Rows sealed={state.sealed} />
        </RealtimeProvider>
      )}
    </Card>
  );
}
