import type { BrowserDriver } from "../browser";
import type { PoliteFetcher } from "../fetch/polite";
import type { RawJob } from "./index";

export interface AiExtractor {
  /** Extract a job posting from cleaned page text. Must return null when unsure. */
  extractJob(text: string, url: string): Promise<Partial<RawJob> | null>;
}

export interface AdapterContext {
  http: PoliteFetcher;
  browser?: BrowserDriver;
  /** Jobs we already have details for — adapters skip per-job detail fetches for these. */
  knownJobIds?: Set<string>;
  /** Cap on per-job detail requests in a single run (politeness). */
  maxDetailFetches?: number;
  /** For search-based ATS (Workday). Empty string = full snapshot. */
  searchTexts?: string[];
  ai?: AiExtractor;
  log?: (msg: string, meta?: Record<string, unknown>) => void;
}
