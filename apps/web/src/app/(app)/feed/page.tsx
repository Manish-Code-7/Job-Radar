"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, RefreshCw, SearchX, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { JobCard, type FeedJob } from "@/components/job-card";
import { TRACK_LABEL } from "@/components/preferences-form";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";

type Track = "software" | "ai_ml" | "devops" | "data" | "qa" | "other";

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}
function ago(d?: string | Date | null) {
  if (!d) return "";
  const m = Math.max(0, Math.round((Date.now() - new Date(d).getTime()) / 60000));
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.round(m / 60)}h ago`;
}

export default function Feed() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const me = useQuery(trpc.me.get.queryOptions());
  const [track, setTrack] = useState<Track | "all">("all");
  const [city, setCity] = useState("");
  const [remoteOnly, setRemoteOnly] = useState(false);
  const [sort, setSort] = useState<"best" | "newest">("best");
  // Clock-dependent text is computed in the browser only (server runs in UTC, users are in IST).
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const p = me.data?.profile;
  useEffect(() => {
    if (p && (!p.onboardedAt || !p.consentAt || p.consentWithdrawnAt)) window.location.replace("/onboarding");
  }, [p]);

  const input = { track: track === "all" ? undefined : track, city: city || undefined, remoteOnly: remoteOnly || undefined, sort };
  const feed = useQuery({
    ...trpc.me.feed.queryOptions(input),
    enabled: !!p?.onboardedAt,
    refetchInterval: (q) => {
      const d = q.state.data;
      return !d || !d.upToDate ? 2500 : false;
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

  const computing = !!feed.data && !feed.data.upToDate;
  const tracks: (Track | "all")[] = ["all", ...((p?.tracks.length ? p.tracks : ["software", "ai_ml", "devops", "data", "qa"]) as Track[])];
  const filtered = track !== "all" || !!city || remoteOnly;
  const firstName = (p?.name ?? "").split(" ")[0];
  const count = feed.data?.jobs.length ?? 0;

  return (
    <div>
      <header className="mb-5 flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground" suppressHydrationWarning>{now ? `${greeting()}${firstName ? `, ${firstName}` : ""}` : "\u00a0"}</p>
          <h1 className="mt-0.5 text-[26px] font-semibold tracking-tight">Your matches</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
            <BadgeCheck className="size-4 text-ok" aria-hidden="true" />
            {feed.data ? <><b className="font-semibold text-foreground tabular-nums">{count}</b> verified {count === 1 ? "opening" : "openings"}</> : "Loading"}
            {now && feed.data?.computedAt && <span>· updated {ago(feed.data.computedAt)}</span>}
          </p>
        </div>
        <button type="button" onClick={() => refresh.mutate()} disabled={refresh.isPending || computing} aria-label="Refresh matches" className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-lg border bg-card text-sm hover:bg-muted sm:w-auto sm:px-3.5">
          <RefreshCw className={cn("size-4", (refresh.isPending || computing) && "animate-spin")} aria-hidden="true" />
          <span className="hidden sm:inline">Refresh</span>
        </button>
      </header>

      <section aria-label="Filters" className="-mx-4 mb-5 space-y-2.5 border-y bg-background/90 px-4 py-3 backdrop-blur-md sm:sticky sm:top-16 sm:z-20 sm:mx-0 sm:rounded-xl sm:border sm:bg-card sm:px-3">
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5" role="radiogroup" aria-label="Role">
          {tracks.map((t) => (
            <button key={t} type="button" role="radio" aria-checked={track === t} onClick={() => setTrack(t)} className={cn("h-9 shrink-0 cursor-pointer rounded-full border px-3.5 text-sm transition-colors", track === t ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:text-foreground")}>
              {t === "all" ? "All roles" : TRACK_LABEL[t]}
            </button>
          ))}
        </div>
        <div className="-mx-1 flex items-center gap-1.5 overflow-x-auto px-1 pb-0.5">
          <label className="sr-only" htmlFor="city">City</label>
          <select id="city" value={city} onChange={(e) => setCity(e.target.value)} className="h-9 shrink-0 cursor-pointer rounded-lg border bg-card px-2.5 text-sm">
            <option value="">All my cities</option>
            {(p?.cities ?? []).map((c) => <option key={c}>{c}</option>)}
          </select>
          <label className={cn("inline-flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm", remoteOnly ? "border-primary bg-primary-soft text-primary" : "bg-card")}>
            <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={remoteOnly} onChange={(e) => setRemoteOnly(e.target.checked)} />Remote
          </label>
          <div role="radiogroup" aria-label="Sort" className="ml-auto inline-flex shrink-0 rounded-lg border bg-card p-0.5">
            {(["best", "newest"] as const).map((o) => (
              <button key={o} type="button" role="radio" aria-checked={sort === o} onClick={() => setSort(o)} className={cn("h-8 cursor-pointer rounded-md px-3 text-sm", sort === o ? "bg-primary-soft font-medium text-primary" : "text-muted-foreground hover:text-foreground")}>
                {o === "best" ? "Best match" : "Newest"}
              </button>
            ))}
          </div>
        </div>
      </section>

      {computing && (
        <p role="status" className="mb-4 flex items-center gap-2 rounded-xl border border-primary/30 bg-primary-soft p-3.5 text-sm text-primary">
          <RefreshCw className="size-4 animate-spin" aria-hidden="true" />Matching new jobs to your profile… this takes a few seconds.
        </p>
      )}

      {feed.isLoading || !p ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading matches">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-xl border bg-card p-5">
              <div className="flex gap-3"><div className="size-11 animate-pulse rounded-lg bg-muted" /><div className="flex-1 space-y-2"><div className="h-4 w-2/3 animate-pulse rounded bg-muted" /><div className="h-3 w-1/3 animate-pulse rounded bg-muted" /></div></div>
              <div className="mt-4 h-3 w-1/2 animate-pulse rounded bg-muted" />
              <div className="mt-4 h-11 w-40 animate-pulse rounded-lg bg-muted" />
            </div>
          ))}
        </div>
      ) : count ? (
        <ul className="space-y-3">
          {feed.data!.jobs.map((j) => <li key={j.jobId}><JobCard job={j as FeedJob} onDismiss={(jobId) => dismiss.mutate({ jobId })} /></li>)}
        </ul>
      ) : !computing ? (
        <div className="rounded-xl border bg-card px-6 py-12 text-center">
          <span className="mx-auto grid size-12 place-items-center rounded-full bg-muted">
            {filtered ? <SearchX className="size-6 text-muted-foreground" aria-hidden="true" /> : <SlidersHorizontal className="size-6 text-muted-foreground" aria-hidden="true" />}
          </span>
          <h2 className="mt-4 font-semibold">{filtered ? "Nothing with these filters" : "No matches yet"}</h2>
          <p className="mx-auto mt-1.5 max-w-sm text-sm text-muted-foreground">
            {filtered ? "Try another role or city, or turn off Remote." : "We verify new openings every few hours. These changes would show you more:"}
          </p>
          {!filtered && p && (
            <ul className="mx-auto mt-4 max-w-sm space-y-2 text-left text-sm">
              {[
                p.skills.length < 5 && `You've added only ${p.skills.length} skill${p.skills.length === 1 ? "" : "s"}. Add the ones you've used in projects.`,
                p.minPayLpa != null && `Your ${p.minPayLpa} LPA minimum hides jobs that state lower pay.`,
                p.cities.length < 2 && !p.remoteOk && `You're only looking in ${p.cities[0] ?? "one city"}, with remote off.`,
                p.tracks.length < 2 && `You picked one role type (${TRACK_LABEL[p.tracks[0] ?? "software"]}).`,
              ]
                .filter(Boolean)
                .map((t) => <li key={t as string} className="flex gap-2 rounded-lg bg-muted px-3 py-2"><SlidersHorizontal className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />{t}</li>)}
            </ul>
          )}
          {filtered ? (
            <button type="button" onClick={() => { setTrack("all"); setCity(""); setRemoteOnly(false); }} className="mt-5 inline-flex h-11 cursor-pointer items-center rounded-lg border px-4 text-sm hover:bg-muted">Clear filters</button>
          ) : (
            <Link href="/settings#preferences" className="mt-5 inline-flex h-11 items-center rounded-lg border px-4 text-sm hover:bg-muted">Edit preferences</Link>
          )}
        </div>
      ) : null}
    </div>
  );
}
