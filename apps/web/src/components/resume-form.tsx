"use client";
import { FileUp, Lock, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Hint, Input, Label, Textarea } from "@/components/ui/input";
import { SkillsEditor } from "./skills-editor";

export interface ResumeData {
  name?: string;
  skills: string[];
  experienceMonths: number;
  education?: string;
  gradYear?: number | null;
  projects: { title: string; summary?: string }[];
}

export function ResumeUpload({ onParsed, hasResume }: { onParsed: (d: ResumeData & { internshipMonths?: number; parsedBy?: string }) => void; hasResume?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<{ busy: boolean; error?: string; name?: string }>({ busy: false });
  async function upload(file: File) {
    setState({ busy: true, name: file.name });
    const fd = new FormData();
    fd.set("resume", file);
    const r = await fetch("/api/me/resume", { method: "POST", body: fd }).catch(() => null);
    const body = (await r?.json().catch(() => null)) as { parsed?: ResumeData & { internshipMonths?: number; parsedBy?: string }; error?: string } | null;
    if (!r?.ok || !body?.parsed) return setState({ busy: false, error: body?.error ?? "Upload failed. Please try again." });
    setState({ busy: false, name: file.name });
    onParsed(body.parsed);
  }
  const [over, setOver] = useState(false);
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer.files[0];
        if (f) void upload(f);
      }}
      className={cn("rounded-xl border-2 border-dashed p-8 text-center transition-colors", over ? "border-primary bg-primary-soft" : "bg-card")}
    >
      <span className="mx-auto grid size-12 place-items-center rounded-full bg-primary-soft text-primary">
        {state.busy ? <span className="size-5 animate-spin rounded-full border-2 border-primary border-t-transparent" aria-hidden="true" /> : <FileUp className="size-6" aria-hidden="true" />}
      </span>
      <p className="mt-3 font-medium">{state.busy ? `Reading ${state.name}…` : hasResume ? "Replace your resume" : "Drop your resume here"}</p>
      <p className="mt-1 text-sm text-muted-foreground">PDF up to 5 MB</p>
      <input ref={input} type="file" accept="application/pdf,.pdf" className="sr-only" id="resume-file" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
      <Button type="button" className="mt-4" disabled={state.busy} onClick={() => input.current?.click()}>
        {state.busy ? "Reading…" : "Choose PDF"}
      </Button>
      {state.error && <p role="alert" className="mx-auto mt-4 max-w-sm rounded-lg bg-bad-soft p-3 text-sm text-bad">{state.error}</p>}
      <p className="mt-4 inline-flex items-center gap-1.5 text-[13px] text-muted-foreground"><Lock className="size-3.5" aria-hidden="true" />Encrypted. Read on our servers only, never by an outside AI.</p>
    </div>
  );
}

export function ResumeReview({ initial, onSave, saving, submitLabel }: { initial: ResumeData; onSave: (d: ResumeData) => void; saving?: boolean; submitLabel: string }) {
  const [d, setD] = useState<ResumeData>(initial);
  const years = Math.floor(d.experienceMonths / 12);
  const months = d.experienceMonths % 12;
  const setExp = (y: number, m: number) => setD({ ...d, experienceMonths: Math.max(0, y) * 12 + Math.min(11, Math.max(0, m)) });
  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ ...d, projects: d.projects.filter((p) => p.title.trim()) });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="name">Name</Label>
          <Input id="name" value={d.name ?? ""} onChange={(e) => setD({ ...d, name: e.target.value })} autoComplete="name" />
        </div>
        <div>
          <span className="mb-1.5 block text-sm font-medium" id="exp-label">Full-time work experience</span>
          <div className="flex items-center gap-2" role="group" aria-labelledby="exp-label">
            <Input aria-label="Years" type="number" min={0} max={40} className="w-20" value={years} onChange={(e) => setExp(Number(e.target.value || 0), months)} />
            <span className="text-sm text-muted-foreground">yrs</span>
            <Input aria-label="Months" type="number" min={0} max={11} className="w-20" value={months} onChange={(e) => setExp(years, Number(e.target.value || 0))} />
            <span className="text-sm text-muted-foreground">months</span>
          </div>
          <Hint>Don&apos;t count internships. Freshers: 0.</Hint>
        </div>
        <div>
          <Label htmlFor="edu">Degree &amp; college</Label>
          <Input id="edu" value={d.education ?? ""} onChange={(e) => setD({ ...d, education: e.target.value })} />
        </div>
        <div>
          <Label htmlFor="grad">Graduation year</Label>
          <Input id="grad" type="number" min={1990} max={2040} value={d.gradYear ?? ""} onChange={(e) => setD({ ...d, gradYear: e.target.value ? Number(e.target.value) : null })} />
        </div>
      </div>

      <SkillsEditor value={d.skills} onChange={(skills) => setD({ ...d, skills })} />

      <fieldset>
        <legend className="mb-2 text-sm font-medium">Projects <span className="font-normal text-muted-foreground">(optional, helps matching)</span></legend>
        <div className="space-y-3">
          {d.projects.map((p, i) => (
            <div key={i} className="rounded-xl border bg-background p-3">
              <div className="flex gap-2">
                <Input aria-label={`Project ${i + 1} title`} placeholder="Project name" value={p.title} onChange={(e) => setD({ ...d, projects: d.projects.map((x, k) => (k === i ? { ...x, title: e.target.value } : x)) })} />
                <button type="button" aria-label={`Remove project ${p.title || i + 1}`} onClick={() => setD({ ...d, projects: d.projects.filter((_, k) => k !== i) })} className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-lg hover:bg-muted">
                  <Trash2 className="size-4" aria-hidden="true" />
                </button>
              </div>
              <Textarea aria-label={`Project ${i + 1} summary`} placeholder="What you built and with what" className="mt-2 min-h-16" value={p.summary ?? ""} onChange={(e) => setD({ ...d, projects: d.projects.map((x, k) => (k === i ? { ...x, summary: e.target.value } : x)) })} />
            </div>
          ))}
        </div>
        {d.projects.length < 10 && (
          <button type="button" onClick={() => setD({ ...d, projects: [...d.projects, { title: "" }] })} className="mt-2 inline-flex h-11 cursor-pointer items-center gap-1 rounded-lg px-3 text-sm text-primary hover:bg-muted">
            <Plus className="size-4" aria-hidden="true" />Add project
          </button>
        )}
      </fieldset>

      <Button type="submit" size="lg" className="w-full sm:w-auto" disabled={saving || !d.skills.length}>{saving ? "Saving…" : submitLabel}</Button>
      {!d.skills.length && <p className="text-sm text-muted-foreground">Add at least one skill to continue.</p>}
    </form>
  );
}
