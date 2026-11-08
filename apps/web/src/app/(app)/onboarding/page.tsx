"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronLeft, FileText, Lock, Sparkles, Target, UserCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { PreferencesForm } from "@/components/preferences-form";
import { ResumeReview, ResumeUpload, type ResumeData } from "@/components/resume-form";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";

const STEPS = ["Your data", "Resume", "Preferences"] as const;

function Stepper({ step }: { step: number }) {
  return (
    <ol className="mb-8 flex items-center" aria-label="Onboarding progress">
      {STEPS.map((label, i) => (
        <li key={label} className={cn("flex items-center", i < STEPS.length - 1 && "flex-1")} aria-current={i === step ? "step" : undefined}>
          <span className="flex items-center gap-2">
            <span className={cn("grid size-8 shrink-0 place-items-center rounded-full text-sm font-semibold transition-colors", i < step ? "bg-primary text-primary-foreground" : i === step ? "bg-primary-soft text-primary ring-2 ring-primary" : "bg-muted text-muted-foreground")}>
              {i < step ? <Check className="size-4" aria-hidden="true" /> : i + 1}
            </span>
            <span className={cn("hidden text-sm sm:inline", i === step ? "font-medium" : "text-muted-foreground")}>{label}</span>
            <span className="sr-only">{i < step ? " (done)" : i === step ? " (current step)" : ""}</span>
          </span>
          {i < STEPS.length - 1 && <span className={cn("mx-3 h-0.5 flex-1 rounded-full", i < step ? "bg-primary" : "bg-border")} aria-hidden="true" />}
        </li>
      ))}
    </ol>
  );
}

