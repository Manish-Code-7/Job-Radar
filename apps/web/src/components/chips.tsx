"use client";
import { cn } from "@/lib/utils";

/** Multi-select chips (accessible toggle buttons). */
export function Chips<T extends string>({ label, options, value, onChange, render }: { label: string; options: readonly T[]; value: T[]; onChange: (v: T[]) => void; render?: (o: T) => string }) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const on = value.includes(o);
          return (
            <button
              key={o}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(on ? value.filter((x) => x !== o) : [...value, o])}
              className={cn("h-10 cursor-pointer rounded-full border px-4 text-sm transition-colors duration-150", on ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted")}
            >
              {render ? render(o) : o}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
