"use client";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/** Multi-select chips (accessible toggle buttons). */
export function Chips<T extends string>({ label, hint, options, value, onChange, render }: { label: string; hint?: string; options: readonly T[]; value: T[]; onChange: (v: T[]) => void; render?: (o: T) => string }) {
  return (
    <fieldset>
      <legend className="text-sm font-medium">{label}</legend>
      {hint && <p className="mt-0.5 text-[13px] text-muted-foreground">{hint}</p>}
      <div className="mt-2.5 flex flex-wrap gap-2">
        {options.map((o) => {
          const on = value.includes(o);
          return (
            <button
              key={o}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(on ? value.filter((x) => x !== o) : [...value, o])}
              className={cn("inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-full border px-4 text-sm transition-colors duration-150", on ? "border-primary bg-primary-soft font-medium text-primary" : "bg-card text-muted-foreground hover:border-foreground/25 hover:text-foreground")}
            >
              {on && <Check className="size-3.5" aria-hidden="true" />}
              {render ? render(o) : o}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
