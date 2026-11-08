"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
      <Chips label="Roles you want" options={TRACK_OPTIONS} value={p.tracks as (typeof TRACK_OPTIONS)[number][]} onChange={(tracks) => setP({ ...p, tracks })} render={(t) => TRACK_LABEL[t]!} />
      <Chips label="Cities" options={cities} value={p.cities} onChange={(c) => setP({ ...p, cities: c })} />
      <label className="flex min-h-11 cursor-pointer items-center gap-3">
        <input type="checkbox" className="size-5 accent-[var(--primary)]" checked={p.remoteOk} onChange={(e) => setP({ ...p, remoteOk: e.target.checked })} />
        <span className="text-sm">Also show remote jobs in India</span>
      </label>
      <div>
        <label htmlFor="minpay" className="mb-1 block text-sm font-medium">Minimum pay (LPA, optional)</label>
        <Input id="minpay" type="number" min={0} max={100} step={0.5} className="h-11 w-32" value={p.minPayLpa ?? ""} onChange={(e) => setP({ ...p, minPayLpa: e.target.value === "" ? null : Number(e.target.value) })} />
        <p className="mt-1 text-xs text-muted-foreground">Only applied when a job states its pay. Most don&apos;t.</p>
      </div>
      <Chips label="Hide jobs from" options={KIND_OPTIONS} value={p.avoidKinds as (typeof KIND_OPTIONS)[number][]} onChange={(avoidKinds) => setP({ ...p, avoidKinds })} render={(k) => KIND_LABEL[k]!} />
      <Button type="submit" className="h-11 w-full sm:w-auto" disabled={saving || (!p.cities.length && !p.remoteOk)}>{saving ? "Saving…" : submitLabel}</Button>
      {!p.cities.length && !p.remoteOk && <p className="text-sm text-muted-foreground">Pick at least one city or allow remote.</p>}
    </form>
  );
}
