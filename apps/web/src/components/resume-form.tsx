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
    if (!r) return setState({ busy: false, error: "Upload failed: check your internet connection and try again." });
    const body = (await r.json().catch(() => null)) as { parsed?: ResumeData & { internshipMonths?: number; parsedBy?: string }; error?: string } | null;
    if (!r.ok || !body?.parsed) return setState({ busy: false, error: body?.error ?? `Upload failed (error ${r.status}). Please try again, or fill in your details by hand.` });
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
      <p className="mt-1 text-sm text-muted-foreground">PDF or Word (.docx), up to 10 MB</p>
      <input ref={input} type="file" accept="application/pdf,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx" className="sr-only" id="resume-file" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
      <div className="mt-4 flex justify-center">
      <Button type="button" disabled={state.busy} onClick={() => input.current?.click()}>
        {state.busy ? "Reading…" : "Choose file"}
      </Button>
      </div>
      {state.error && <p role="alert" className="mx-auto mt-4 max-w-sm rounded-lg bg-bad-soft p-3 text-sm text-bad">{state.error}</p>}
      <p className="mt-4 flex items-center justify-center gap-1.5 text-[13px] text-muted-foreground"><Lock className="size-3.5 shrink-0" aria-hidden="true" />Encrypted. Read on our servers only, never by an outside AI.</p>
    </div>
  );
}

type Errors = Partial<Record<"skills" | "education" | "gradYear", string>>;

function validate(d: ResumeData): Errors {
  const e: Errors = {};
  if (!d.skills.length) e.skills = "Add at least one skill. Search above or tap a popular one.";
  if (!d.education?.trim()) e.education = "Enter your degree and college, e.g. B.Tech CSE, RV College.";
  const y = d.gradYear;
  if (!y) e.gradYear = "Enter your graduation year (or expected year).";
  else if (y < 1990 || y > new Date().getFullYear() + 5) e.gradYear = "That year doesn't look right.";
  return e;
}

const Req = () => (
  <>
    <span className="text-bad" aria-hidden="true"> *</span>
    <span className="sr-only"> (required)</span>
  </>
);

