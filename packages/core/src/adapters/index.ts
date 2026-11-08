import type { Adapter, Ats } from "../types";
import { API_ADAPTERS } from "./api";
import { custom, darwinbox, freshteam, google, icims, keka, kula, phenom, successfactors, zoho } from "./generic";
import { oracle } from "./oracle";
import { workday } from "./workday";

const REGISTRY: Partial<Record<Ats, Adapter>> = {
  ...API_ADAPTERS,
  workday,
  oracle,
  icims,
  successfactors,
  phenom,
  keka,
  kula,
  darwinbox,
  zoho,
  freshteam,
  google,
  custom,
};

export function getAdapter(ats: Ats): Adapter {
  const a = REGISTRY[ats];
  if (!a) throw new Error(`no adapter for ats=${ats}`);
  return a;
}

export function hasAdapter(ats: Ats): boolean {
  return ats in REGISTRY;
}

export * from "./api";
export * from "./generic";
export * from "./jsonld";
export * from "./oracle";
export * from "./workday";
export * from "./detect";
export { requireSlug, toDate } from "./util";
