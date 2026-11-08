"use client";
import { canonicalSkill, POPULAR_BY_TRACK, searchSkills } from "@job-radar/core/skills";
import { Plus, Search, X } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Skills picker: search-as-you-type over ~180 languages, frameworks, databases, cloud tools and
 * concepts (with category labels), one-tap popular picks for the user's role, and free-text entry.
 * Accessible combobox: arrows to move, Enter to add, Escape to close, Backspace removes the last chip.
 */
export function SkillsEditor({ value, onChange, track = "software", required, invalid }: { value: string[]; onChange: (v: string[]) => void; track?: string; required?: boolean; invalid?: boolean }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const hintId = useId();

  const suggestions = useMemo(() => searchSkills(q, value, 8), [q, value]);
  const custom = q.trim() && !suggestions.some((s) => s.name.toLowerCase() === q.trim().toLowerCase()) && !value.some((v) => v.toLowerCase() === q.trim().toLowerCase());
  const options = [...suggestions.map((s) => ({ label: s.name, hint: s.category })), ...(custom ? [{ label: q.trim(), hint: "Add as typed" }] : [])];
  const popular = (POPULAR_BY_TRACK[track] ?? POPULAR_BY_TRACK.software!).filter((s) => !value.includes(s));

  const add = (raw: string) => {
    const parts = raw.split(",").map((s) => canonicalSkill(s)).filter(Boolean);
    const next = [...value];
    for (const p of parts) if (!next.some((x) => x.toLowerCase() === p.toLowerCase())) next.push(p);
    onChange(next.slice(0, 40));
    setQ("");
    setActive(0);
    input.current?.focus();
  };

  return (
    <div>
      <label htmlFor={`${listId}-input`} className="block text-sm font-medium">
        Skills &amp; frameworks {required && <span className="text-bad" aria-hidden="true">*</span>}
        <span className="ml-1 font-normal text-muted-foreground">({value.length})</span>
      </label>
      <p id={hintId} className="mt-0.5 text-[13px] text-muted-foreground">
        Languages, frameworks, databases, cloud and tools you&apos;ve actually used. Add at least 5 for good matches.
      </p>

      <div
        className={cn("mt-2 rounded-xl border bg-card p-2 transition-colors focus-within:border-primary focus-within:outline-2 focus-within:outline-primary/25", invalid && "border-bad")}
        onClick={() => input.current?.focus()}
      >
        {value.length > 0 && (
          <ul className="mb-2 flex flex-wrap gap-1.5" aria-label="Your skills">
            {value.map((s) => (
              <li key={s} className="inline-flex items-center gap-0.5 rounded-full bg-primary-soft py-0.5 pl-3 pr-0.5 text-sm font-medium text-primary">
                {s}
                <button type="button" onClick={(e) => { e.stopPropagation(); onChange(value.filter((x) => x !== s)); }} className="grid size-8 cursor-pointer place-items-center rounded-full hover:bg-primary/15" aria-label={`Remove ${s}`}>
                  <X className="size-3.5" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            ref={input}
            id={`${listId}-input`}
            role="combobox"
            aria-expanded={open && options.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={open && options[active] ? `${listId}-o${active}` : undefined}
            aria-describedby={hintId}
            aria-invalid={invalid || undefined}
            autoComplete="off"
            placeholder={value.length ? "Add another skill…" : "Search e.g. React, Spring Boot, AWS, SQL…"}
            className="h-11 w-full rounded-lg bg-transparent pl-8 pr-2 text-[15px] outline-none placeholder:text-muted-foreground/70"
            value={q}
            onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(0); }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 120)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, options.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
              else if (e.key === "Enter" || e.key === ",") {
                if (q.trim()) { e.preventDefault(); add(options[active]?.label ?? q); }
                else if (e.key === "Enter") e.preventDefault();
              } else if (e.key === "Escape") setOpen(false);
              else if (e.key === "Backspace" && !q && value.length) onChange(value.slice(0, -1));
            }}
          />
          {open && options.length > 0 && (
            <ul id={listId} role="listbox" className="absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-auto rounded-xl border bg-card p-1 shadow-lg shadow-black/5">
              {options.map((o, i) => (
                <li
                  key={o.label}
                  id={`${listId}-o${i}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseDown={(e) => { e.preventDefault(); add(o.label); }}
                  onMouseEnter={() => setActive(i)}
                  className={cn("flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-lg px-3 text-sm", i === active && "bg-muted")}
                >
                  <span className="font-medium">{o.label}</span>
                  <span className="text-xs text-muted-foreground">{o.hint}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {popular.length > 0 && (
        <div className="mt-3">
          <p className="text-[13px] text-muted-foreground">Popular for your role, tap to add:</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {popular.slice(0, 10).map((s) => (
              <button key={s} type="button" onClick={() => add(s)} className="inline-flex h-9 cursor-pointer items-center gap-1 rounded-full border border-dashed px-3 text-sm text-muted-foreground transition-colors hover:border-primary hover:text-primary">
                <Plus className="size-3.5" aria-hidden="true" />{s}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