export function ResumeReview({ initial, onSave, saving, submitLabel, track }: { initial: ResumeData; onSave: (d: ResumeData) => void; saving?: boolean; submitLabel: string; track?: string }) {
  const [d, setD] = useState<ResumeData>(initial);
  const [tried, setTried] = useState(false);
  const errors = tried ? validate(d) : {};
  const years = Math.floor(d.experienceMonths / 12);
  const months = d.experienceMonths % 12;
  const setExp = (y: number, m: number) => setD({ ...d, experienceMonths: Math.max(0, y) * 12 + Math.min(11, Math.max(0, m)) });
  const errText = (id: string, msg?: string) => (msg ? <p id={id} className="mt-1.5 text-[13px] font-medium text-bad">{msg}</p> : null);
  const fieldCls = (bad?: string) => (bad ? "border-bad focus-visible:border-bad" : "");
  return (
    <form
      noValidate
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        setTried(true);
        const errs = validate(d);
        const first = (["skills", "education", "gradYear"] as const).find((k) => errs[k]);
        if (first) {
          document.getElementById(first === "skills" ? "skills-anchor" : first === "education" ? "edu" : "grad")?.scrollIntoView({ behavior: "smooth", block: "center" });
          (document.querySelector(first === "skills" ? "#skills-anchor input" : first === "education" ? "#edu" : "#grad") as HTMLElement | null)?.focus();
          return;
        }
        onSave({ ...d, projects: d.projects.filter((p) => p.title.trim()) });
      }}
    >
      <p className="text-[13px] text-muted-foreground">Fields marked <span className="text-bad">*</span> are required.</p>
      {tried && Object.keys(errors).length > 0 && (
        <div role="alert" className="rounded-xl border border-bad/40 bg-bad-soft p-3.5 text-sm text-bad">
          <b className="font-medium">Please fix {Object.keys(errors).length === 1 ? "1 field" : `${Object.keys(errors).length} fields`}:</b>{" "}
          {Object.values(errors).join(" ")}
        </div>
      )}

      <div id="skills-anchor">
        <SkillsEditor value={d.skills} onChange={(skills) => setD({ ...d, skills })} track={track} required invalid={!!errors.skills} />
        {errText("skills-err", errors.skills)}
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label htmlFor="edu">Degree &amp; college<Req /></Label>
          <Input id="edu" placeholder="e.g. B.Tech Computer Science, RV College of Engineering" aria-invalid={!!errors.education || undefined} aria-describedby={errors.education ? "edu-err" : undefined} className={fieldCls(errors.education)} value={d.education ?? ""} onChange={(e) => setD({ ...d, education: e.target.value })} />
          {errText("edu-err", errors.education)}
        </div>
        <div>
          <Label htmlFor="grad">Graduation year<Req /></Label>
          <Input id="grad" type="number" inputMode="numeric" min={1990} max={2040} placeholder="e.g. 2025" aria-invalid={!!errors.gradYear || undefined} aria-describedby={errors.gradYear ? "grad-err" : undefined} className={fieldCls(errors.gradYear)} value={d.gradYear ?? ""} onChange={(e) => setD({ ...d, gradYear: e.target.value ? Number(e.target.value) : null })} />
          {errText("grad-err", errors.gradYear)}
        </div>
        <div>
          <span className="mb-1.5 block text-sm font-medium" id="exp-label">Full-time work experience<Req /></span>
          <div className="flex items-center gap-2" role="group" aria-labelledby="exp-label">
            <Input aria-label="Years" type="number" inputMode="numeric" min={0} max={40} className="w-20" value={years} onChange={(e) => setExp(Number(e.target.value || 0), months)} />
            <span className="text-sm text-muted-foreground">yrs</span>
            <Input aria-label="Months" type="number" inputMode="numeric" min={0} max={11} className="w-20" value={months} onChange={(e) => setExp(years, Number(e.target.value || 0))} />
            <span className="text-sm text-muted-foreground">mo</span>
          </div>
          <Hint>Freshers: leave 0. Don&apos;t count internships.</Hint>
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="name">Name <span className="font-normal text-muted-foreground">(optional)</span></Label>
          <Input id="name" autoComplete="name" value={d.name ?? ""} onChange={(e) => setD({ ...d, name: e.target.value })} />
        </div>
      </div>

      <fieldset>
        <legend className="text-sm font-medium">Projects <span className="font-normal text-muted-foreground">(optional, but they improve matching)</span></legend>
        <p className="mt-0.5 text-[13px] text-muted-foreground">One line on what you built and with what.</p>
        <div className="mt-2.5 space-y-3">
          {d.projects.map((p, i) => (
            <div key={i} className="rounded-xl border bg-background p-3">
              <div className="flex gap-2">
                <Input aria-label={`Project ${i + 1} title`} placeholder="Project name" value={p.title} onChange={(e) => setD({ ...d, projects: d.projects.map((x, k) => (k === i ? { ...x, title: e.target.value } : x)) })} />
                <button type="button" aria-label={`Remove project ${p.title || i + 1}`} onClick={() => setD({ ...d, projects: d.projects.filter((_, k) => k !== i) })} className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-lg hover:bg-muted">
                  <Trash2 className="size-4" aria-hidden="true" />
                </button>
              </div>
              <Textarea aria-label={`Project ${i + 1} summary`} placeholder="e.g. Placement tracker in Next.js + PostgreSQL, used by 1,200 students" className="mt-2 min-h-16" value={p.summary ?? ""} onChange={(e) => setD({ ...d, projects: d.projects.map((x, k) => (k === i ? { ...x, summary: e.target.value } : x)) })} />
            </div>
          ))}
        </div>
        {d.projects.length < 10 && (
          <button type="button" onClick={() => setD({ ...d, projects: [...d.projects, { title: "" }] })} className="mt-2 inline-flex h-11 cursor-pointer items-center gap-1 rounded-lg px-3 text-sm font-medium text-primary hover:bg-primary-soft">
            <Plus className="size-4" aria-hidden="true" />Add project
          </button>
        )}
      </fieldset>

      <Button type="submit" size="lg" className="w-full sm:w-auto" disabled={saving}>{saving ? "Saving…" : submitLabel}</Button>
    </form>
  );
}
