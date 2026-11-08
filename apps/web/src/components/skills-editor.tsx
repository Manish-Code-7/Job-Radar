"use client";
import { X } from "lucide-react";
import { useState } from "react";
import { Hint, Input } from "@/components/ui/input";

export function SkillsEditor({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const parts = draft.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length) onChange([...new Set([...value, ...parts])].slice(0, 40));
    setDraft("");
  };
  return (
    <div>
      <label htmlFor="skill-input" className="mb-2 block text-sm font-medium">Skills <span className="font-normal text-muted-foreground">({value.length})</span></label>
      <ul className="mb-2 flex flex-wrap gap-1.5" aria-label="Your skills">
        {value.map((s) => (
          <li key={s} className="inline-flex items-center gap-0.5 rounded-full bg-primary-soft py-0.5 pl-3 pr-0.5 text-sm font-medium text-primary">
            {s}
            <button type="button" onClick={() => onChange(value.filter((x) => x !== s))} className="grid size-8 cursor-pointer place-items-center rounded-full hover:bg-primary/15" aria-label={`Remove ${s}`}>
              <X className="size-3.5" aria-hidden="true" />
            </button>
          </li>
        ))}
        {!value.length && <li className="text-sm text-muted-foreground">No skills yet. Add a few below.</li>}
      </ul>
      <div className="flex gap-2">
        <Input id="skill-input" placeholder="Add a skill, e.g. Java, React" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
        <button type="button" onClick={add} disabled={!draft.trim()} className="h-11 shrink-0 cursor-pointer rounded-lg border bg-card px-4 text-sm font-medium hover:bg-muted disabled:opacity-50">Add</button>
      </div>
      <Hint>Press Enter to add. Separate several with commas.</Hint>
    </div>
  );
}
