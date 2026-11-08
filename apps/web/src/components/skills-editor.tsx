"use client";
import { X } from "lucide-react";
import { useState } from "react";
import { Input } from "@/components/ui/input";

export function SkillsEditor({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const parts = draft.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length) onChange([...new Set([...value, ...parts])].slice(0, 40));
    setDraft("");
  };
  return (
    <div>
      <label htmlFor="skill-input" className="mb-2 block text-sm font-medium">Skills</label>
      <ul className="mb-2 flex flex-wrap gap-1.5" aria-label="Your skills">
        {value.map((s) => (
          <li key={s} className="inline-flex items-center gap-1 rounded-full bg-primary/12 py-1 pl-3 pr-1 text-sm text-primary">
            {s}
            <button type="button" onClick={() => onChange(value.filter((x) => x !== s))} className="grid size-7 cursor-pointer place-items-center rounded-full hover:bg-primary/20" aria-label={`Remove ${s}`}>
              <X className="size-3.5" aria-hidden="true" />
            </button>
          </li>
        ))}
        {!value.length && <li className="text-sm text-muted-foreground">No skills yet. Add a few below.</li>}
      </ul>
      <div className="flex gap-2">
        <Input id="skill-input" placeholder="e.g. Java, React" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} className="h-11" />
        <button type="button" onClick={add} className="h-11 shrink-0 cursor-pointer rounded-lg border bg-card px-4 text-sm hover:bg-muted">Add</button>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">Press Enter or comma-separate several.</p>
    </div>
  );
}
