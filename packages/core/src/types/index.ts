export const ATS_VALUES = [
  "lever",
  "greenhouse",
  "ashby",
  "smartrecruiters",
  "workable",
  "recruitee",
  "workday",
  "icims",
  "successfactors",
  "oracle",
  "phenom",
  "keka",
  "kula",
  "darwinbox",
  "zoho",
  "freshteam",
  "amazon",
  "google",
  "custom",
  "unknown",
] as const;
export type Ats = (typeof ATS_VALUES)[number];

export const API_TIER_ATS: readonly Ats[] = [
  "lever",
  "greenhouse",
  "ashby",
  "smartrecruiters",
  "workable",
  "recruitee",
  "amazon",
];

export const COMPANY_KINDS = ["product", "gcc", "startup", "mnc", "services", "staffing"] as const;
export type CompanyKind = (typeof COMPANY_KINDS)[number];

export const TRACKS = ["software", "ai_ml", "devops", "data", "qa", "other"] as const;
export type Track = (typeof TRACKS)[number];

export const JOB_STATUSES = ["pending", "open", "changed", "unknown", "closed", "archived"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export type Workplace = "onsite" | "hybrid" | "remote" | "unknown";
export type EmploymentType = "full_time" | "part_time" | "intern" | "contract" | "temporary" | "apprentice" | "unknown";
export type Seniority = "entry" | "mid" | "senior" | "unknown";

/** Minimal company shape adapters need. */
export interface CompanyRef {
  id?: string;
  name: string;
  domain?: string | null;
  aliases?: string[];
  ats: Ats;
  atsSlug?: string | null;
  careersUrl?: string | null;
}

/** What an adapter returns: as close to the source as possible, lightly normalised. */
export interface RawJob {
  source: Ats;
  sourceJobId: string;
  url: string;
  applyUrl?: string;
  title: string;
  /** Plain text (HTML stripped). Never published; used for classification + hashing only. */
  descriptionText: string;
  locations: string[];
  workplaceHint?: string;
  employmentTypeHint?: string;
  postedAt?: Date;
  salaryHint?: string;
  department?: string;
  /** False when the listing had no description and the detail fetch was skipped. */
  detailFetched?: boolean;
  /** From JSON-LD validThrough, if present. */
  validThrough?: Date;
  companyNameOnPage?: string;
  /** ATS says the posting accepts applications (Workday canApply). */
  applyable?: boolean;
  raw?: unknown;
}

export interface ListResult {
  jobs: RawJob[];
  /** True only if the adapter believes it fetched the full board (all pages). Drives S1. */
  complete: boolean;
}

export interface Adapter {
  ats: Ats;
  tier: "api" | "browser";
  /** Snapshot of the company's board. `complete` must be false if any page failed or a search filter was used. */
  listJobs(company: CompanyRef, ctx: AdapterContext): Promise<ListResult>;
  /** Fetch one posting by its public URL; null if it is gone. Throws FetchError when it cannot tell. */
  getJob(url: string, company: CompanyRef, ctx: AdapterContext): Promise<RawJob | null>;
}

export type { AdapterContext, AiExtractor } from "./context";
import type { AdapterContext } from "./context";
