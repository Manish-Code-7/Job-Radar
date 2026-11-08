import type { ApplyProbeResult } from "../browser";

export type Verdict = "open" | "closed" | "changed" | "unknown";

/** S1 — feed presence in the company's latest snapshot. */
export interface S1 {
  /** The adapter run succeeded (no exception). */
  snapshotOk: boolean;
  /** The adapter fetched the whole board (all pages, no search filter). */
  complete: boolean;
  present: boolean;
  /** Title in the feed, when present (feeds S4). */
  feedTitle?: string;
  at: string;
}

export type ClosedStrength = "definitive" | "soft";

/** S2 — plain HTTP probe with manual redirects. */
export interface S2 {
  outcome: "ok" | "closed" | "needs_render" | "error";
  status?: number;
  chain: { url: string; status: number }[];
  finalUrl?: string;
  closedReason?: string;
  closedStrength?: ClosedStrength;
  error?: string;
  at: string;
}

export type PageType = "job_posting" | "job_list" | "error" | "other";

export interface Extracted {
  title?: string;
  company?: string;
  locations: string[];
}

/** S3 — page check (rendered when needed). `via` records which tool produced the page. */
export interface S3 {
  outcome: "ok" | "error";
  pageType?: PageType;
  hasApply?: boolean;
  closedReason?: string;
  extracted?: Extracted;
  finalUrl?: string;
  via: "http" | "playwright" | "firecrawl" | "jina";
  error?: string;
  at: string;
}

/** S4 — identity check. */
export interface S4 {
  pass: boolean;
  /** Could not judge (e.g. no usable title on the page): never `changed`, never `open`. */
  inconclusive?: boolean;
  titleSimilarity?: number;
  companyOk: boolean;
  locationOk: boolean;
  hostOk: boolean;
  reasons: string[];
}

export type S5 = ApplyProbeResult & { at: string };

export interface Signals {
  s1?: S1;
  s2?: S2;
  s3?: S3;
  s4?: S4;
  s5?: S5;
}

/** A previous closed observation from S2/S3 (from job_checks history). */
export interface ClosedObservation {
  at: string;
  reason: string;
}
