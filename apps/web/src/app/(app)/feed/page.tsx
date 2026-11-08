"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { JobCard, type FeedJob } from "@/components/job-card";
import { TRACK_LABEL } from "@/components/preferences-form";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";

type Track = "software" | "ai_ml" | "devops" | "data" | "qa" | "other";

function Segmented<T extends string>({ label, options, value, onChange, render }: { label: string; options: T[]; value: T; onChange: (v: T) => void; render: (v: T) => string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex shrink-0 rounded-lg border bg-card p-0.5">
      {options.map((o) => (
        <button key={o} type="button" role="radio" aria-checked={value === o} onClick={() => onChange(o)} className={cn("h-10 cursor-pointer rounded-md px-3 text-sm", value === o ? "bg-primary text-primary-foreground" : "hover:bg-muted")}>
          {render(o)}
        </button>
      ))}
    </div>
  );
}

export default function Feed() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const me = useQuery(trpc.me.get.queryOptions());
  const [track, setTrack] = useState<Track | "all">("all");
  const [city, setCity] = useState("");
  const [remoteOnly, setRemoteOnly] = useState(false);
  const [sort, setSort] = useState<"best" | "newest">("best");

  const p = me.data?.profile;
  useEffect(() => {
    if (p && (!p.onboardedAt || !p.consentAt || p.consentWithdrawnAt)) window.location.replace("/onboarding");
  }, [p]);

  const input = { track: track === "all" ? undefined : track, city: city || undefined, remoteOnly: remoteOnly || undefined, sort };
  const feed = useQuery({
    ...trpc.me.feed.queryOptions(input),
    enabled: !!p?.onboardedAt,
    // While matches are (re)computing, poll until they land.
    refetchInterval: (q) => {
      const d = q.state.data;
      return !d || !d.computedAt || new Date(d.computedAt) < new Date(d.profileUpdatedAt) ? 3000 : false;
    },
  });
  const dismiss = useMutation(
    trpc.me.dismiss.mutationOptions({
      onMutate: ({ jobId }) => {
        qc.setQueryData(trpc.me.feed.queryKey(input), (old) => (old ? { ...old, jobs: old.jobs.filter((j) => j.jobId !== jobId) } : old));
      },
    }),
  );
  const refresh = useMutation(trpc.me.refreshMatches.mutationOptions({ onSuccess: () => qc.invalidateQueries({ queryKey: trpc.me.feed.queryKey() }) }));

  const computing = feed.data && (!feed.data.computedAt || new Date(feed.data.computedAt) < new Date(feed.data.profileUpdatedAt));
  const tracks: (Track | "all")[] = ["all", ...((p?.tracks.length ? p.tracks : ["software", "ai_ml", "devops", "data", "qa"]) as Track[])];

  return (
    <div>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Your matches</h1>
          <p className="text-sm text-muted-foreground">From companies&apos; own career pages, checked open in the last 72 hours.</p>
        </div>
        <button type="button" onClick={() => refresh.mutate()} disabled={refresh.isPending} aria-label="Refresh matches" className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-lg border bg-card text-sm hover:bg-muted sm:w-auto sm:px-3">
          <RefreshCw className={cn("size-4", refresh.isPending && "animate-spin")} aria-hidden="true" /><span className="hidden sm:inline">Refresh</span>
        </button>
      </div>

      <section aria-label="Filters" className="-mx-4 mb-4 space-y-2 border-b bg-background/95 px-4 pb-3 backdrop-blur sm:sticky sm:top-14 sm:z-10 sm:pt-3">
        <div className="flex gap-2 overflow-x-auto pb-1" role="radiogroup" aria-label="Role">
          {tracks.map((t) => (
            <button key={t} type="button" role="radio" aria-checked={track === t} onClick={() => setTrack(t)} className={cn("h-10 shrink-0 cursor-pointer rounded-full border px-4 text-sm", track === t ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted")}>
              {t === "all" ? "All roles" : TRACK_LABEL[t]}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          <label className="sr-only" htmlFor="city">City</label>
          <select id="city" value={city} onChange={(e) => setCity(e.target.value)} className="h-10 shrink-0 cursor-pointer rounded-lg border bg-card px-2 text-sm">
            <option value="">All my cities</option>
            {(p?.cities ?? []).map((c) => <option key={c}>{c}</option>)}
          </select>
          <label className="inline-flex h-10 shrink-0 cursor-pointer items-center gap-2 rounded-lg border bg-card px-3 text-sm">
            <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={remoteOnly} onChange={(e) => setRemoteOnly(e.target.checked)} />Remote
          </label>
          <Segmented label="Sort" options={["best", "newest"]} value={sort} onChange={setSort} render={(v) => (v === "best" ? "Best" : "Newest")} />
        </div>
      </section>

      {computing && (
        <p role="status" className="mb-4 flex items-center gap-2 rounded-lg bg-primary/10 p-3 text-sm text-primary">
          <RefreshCw className="size-4 animate-spin" aria-hidden="true" />Finding jobs that match your profile…
        </p>
      )}

      {feed.isLoading || !p ? (
        <div className="space-y-3" aria-hidden="true">{[0, 1, 2].map((i) => <div key={i} className="h-48 animate-pulse rounded-xl border bg-muted/50" />)}</div>
      ) : feed.data?.jobs.length ? (
        <ul className="space-y-3">
          {feed.data.jobs.map((j) => (
            <li key={j.jobId}><JobCard job={j as FeedJob} onDismiss={(jobId) => dismiss.mutate({ jobId })} /></li>
          ))}
        </ul>
      ) : !computing ? (
        <div className="rounded-xl border bg-card p-8 text-center">
          <SlidersHorizontal className="mx-auto size-8 text-muted-foreground" aria-hidden="true" />
          <h2 className="mt-3 font-semibold">No matches right now</h2>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            {track !== "all" || city || remoteOnly ? "Try clearing a filter above." : "We add newly verified jobs every few hours. Widening your cities or roles in Settings shows more."}
          </p>
          <Link href="/settings" className="mt-4 inline-flex h-11 items-center rounded-lg border px-4 text-sm hover:bg-muted">Edit preferences</Link>
        </div>
      ) : null}
    </div>
  );
}
