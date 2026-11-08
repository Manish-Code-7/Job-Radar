"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileText } from "lucide-react";
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

  if (!data) return <p role="status" className="text-muted-foreground">Loading…</p>;
  const p = data.profile;
  const current: ResumeData = { name: p.name ?? "", skills: p.skills, experienceMonths: p.experienceMonths, education: p.education ?? "", gradYear: p.gradYear, projects: p.projects };

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      {saved && <p role="status" className="rounded-lg bg-ok/12 p-3 text-sm text-ok">{saved}</p>}

      <section aria-labelledby="profile-h">
        <h2 id="profile-h" className="mb-3 text-lg font-semibold">Profile</h2>
        <Card className="space-y-4 p-5">
          {p.resumeUploadedAt && (
            <p className="flex flex-wrap items-center gap-2 text-sm">
              <FileText className="size-4 text-muted-foreground" aria-hidden="true" />
              Resume uploaded {new Date(p.resumeUploadedAt).toLocaleDateString("en-IN", { dateStyle: "medium" })}
              <a className="inline-flex h-11 items-center text-primary underline" href="/api/me/resume">Download</a>
            </p>
          )}
          <ResumeUpload hasResume={!!p.resumeKey} onParsed={(d) => setDraft({ ...current, ...d, name: d.name || current.name })} />
          <ResumeReview key={draft ? "draft" : "saved"} initial={draft ?? current} saving={saveResume.isPending} submitLabel="Save profile" onSave={(d) => saveResume.mutate({ ...d, name: d.name ?? undefined, education: d.education ?? undefined })} />
        </Card>
      </section>

      <section aria-labelledby="prefs-h">
        <h2 id="prefs-h" className="mb-3 text-lg font-semibold">Job preferences</h2>
        <Card className="p-5">
          <PreferencesForm
            cities={data.cities}
            initial={{ cities: p.cities, remoteOk: p.remoteOk, tracks: p.tracks, minPayLpa: p.minPayLpa, avoidKinds: p.avoidKinds }}
            saving={savePrefs.isPending}
            submitLabel="Save preferences"
            onSave={(v) => savePrefs.mutate({ ...v, cities: v.cities as never, tracks: v.tracks as never, avoidKinds: v.avoidKinds as never })}
          />
        </Card>
      </section>

      <section aria-labelledby="privacy-h">
        <h2 id="privacy-h" className="mb-3 text-lg font-semibold">Privacy</h2>
        <Card className="divide-y p-0">
          <div className="flex flex-wrap items-center justify-between gap-3 p-5">
            <div>
              <h3 className="font-medium">Download your data</h3>
              <p className="text-sm text-muted-foreground">Your profile, consent history and matches as a JSON file.</p>
            </div>
            <a href="/api/me/export" className="inline-flex h-11 items-center gap-2 rounded-lg border px-4 text-sm hover:bg-muted"><Download className="size-4" aria-hidden="true" />Download</a>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 p-5">
            <div className="max-w-md">
              <h3 className="font-medium">Withdraw consent</h3>
              <p className="text-sm text-muted-foreground">We stop matching and delete your resume and the details read from it. Your account stays; you can opt in again later.</p>
            </div>
            <Button variant="outline" className="h-11" disabled={withdraw.isPending} onClick={() => withdraw.mutate()}>{withdraw.isPending ? "Withdrawing…" : "Withdraw consent"}</Button>
          </div>
          <div className="space-y-3 p-5">
            <div className="max-w-md">
              <h3 className="font-medium text-bad">Delete account</h3>
              <p className="text-sm text-muted-foreground">Deletes your resume, profile and matches right away and your login within 7 days. This can&apos;t be undone.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="confirm" className="sr-only">Type DELETE to confirm</label>
              <Input id="confirm" className="h-11 w-44" placeholder="Type DELETE" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              <Button variant="destructive" className="h-11" disabled={confirm !== "DELETE" || del.isPending} onClick={() => del.mutate({ confirm: "DELETE" })}>{del.isPending ? "Deleting…" : "Delete my account"}</Button>
            </div>
          </div>
        </Card>
        <p className="mt-2 text-sm text-muted-foreground">Read the <a className="text-primary underline" href="/privacy">privacy notice</a>.</p>
      </section>
    </div>
  );
}
