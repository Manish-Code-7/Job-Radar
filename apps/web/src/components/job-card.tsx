"use client";
import { BadgeCheck, Briefcase, Clock, Flag, MapPin, X } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

export interface FeedJob {
  jobId: string;
  title: string;
  company: string;
  summary: string | null;
  cities: string[];
  workplace: string;
  remoteIndia: boolean;
  track: string;
  skills: string[];
  matchedSkills: string[];
  minYears: number | null;
  maxYears: number | null;
  salaryText: string | null;
  score: number;
  reasons: string[];
  gaps: string[];
  badge: { badge: "verified" | "rechecking" | "hidden"; hoursAgo?: number };
}

const TRACK_LABEL: Record<string, string> = { software: "Software", ai_ml: "AI / ML", devops: "DevOps", data: "Data", qa: "QA", other: "Other" };

function where(j: FeedJob) {
  if (j.remoteIndia || j.workplace === "remote") return j.cities.length ? `Remote or ${j.cities.join(", ")}` : "Remote (India)";
  return `${j.cities.join(", ") || "India"}${j.workplace === "hybrid" ? " · Hybrid" : ""}`;
}

function exp(j: FeedJob) {
  if (j.minYears == null) return "Experience not stated";
  if (j.minYears === 0 && (j.maxYears ?? 0) <= 1) return "Freshers";
  return j.maxYears != null ? `${j.minYears}–${j.maxYears} yrs` : `${j.minYears}+ yrs`;
}

function ScoreRing({ score }: { score: number }) {
  const r = 18;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative size-12 shrink-0" role="img" aria-label={`Match score ${score} out of 100`}>
      <svg viewBox="0 0 44 44" className="size-12 -rotate-90" aria-hidden="true">
        <circle cx="22" cy="22" r={r} fill="none" stroke="var(--muted)" strokeWidth="4" />
        <circle cx="22" cy="22" r={r} fill="none" stroke="var(--primary)" strokeWidth="4" strokeLinecap="round" strokeDasharray={`${(score / 100) * c} ${c}`} />
      </svg>
      <span className="absolute inset-0 grid place-items-center text-sm font-semibold tabular-nums">{score}</span>
    </div>
  );
}

export function JobCard({ job, onDismiss }: { job: FeedJob; onDismiss: (id: string) => void }) {
  const [reported, setReported] = useState(false);
  const matched = new Set(job.matchedSkills.map((s) => s.toLowerCase()));
  return (
    <article className="rounded-xl border bg-card p-4 sm:p-5" aria-labelledby={`t-${job.jobId}`}>
      <div className="flex gap-3">
        <ScoreRing score={job.score} />
        <div className="min-w-0 flex-1">
          <h3 id={`t-${job.jobId}`} className="text-base font-semibold leading-snug text-balance">{job.title}</h3>
          <p className="text-sm text-muted-foreground">{job.company}</p>
        </div>
        <button type="button" onClick={() => onDismiss(job.jobId)} className="-m-2 grid size-11 shrink-0 cursor-pointer place-items-center rounded-lg text-muted-foreground hover:bg-muted" aria-label={`Hide ${job.title} at ${job.company}`}>
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-1"><MapPin className="size-4" aria-hidden="true" />{where(job)}</span>
        <span className="inline-flex items-center gap-1"><Briefcase className="size-4" aria-hidden="true" />{exp(job)}</span>
        <span>{TRACK_LABEL[job.track] ?? job.track}</span>
        {job.salaryText && <span>{job.salaryText}</span>}
      </div>

      {job.badge.badge === "verified" ? (
        <p className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-ok/12 px-2 py-1 text-xs font-medium text-ok">
          <BadgeCheck className="size-4" aria-hidden="true" />Verified open · checked {job.badge.hoursAgo === 0 ? "just now" : `${job.badge.hoursAgo}h ago`}
        </p>
      ) : (
        <p className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-warn/15 px-2 py-1 text-xs font-medium text-warn">
          <Clock className="size-4" aria-hidden="true" />Rechecking this link
        </p>
      )}

      {job.reasons.length > 0 && <p className="mt-3 text-sm"><span className="font-medium">Why you match: </span>{job.reasons.join(" · ")}</p>}
      {job.summary && <p className="mt-2 text-sm text-muted-foreground">{job.summary}</p>}

      {job.skills.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Skills in this job">
          {job.skills.slice(0, 10).map((s) => (
            <li key={s} className={cn("rounded-md px-2 py-0.5 text-xs", matched.has(s.toLowerCase()) ? "bg-primary/12 font-medium text-primary" : "bg-muted text-muted-foreground")}>
              {matched.has(s.toLowerCase()) && <span className="sr-only">You have: </span>}
              {s}
            </li>
          ))}
        </ul>
      )}
      {job.gaps.length > 0 && <p className="mt-2 text-xs text-muted-foreground">To brush up: {job.gaps.join(", ")}</p>}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <a href={`/api/jobs/${job.jobId}/go`} target="_blank" rel="noopener" className="inline-flex h-11 items-center rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground hover:opacity-90">
          Apply on {job.company}&apos;s site<span className="sr-only"> (opens in a new tab)</span>
        </a>
        <button
          type="button"
          disabled={reported}
          onClick={async () => {
            setReported(true);
            await fetch(`/api/jobs/${job.jobId}/report`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).catch(() => {});
          }}
          className="inline-flex h-11 cursor-pointer items-center gap-1.5 rounded-lg px-3 text-sm text-muted-foreground hover:bg-muted disabled:cursor-default"
        >
          <Flag className="size-4" aria-hidden="true" />
          {reported ? "Thanks, we're rechecking it" : "Link not working?"}
        </button>
      </div>
    </article>
  );
}
