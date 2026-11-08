"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { useEffect, useState } from "react";
import { PreferencesForm } from "@/components/preferences-form";
import { ResumeReview, ResumeUpload, type ResumeData } from "@/components/resume-form";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";

const STEPS = ["Your data", "Resume", "Preferences"] as const;

function Stepper({ step }: { step: number }) {
  return (
    <ol className="mb-8 grid grid-cols-3 gap-2" aria-label="Onboarding progress">
      {STEPS.map((label, i) => (
        <li key={label} className="text-xs sm:text-sm" aria-current={i === step ? "step" : undefined}>
          <div className={cn("mb-2 h-1.5 rounded-full", i <= step ? "bg-primary" : "bg-muted")} />
          <span className={cn("inline-flex items-center gap-1", i === step ? "font-medium" : "text-muted-foreground")}>
            {i < step && <Check className="size-3.5 text-primary" aria-hidden="true" />}
            {i + 1}. {label}
          </span>
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

  if (!data || step === null) return <p className="text-muted-foreground" role="status">Loading…</p>;
  const p = data.profile;

  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Set up your feed</h1>
      <p className="mb-6 text-sm text-muted-foreground">Three short steps. You can change everything later in Settings.</p>
      <Stepper step={step} />

      {step === 0 && (
        <section aria-labelledby="consent-h" className="space-y-4">
          <h2 id="consent-h" className="text-lg font-semibold">How we use your data</h2>
          <div className="space-y-3 rounded-xl border bg-card p-4 text-sm leading-relaxed">
            <p><b>What we collect:</b> your email; your resume (PDF); details we read from it (skills, experience, education, graduation year, projects); your job preferences; and which jobs you hide, open or report.</p>
            <p><b>Why:</b> {data.consentPurposes.join("; ")}. Nothing else. We don&apos;t sell or share your data.</p>
            <p><b>How:</b> your resume is stored encrypted and read on our own server. It is never sent to an outside AI service. Job matching runs on our server too.</p>
            <p><b>Your rights:</b> download all your data, change it, withdraw this consent, or delete your account at any time in Settings. Deletion removes your resume and profile immediately and your login within 7 days.</p>
            <p><b>Questions or complaints:</b> see our <a className="text-primary underline" href="/privacy" target="_blank">privacy notice</a> for the grievance contact.</p>
          </div>
          <label className="flex min-h-11 cursor-pointer items-start gap-3">
            <input type="checkbox" className="mt-0.5 size-5 accent-[var(--primary)]" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            <span className="text-sm">I agree to Job Radar using my data for the purposes above (notice version {data.consentVersion}).</span>
          </label>
          <Button className="h-11" disabled={!agree || consent.isPending} onClick={() => consent.mutate({ version: data.consentVersion as "2026-11-08" })}>
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
              <button type="button" className="h-11 cursor-pointer text-sm text-primary underline" onClick={() => setDraft({ name: p.name ?? "", skills: p.skills, experienceMonths: p.experienceMonths, education: p.education ?? "", gradYear: p.gradYear, projects: p.projects })}>
                No resume handy? Fill it in yourself
              </button>
            </>
          )}
          {draft && (
            <>
              <p className="rounded-lg bg-muted p-3 text-sm">Check what we picked up and fix anything that&apos;s wrong. Matching uses exactly this.</p>
              <ResumeReview initial={draft} saving={saveResume.isPending} submitLabel="Looks right, continue" onSave={(d) => saveResume.mutate({ ...d, name: d.name ?? undefined, education: d.education ?? undefined })} />
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
          <button type="button" className="h-11 cursor-pointer text-sm text-muted-foreground underline" onClick={() => { setDraft(null); setStep(1); }}>Back to resume</button>
        </section>
      )}
    </div>
  );
}
