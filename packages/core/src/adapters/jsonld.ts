import { decodeEntities, htmlToText } from "../text";
import type { Ats, RawJob } from "../types";
import { compact, toDate } from "./util";

export interface JobPostingLd {
  title?: string;
  description?: string;
  datePosted?: string;
  validThrough?: string;
  employmentType?: string | string[];
  hiringOrganization?: { name?: string } | string;
  jobLocation?: unknown;
  jobLocationType?: string;
  applicantLocationRequirements?: unknown;
  baseSalary?: {
    currency?: string;
    value?: { minValue?: number | string; maxValue?: number | string; value?: number | string; unitText?: string };
  };
  identifier?: { value?: string | number } | string;
  url?: string;
  directApply?: boolean;
}

function walk(node: unknown, out: JobPostingLd[]) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) return node.forEach((n) => walk(n, out));
  const o = node as Record<string, unknown>;
  const t = o["@type"];
  if (t === "JobPosting" || (Array.isArray(t) && t.includes("JobPosting"))) out.push(o as JobPostingLd);
  if (o["@graph"]) walk(o["@graph"], out);
  if (o["mainEntity"]) walk(o["mainEntity"], out);
}

export function extractJobPostings(html: string): JobPostingLd[] {
  const out: JobPostingLd[] = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(re)) {
    const raw = m[1]!.trim().replace(/^<!--|-->$/g, "");
    try {
      walk(JSON.parse(raw), out);
    } catch {
      // Some sites put raw newlines inside strings; try once more after escaping them.
      try {
        walk(JSON.parse(raw.replace(/[\r\n\t]+/g, " ")), out);
      } catch {
        /* ignore malformed block */
      }
    }
  }
  return out;
}

function placeToString(p: unknown): string | undefined {
  if (!p || typeof p !== "object") return typeof p === "string" ? p : undefined;
  const o = p as Record<string, unknown>;
  const a = (o.address ?? o) as Record<string, unknown>;
  if (typeof a === "string") return a;
  const country = a.addressCountry;
  const countryName =
    typeof country === "object" && country ? (country as Record<string, unknown>).name : (country as string | undefined);
  const s = compact([a.addressLocality as string, a.addressRegion as string, countryName as string]).join(", ");
  return s || (o.name as string | undefined);
}

export function ldLocations(ld: JobPostingLd): string[] {
  const locs = Array.isArray(ld.jobLocation) ? ld.jobLocation : [ld.jobLocation];
  return compact(locs.map(placeToString));
}

export function ldSalary(ld: JobPostingLd): string | undefined {
  const v = ld.baseSalary?.value;
  if (!v) return undefined;
  const min = v.minValue ?? v.value;
  const max = v.maxValue;
  if (min === undefined) return undefined;
  return `${ld.baseSalary?.currency ?? ""} ${min}${max ? `-${max}` : ""} ${v.unitText ?? ""}`.trim();
}

export function jobFromLd(ld: JobPostingLd, url: string, source: Ats, fallbackId: string): RawJob | null {
  if (!ld.title) return null;
  const ident = typeof ld.identifier === "object" ? ld.identifier?.value : ld.identifier;
  const org = typeof ld.hiringOrganization === "string" ? ld.hiringOrganization : ld.hiringOrganization?.name;
  return {
    source,
    sourceJobId: String(ident ?? fallbackId),
    url: ld.url && /^https?:/.test(ld.url) ? ld.url : url,
    title: decodeEntities(ld.title).trim(),
    descriptionText: htmlToText(ld.description),
    locations: ldLocations(ld),
    workplaceHint: ld.jobLocationType === "TELECOMMUTE" ? "Remote" : undefined,
    employmentTypeHint: Array.isArray(ld.employmentType) ? ld.employmentType.join(", ") : ld.employmentType,
    postedAt: toDate(ld.datePosted),
    validThrough: toDate(ld.validThrough),
    salaryHint: ldSalary(ld),
    companyNameOnPage: org,
    detailFetched: true,
  };
}
