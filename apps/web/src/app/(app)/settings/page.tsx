"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Download, FileText, Lock, SlidersHorizontal, UserRound } from "lucide-react";
import { useState } from "react";
import { PreferencesForm } from "@/components/preferences-form";
import { ResumeReview, ResumeUpload, type ResumeData } from "@/components/resume-form";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";
import { useTRPC } from "@/trpc/client";

export default function Settings() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { data } = useQuery(trpc.me.get.queryOptions());
  const [draft, setDraft] = useState<ResumeData | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [confirm, setConfirm] = useState("");
  const done = (msg: string) => async () => {
    await qc.invalidateQueries({ queryKey: trpc.me.get.queryKey() });
    setSaved(msg);
    setTimeout(() => setSaved(null), 3000);
  };
  const saveResume = useMutation(trpc.me.saveResumeData.mutationOptions({ onSuccess: async () => { setDraft(null); await done("Profile saved. Updating your matches.")(); } }));
  const savePrefs = useMutation(trpc.me.savePreferences.mutationOptions({ onSuccess: done("Preferences saved. Updating your matches.") }));
  const withdraw = useMutation(trpc.me.withdrawConsent.mutationOptions({ onSuccess: () => window.location.assign("/onboarding") }));
  const del = useMutation(trpc.me.deleteAccount.mutationOptions({ onSuccess: async () => { await authClient.signOut().catch(() => {}); window.location.assign("/?deleted=1"); } }));

  if (!data) return <div className="space-y-4" aria-busy="true"><div className="h-8 w-40 animate-pulse rounded bg-muted" /><div className="h-96 animate-pulse rounded-xl bg-muted" /></div>;
  const p = data.profile;
  const current: ResumeData = { name: p.name ?? "", skills: p.skills, experienceMonths: p.experienceMonths, education: p.education ?? "", gradYear: p.gradYear, projects: p.projects };

  const SECTIONS = [
    { id: "profile", label: "Profile", icon: UserRound },
    { id: "preferences", label: "Preferences", icon: SlidersHorizontal },
    { id: "privacy", label: "Privacy & data", icon: Lock },
  ];
  return (
    <div>
      <h1 className="text-[26px] font-semibold tracking-tight">Settings</h1>
      <p className="mt-1 text-sm text-muted-foreground">{p.email}</p>
      {saved && (
        <p role="status" className="fixed inset-x-4 bottom-20 z-40 mx-auto flex max-w-sm items-center gap-2 rounded-xl bg-foreground px-4 py-3 text-sm text-background shadow-lg sm:bottom-6">
          <CheckCircle2 className="size-4 text-ok" aria-hidden="true" />{saved}
        </p>
      )}

      <nav aria-label="Settings sections" className="-mx-4 mt-5 flex gap-1 overflow-x-auto border-b px-4">
        {SECTIONS.map(({ id, label, icon: Icon }) => (
          <a key={id} href={`#${id}`} className="inline-flex h-11 shrink-0 items-center gap-2 border-b-2 border-transparent px-3 text-sm text-muted-foreground hover:border-border hover:text-foreground">
            <Icon className="size-4" aria-hidden="true" />{label}
          </a>
        ))}
      </nav>

      <div className="mt-8 space-y-12">
        <section id="profile" aria-labelledby="profile-h" className="scroll-mt-24">
          <h2 id="profile-h" className="text-lg font-semibold">Profile</h2>
          <p className="mb-4 mt-1 text-sm text-muted-foreground">What we match on. Upload a new resume or edit the details directly.</p>
          <Card className="space-y-6">
            {p.resumeUploadedAt && (
              <div className="flex flex-wrap items-center gap-3 rounded-lg bg-muted px-3.5 py-2.5 text-sm">
                <FileText className="size-4 text-muted-foreground" aria-hidden="true" />
                <span>Resume uploaded {new Date(p.resumeUploadedAt).toLocaleDateString("en-IN", { dateStyle: "medium" })}</span>
                <a className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-md px-2 text-primary hover:bg-primary-soft" href="/api/me/resume"><Download className="size-4" aria-hidden="true" />Download</a>
              </div>
            )}
            <ResumeUpload hasResume={!!p.resumeKey} onParsed={(d) => setDraft({ ...current, ...d, name: d.name || current.name })} />
            <ResumeReview key={draft ? "draft" : "saved"} initial={draft ?? current} saving={saveResume.isPending} submitLabel="Save profile" onSave={(d) => saveResume.mutate({ ...d, name: d.name ?? undefined, education: d.education ?? undefined })} />
          </Card>
        </section>

        <section id="preferences" aria-labelledby="prefs-h" className="scroll-mt-24">
          <h2 id="prefs-h" className="text-lg font-semibold">Job preferences</h2>
          <p className="mb-4 mt-1 text-sm text-muted-foreground">Changes update your matches within a few seconds.</p>
          <Card>
            <PreferencesForm
              cities={data.cities}
              initial={{ cities: p.cities, remoteOk: p.remoteOk, tracks: p.tracks, minPayLpa: p.minPayLpa, avoidKinds: p.avoidKinds }}
              saving={savePrefs.isPending}
              submitLabel="Save preferences"
              onSave={(v) => savePrefs.mutate({ ...v, cities: v.cities as never, tracks: v.tracks as never, avoidKinds: v.avoidKinds as never })}
            />
          </Card>
        </section>

        <section id="privacy" aria-labelledby="privacy-h" className="scroll-mt-24">
          <h2 id="privacy-h" className="text-lg font-semibold">Privacy &amp; data</h2>
          <p className="mb-4 mt-1 text-sm text-muted-foreground">Your rights under India&apos;s DPDP Act. Read the <a className="text-primary underline underline-offset-2" href="/privacy">privacy notice</a>.</p>
          <Card className="divide-y p-0">
            <div className="flex flex-wrap items-center justify-between gap-4 p-5">
              <div className="max-w-md">
                <h3 className="font-medium">Download your data</h3>
                <p className="mt-0.5 text-sm text-muted-foreground">Profile, consent history and matches as a JSON file.</p>
              </div>
              <a href="/api/me/export" className="inline-flex h-11 items-center gap-2 rounded-lg border px-4 text-sm font-medium hover:bg-muted"><Download className="size-4" aria-hidden="true" />Download</a>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-4 p-5">
              <div className="max-w-md">
                <h3 className="font-medium">Withdraw consent</h3>
                <p className="mt-0.5 text-sm text-muted-foreground">We stop matching and delete your resume and the details read from it. Your account stays, and you can opt in again.</p>
              </div>
              <Button variant="outline" disabled={withdraw.isPending} onClick={() => withdraw.mutate()}>{withdraw.isPending ? "Withdrawing…" : "Withdraw consent"}</Button>
            </div>
            <div className="space-y-3 bg-bad-soft/40 p-5">
              <div className="max-w-md">
                <h3 className="font-medium text-bad">Delete account</h3>
                <p className="mt-0.5 text-sm text-muted-foreground">Deletes your resume, profile and matches right away and your login within 7 days. This can&apos;t be undone.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label htmlFor="confirm" className="sr-only">Type DELETE to confirm</label>
                <Input id="confirm" className="w-44" placeholder="Type DELETE" autoComplete="off" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
                <Button variant="destructive" disabled={confirm !== "DELETE" || del.isPending} onClick={() => del.mutate({ confirm: "DELETE" })}>{del.isPending ? "Deleting…" : "Delete my account"}</Button>
              </div>
            </div>
          </Card>
        </section>
      </div>
    </div>
  );
}