export default function Onboarding() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { data } = useQuery(trpc.me.get.queryOptions());
  const [step, setStep] = useState<number | null>(null);
  const [draft, setDraft] = useState<ResumeData | null>(null);
  const [agree, setAgree] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: trpc.me.get.queryKey() });

  const consent = useMutation(trpc.me.giveConsent.mutationOptions({ onSuccess: async () => { await refresh(); setStep(1); } }));
  const saveResume = useMutation(trpc.me.saveResumeData.mutationOptions({ onSuccess: async () => { await refresh(); setStep(2); } }));
  const savePrefs = useMutation(trpc.me.savePreferences.mutationOptions({ onSuccess: () => window.location.assign("/feed") }));

  useEffect(() => {
    if (!data || step !== null) return;
    const p = data.profile;
    if (!p.consentAt || p.consentWithdrawnAt) setStep(0);
    else if (!p.skills.length) setStep(1);
    else setStep(2);
  }, [data, step]);

  if (!data || step === null) return <div className="space-y-4" aria-busy="true"><div className="h-8 w-48 animate-pulse rounded bg-muted" /><div className="h-64 animate-pulse rounded-xl bg-muted" /></div>;
  const p = data.profile;

  return (
    <div>
      <p className="text-sm font-medium text-primary">Step {step + 1} of 3</p>
      <h1 className="mt-1 text-[26px] font-semibold tracking-tight">Set up your matches</h1>
      <p className="mb-6 mt-1 text-sm text-muted-foreground">About two minutes. You can change everything later in Settings.</p>
      <Stepper step={step} />

      {step === 0 && (
        <section aria-labelledby="consent-h" className="space-y-4">
          <h2 id="consent-h" className="text-lg font-semibold">How we use your data</h2>
          <ul className="divide-y rounded-xl border bg-card">
            {[
              { icon: FileText, t: "What we collect", d: "Your email, your resume PDF, the details we read from it (skills, experience, education, projects), your preferences, and which jobs you hide, open or report." },
              { icon: Target, t: "Why", d: `To ${data.consentPurposes.join(", ")}. Nothing else. We never sell or share your data.` },
              { icon: Lock, t: "How", d: "Your resume is stored encrypted and read on our own servers. It is never sent to an outside AI service." },
              { icon: UserCheck, t: "Your rights", d: "Download, correct or delete your data, or withdraw this consent, any time in Settings. Deleting removes your resume and profile immediately." },
            ].map(({ icon: Icon, t, d }) => (
              <li key={t} className="flex gap-3.5 p-4">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary"><Icon className="size-4.5" aria-hidden="true" /></span>
                <span><b className="block text-sm font-medium">{t}</b><span className="mt-0.5 block text-sm leading-relaxed text-muted-foreground">{d}</span></span>
              </li>
            ))}
          </ul>
          <p className="text-[13px] text-muted-foreground">Questions or complaints: see the <a className="text-primary underline underline-offset-2" href="/privacy" target="_blank">privacy notice</a> for our grievance officer.</p>
          <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border bg-card p-4 has-[:checked]:border-primary has-[:checked]:bg-primary-soft">
            <input type="checkbox" className="mt-0.5 size-5 shrink-0 accent-[var(--primary)]" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            <span className="text-sm">I agree to Job Radar using my data for the purposes above (notice version {data.consentVersion}).</span>
          </label>
          <Button size="lg" className="w-full sm:w-auto" disabled={!agree || consent.isPending} onClick={() => consent.mutate({ version: data.consentVersion as "2026-11-08" })}>
            {consent.isPending ? "Saving…" : "Agree and continue"}
          </Button>
          {consent.error && <p role="alert" className="text-sm text-bad">{consent.error.message}</p>}
        </section>
      )}

      {step === 1 && (
        <section aria-labelledby="resume-h" className="space-y-6">
          <h2 id="resume-h" className="text-lg font-semibold">Your resume</h2>
          {!draft && (
            <>
              <ResumeUpload hasResume={!!p.resumeKey} onParsed={(d) => setDraft({ name: d.name ?? p.name ?? "", skills: d.skills, experienceMonths: d.experienceMonths, education: d.education, gradYear: d.gradYear ?? null, projects: d.projects })} />
              <button type="button" className="h-11 cursor-pointer text-sm text-primary hover:underline" onClick={() => setDraft({ name: p.name ?? "", skills: p.skills, experienceMonths: p.experienceMonths, education: p.education ?? "", gradYear: p.gradYear, projects: p.projects })}>
                No resume handy? Fill it in yourself
              </button>
            </>
          )}
          {draft && (
            <>
              <p className="flex items-start gap-2.5 rounded-xl border border-primary/30 bg-primary-soft p-3.5 text-sm text-primary"><Sparkles className="mt-0.5 size-4 shrink-0" aria-hidden="true" />Check what we picked up and fix anything that&apos;s wrong. Matching uses exactly this.</p>
              <ResumeReview initial={draft} track={p.tracks[0] ?? "software"} saving={saveResume.isPending} submitLabel="Looks right, continue" onSave={(d) => saveResume.mutate({ ...d, name: d.name ?? undefined, education: d.education ?? undefined })} />
              {saveResume.error && <p role="alert" className="text-sm text-bad">{saveResume.error.message}</p>}
            </>
          )}
        </section>
      )}

      {step === 2 && (
        <section aria-labelledby="prefs-h" className="space-y-6">
          <h2 id="prefs-h" className="text-lg font-semibold">What you&apos;re looking for</h2>
          <PreferencesForm
            cities={data.cities}
            initial={{ cities: p.cities.length ? p.cities : ["Bengaluru"], remoteOk: p.remoteOk, tracks: p.tracks.length ? p.tracks : ["software"], minPayLpa: p.minPayLpa, avoidKinds: p.avoidKinds.length ? p.avoidKinds : ["staffing"] }}
            saving={savePrefs.isPending}
            submitLabel="Show my jobs"
            onSave={(v) => savePrefs.mutate({ ...v, cities: v.cities as never, tracks: v.tracks as never, avoidKinds: v.avoidKinds as never, finishOnboarding: true })}
          />
          {savePrefs.error && <p role="alert" className="text-sm text-bad">{savePrefs.error.message}</p>}
          <button type="button" className="inline-flex h-11 cursor-pointer items-center gap-1 text-sm text-muted-foreground hover:text-foreground" onClick={() => { setDraft(null); setStep(1); }}><ChevronLeft className="size-4" aria-hidden="true" />Back to resume</button>
        </section>
      )}
    </div>
  );
}
