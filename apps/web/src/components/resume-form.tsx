"use client";
import { Plus, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
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
  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const f = e.dataTransfer.files[0];
        if (f) void upload(f);
      }}
      className="rounded-xl border-2 border-dashed bg-card p-6 text-center"
    >
      <Upload className="mx-auto size-8 text-muted-foreground" aria-hidden="true" />
      <p className="mt-2 font-medium">{hasResume ? "Replace your resume" : "Upload your resume"}</p>
      <p className="text-sm text-muted-foreground">PDF, up to 5 MB. Drag it here or choose a file.</p>
      <input ref={input} type="file" accept="application/pdf,.pdf" className="sr-only" id="resume-file" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
      <Button type="button" className="mt-4 h-11" disabled={state.busy} onClick={() => input.current?.click()}>
        {state.busy ? `Reading ${state.name}…` : "Choose PDF"}
      </Button>
      {state.error && <p role="alert" className="mt-3 text-sm text-bad">{state.error}</p>}
      <p className="mt-3 text-xs text-muted-foreground">Stored encrypted. Read on our own server only; never sent to an outside AI.</p>
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
          <label htmlFor="name" className="mb-1 block text-sm font-medium">Name</label>
          <Input id="name" className="h-11" value={d.name ?? ""} onChange={(e) => setD({ ...d, name: e.target.value })} autoComplete="name" />
        </div>
        <div>
          <span className="mb-1 block text-sm font-medium" id="exp-label">Full-time work experience</span>
          <div className="flex items-center gap-2" role="group" aria-labelledby="exp-label">
            <Input aria-label="Years" type="number" min={0} max={40} className="h-11 w-20" value={years} onChange={(e) => setExp(Number(e.target.value || 0), months)} />
            <span className="text-sm text-muted-foreground">yrs</span>
            <Input aria-label="Months" type="number" min={0} max={11} className="h-11 w-20" value={months} onChange={(e) => setExp(years, Number(e.target.value || 0))} />
            <span className="text-sm text-muted-foreground">months</span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Don&apos;t count internships. Freshers: 0.</p>
        </div>
        <div>
          <label htmlFor="edu" className="mb-1 block text-sm font-medium">Degree &amp; college</label>
          <Input id="edu" className="h-11" value={d.education ?? ""} onChange={(e) => setD({ ...d, education: e.target.value })} />
        </div>
        <div>
          <label htmlFor="grad" className="mb-1 block text-sm font-medium">Graduation year</label>
          <Input id="grad" type="number" min={1990} max={2040} className="h-11" value={d.gradYear ?? ""} onChange={(e) => setD({ ...d, gradYear: e.target.value ? Number(e.target.value) : null })} />
        </div>
      </div>

      <SkillsEditor value={d.skills} onChange={(skills) => setD({ ...d, skills })} />

      <fieldset>
        <legend className="mb-2 text-sm font-medium">Projects</legend>
        <div className="space-y-3">
          {d.projects.map((p, i) => (
            <div key={i} className="rounded-lg border p-3">
              <div className="flex gap-2">
                <Input aria-label={`Project ${i + 1} title`} className="h-11" value={p.title} onChange={(e) => setD({ ...d, projects: d.projects.map((x, k) => (k === i ? { ...x, title: e.target.value } : x)) })} />
                <button type="button" aria-label={`Remove project ${p.title || i + 1}`} onClick={() => setD({ ...d, projects: d.projects.filter((_, k) => k !== i) })} className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-lg hover:bg-muted">
                  <Trash2 className="size-4" aria-hidden="true" />
                </button>
              </div>
              <Textarea aria-label={`Project ${i + 1} summary`} className="mt-2 min-h-16" value={p.summary ?? ""} onChange={(e) => setD({ ...d, projects: d.projects.map((x, k) => (k === i ? { ...x, summary: e.target.value } : x)) })} />
            </div>
          ))}
        </div>
        {d.projects.length < 10 && (
          <button type="button" onClick={() => setD({ ...d, projects: [...d.projects, { title: "" }] })} className="mt-2 inline-flex h-11 cursor-pointer items-center gap-1 rounded-lg px-3 text-sm text-primary hover:bg-muted">
            <Plus className="size-4" aria-hidden="true" />Add project
          </button>
        )}
      </fieldset>

      <Button type="submit" className="h-11 w-full sm:w-auto" disabled={saving || !d.skills.length}>{saving ? "Saving…" : submitLabel}</Button>
      {!d.skills.length && <p className="text-sm text-muted-foreground">Add at least one skill to continue.</p>}
    </form>
  );
}
