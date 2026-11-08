"use client";
import { AlertCircle, BadgeCheck, Briefcase, Check, Clock, ExternalLink, Flag, IndianRupee, Layers, MapPin } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { Monogram } from "./logo";

export interface FeedJob {
  jobId: string;
  title: string;
  company: string;
  summary: string | null;
  classifierVersion?: string | null;
  cities: string[];
  workplace: string;
  remoteIndia: boolean;
  track: string;
  skills: string[];
  matchedSkills: string[];
  minYears: number | null;
  maxYears: number | null;
  salaryText: string | null;
  firstSeenAt?: string | Date;
  score: number;
  reasons: string[];
  gaps: string[];
  badge: { badge: "verified" | "rechecking" | "hidden"; hoursAgo?: number };
}

const TRACK_LABEL: Record<string, string> = { software: "Software", ai_ml: "AI / ML", devops: "DevOps / SRE", data: "Data", qa: "QA", other: "Other" };

function where(j: FeedJob) {
  if (j.remoteIndia || j.workplace === "remote") return j.cities.length ? `Remote · ${j.cities.join(", ")}` : "Remote (India)";
  return `${j.cities.join(", ") || "India"}${j.workplace === "hybrid" ? " · Hybrid" : ""}`;
}
function exp(j: FeedJob) {
  if (j.minYears == null) return "Experience not stated";
  if (j.minYears === 0 && (j.maxYears ?? 0) <= 1) return "Freshers welcome";
  return j.maxYears != null ? `${j.minYears}–${j.maxYears} yrs` : `${j.minYears}+ yrs`;
}
function strength(score: number) {
  if (score >= 75) return { label: "Strong match", cls: "bg-ok-soft text-ok" };
  if (score >= 55) return { label: "Good match", cls: "bg-primary-soft text-primary" };
  return { label: "Worth a look", cls: "bg-muted text-muted-foreground" };
}
const isNew = (d?: string | Date) => !!d && Date.now() - new Date(d).getTime() < 48 * 3600_000;

export function JobCard({ job, onDismiss }: { job: FeedJob; onDismiss: (id: string) => void }) {
  const [reported, setReported] = useState(false);
  const mine = new Set(job.matchedSkills.map((s) => s.toLowerCase()));
  const s = strength(job.score);
  const skills = [...job.skills].sort((a, b) => Number(mine.has(b.toLowerCase())) - Number(mine.has(a.toLowerCase()))).slice(0, 10);
  const aiSummary = job.summary && job.classifierVersion?.includes("+ai");
  return (
    <article className="group rounded-xl border bg-card p-4 transition-colors hover:border-primary/40 sm:p-5" aria-labelledby={`t-${job.jobId}`}>
      <div className="flex items-start gap-3">
        <Monogram name={job.company} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 id={`t-${job.jobId}`} className="text-[16px] font-semibold leading-snug text-balance">{job.title}</h3>
            {isNew(job.firstSeenAt) && <span className="rounded bg-primary px-1.5 py-px text-[11px] font-semibold uppercase tracking-wide text-primary-foreground">New</span>}
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">{job.company}</p>
        </div>
        <div className={cn("hidden shrink-0 flex-col items-end rounded-lg px-2.5 py-1.5 text-right sm:flex", s.cls)}>
          <span className="text-lg font-semibold leading-none tabular-nums">{job.score}</span>
          <span className="mt-1 text-[11px] font-medium">{s.label}</span>
        </div>
      </div>

      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[13px] text-muted-foreground" aria-label="Job details">
        <li className="inline-flex items-center gap-1.5"><MapPin className="size-3.5" aria-hidden="true" />{where(job)}</li>
        <li className="inline-flex items-center gap-1.5"><Briefcase className="size-3.5" aria-hidden="true" />{exp(job)}</li>
        <li className="inline-flex items-center gap-1.5"><Layers className="size-3.5" aria-hidden="true" />{TRACK_LABEL[job.track] ?? job.track}</li>
        {job.salaryText && <li className="inline-flex items-center gap-1.5"><IndianRupee className="size-3.5" aria-hidden="true" />{job.salaryText}</li>}
      </ul>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className={cn("inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium sm:hidden", s.cls)}>{s.label} · {job.score}</span>
        {job.badge.badge === "verified" ? (
          <span className="inline-flex items-center gap-1.5 rounded-md bg-ok-soft px-2 py-1 text-xs font-medium text-ok">
            <BadgeCheck className="size-3.5" aria-hidden="true" />Verified open · {job.badge.hoursAgo === 0 ? "checked just now" : `checked ${job.badge.hoursAgo}h ago`}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-md bg-warn-soft px-2 py-1 text-xs font-medium text-warn"><Clock className="size-3.5" aria-hidden="true" />Rechecking link</span>
        )}
      </div>

      {job.reasons.length > 0 && (
        <ul className="mt-4 space-y-1.5 text-sm" aria-label="Why this fits you">
          {job.reasons.map((r) => {
            const warn = /stretch/i.test(r);
            const neutral = /not stated/i.test(r);
            return (
              <li key={r} className="flex items-start gap-2">
                {warn ? <AlertCircle className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden="true" /> : <Check className={cn("mt-0.5 size-4 shrink-0", neutral ? "text-muted-foreground" : "text-ok")} aria-hidden="true" />}
                <span className={neutral ? "text-muted-foreground" : undefined}>{r}</span>
              </li>
            );
          })}
        </ul>
      )}

      {aiSummary && <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{job.summary}</p>}

      {skills.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-1.5" aria-label="Skills in this job">
          {skills.map((sk) => {
            const have = mine.has(sk.toLowerCase());
            return (
              <li key={sk} className={cn("inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs", have ? "border-transparent bg-primary-soft font-medium text-primary" : "text-muted-foreground")}>
                {have && <Check className="size-3" aria-hidden="true" />}
                {have && <span className="sr-only">You have </span>}
                {sk}
              </li>
            );
          })}
        </ul>
      )}
      {job.gaps.length > 0 && <p className="mt-2 text-[13px] text-muted-foreground">To brush up: {job.gaps.join(", ")}</p>}

      <div className="mt-4 flex items-center gap-2 border-t pt-4">
        <a href={`/api/jobs/${job.jobId}/go`} target="_blank" rel="noopener" className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 sm:flex-none">
          Apply on {job.company}
          <ExternalLink className="size-4" aria-hidden="true" />
          <span className="sr-only">(opens the company&apos;s site in a new tab)</span>
        </a>
        <button type="button" onClick={() => onDismiss(job.jobId)} className="inline-flex h-11 cursor-pointer items-center rounded-lg border px-4 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
          Not for me<span className="sr-only">: {job.title} at {job.company}</span>
        </button>
        <button
          type="button"
          disabled={reported}
          title="Link not working?"
          onClick={async () => {
            setReported(true);
            await fetch(`/api/jobs/${job.jobId}/report`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).catch(() => {});
          }}
          className="ml-auto inline-flex h-11 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-[13px] text-muted-foreground hover:text-foreground disabled:cursor-default"
        >
          <Flag className="size-4" aria-hidden="true" />
          <span className="hidden sm:inline">{reported ? "Thanks, rechecking" : "Link not working?"}</span>
          <span className="sr-only sm:hidden">{reported ? "Thanks, we're rechecking it" : "Report a broken link"}</span>
        </button>
      </div>
    </article>
  );
}
