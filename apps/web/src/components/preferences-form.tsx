"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Hint, Input, Label } from "@/components/ui/input";
import { Chips } from "./chips";

export const TRACK_OPTIONS = ["software", "ai_ml", "devops", "data", "qa"] as const;
export const TRACK_LABEL: Record<string, string> = { software: "Software", ai_ml: "AI / ML", devops: "DevOps / SRE", data: "Data", qa: "QA / Testing", other: "Other" };
const KIND_OPTIONS = ["services", "staffing", "startup", "mnc", "gcc", "product"] as const;
const KIND_LABEL: Record<string, string> = { services: "IT services", staffing: "Staffing agencies", startup: "Startups", mnc: "MNCs", gcc: "GCCs", product: "Product companies" };

export interface Prefs {
  cities: string[];
  remoteOk: boolean;
  tracks: string[];
  minPayLpa: number | null;
  avoidKinds: string[];
}

export function PreferencesForm({ initial, cities, onSave, saving, submitLabel }: { initial: Prefs; cities: readonly string[]; onSave: (p: Prefs) => void; saving?: boolean; submitLabel: string }) {
  const [p, setP] = useState<Prefs>(initial);
  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(p);
      }}
    >
      <Chips label="Roles you want *" hint="Required. Pick one or more." options={TRACK_OPTIONS} value={p.tracks as (typeof TRACK_OPTIONS)[number][]} onChange={(tracks) => setP({ ...p, tracks })} render={(t) => TRACK_LABEL[t]!} />
      <Chips label="Cities *" hint="Required: pick at least one city, or turn on remote below." options={cities} value={p.cities} onChange={(c) => setP({ ...p, cities: c })} />
      <label className="flex min-h-14 cursor-pointer items-center justify-between gap-4 rounded-xl border bg-card px-4">
        <span>
          <span className="block text-sm font-medium">Remote jobs in India</span>
          <span className="block text-[13px] text-muted-foreground">Show work-from-home roles too</span>
        </span>
        <input type="checkbox" role="switch" className="peer sr-only" checked={p.remoteOk} onChange={(e) => setP({ ...p, remoteOk: e.target.checked })} />
        <span aria-hidden="true" className="relative h-6 w-11 shrink-0 rounded-full bg-muted ring-1 ring-border transition-colors peer-checked:bg-primary peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary after:absolute after:left-0.5 after:top-0.5 after:size-5 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-5" />
      </label>
      <div>
        <Label htmlFor="minpay">Minimum pay <span className="font-normal text-muted-foreground">(LPA, optional)</span></Label>
        <Input id="minpay" type="number" min={0} max={100} step={0.5} placeholder="e.g. 6" className="w-32" value={p.minPayLpa ?? ""} onChange={(e) => setP({ ...p, minPayLpa: e.target.value === "" ? null : Number(e.target.value) })} />
        <Hint>Only applied when a job states its pay. Most don&apos;t.</Hint>
      </div>
      <Chips label="Hide jobs from" hint="We already leave out staffing agencies by default." options={KIND_OPTIONS} value={p.avoidKinds as (typeof KIND_OPTIONS)[number][]} onChange={(avoidKinds) => setP({ ...p, avoidKinds })} render={(k) => KIND_LABEL[k]!} />
      {(!p.tracks.length || (!p.cities.length && !p.remoteOk)) && (
        <p role="alert" className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">
          {!p.tracks.length ? "Pick at least one role. " : ""}
          {!p.cities.length && !p.remoteOk ? "Pick at least one city, or turn on remote jobs." : ""}
        </p>
      )}
      <Button type="submit" size="lg" className="w-full sm:w-auto" disabled={saving || !p.tracks.length || (!p.cities.length && !p.remoteOk)}>{saving ? "Saving…" : submitLabel}</Button>
    </form>
  );
}
