import { z } from "zod";
import { clip, descriptionHash, normalizeTitle } from "../text";
import type { CompanyKind, EmploymentType, RawJob, Seniority, Track, Workplace } from "../types";
import { TRACKS } from "../types";
import {
  employmentType,
  isItServicesEmployer,
  parseExperience,
  parseLocations,
  parseSalary,
  REJECTED_EMPLOYMENT,
  seniorityFromTitle,
  skillsFromText,
  staffingSignal,
  trackFromTitle,
} from "./rules";

export * from "./rules";

export const CLASSIFIER_VERSION = "rules-1";

export interface ClassifiedJob {
  normalizedTitle: string;
  descriptionHash: string;
  summary: string;
  locations: string[];
  cities: string[];
  workplace: Workplace;
  remoteIndia: boolean;
  inIndia: boolean;
  employmentType: EmploymentType;
  minYears?: number;
  maxYears?: number;
  expText?: string;
  seniority: Seniority;
  track: Track;
  skills: string[];
  salaryMinLpa?: number;
  salaryMaxLpa?: number;
  salaryText?: string;
  freshersEligible: boolean;
  /** Why the job is not eligible (empty when eligible). */
  rejectReasons: string[];
  /** Soft notes shown to users/admins, e.g. "experience not stated". */
  flags: string[];
  classifierVersion: string;
}

/** What the AI step may fill. Validated with zod; anything else is ignored. */
export const AiEnrichmentSchema = z.object({
  skills: z.array(z.string().min(1).max(40)).max(15),
  track: z.enum(TRACKS),
  freshersEligible: z.boolean(),
  summary: z.string().min(20).max(600),
});
export type AiEnrichment = z.infer<typeof AiEnrichmentSchema>;

export interface JobEnricher {
  /** Called with public job text only. Must be cached by descriptionHash by the implementation. */
  enrich(input: { title: string; company: string; text: string; descriptionHash: string }): Promise<AiEnrichment | null>;
}

export interface ClassifyCompany {
  name: string;
  kind?: CompanyKind;
}

function ruleSummary(c: Omit<ClassifiedJob, "summary">, title: string, company: string): string {
  const where = c.remoteIndia ? "remote (India)" : c.cities.length ? c.cities.join(", ") : "location not stated";
  const exp =
    c.minYears !== undefined
      ? c.maxYears !== undefined
        ? `Asks for ${c.minYears}–${c.maxYears} years of experience.`
        : `Asks for ${c.minYears}+ years of experience.`
      : "Experience not stated.";
  const skills = c.skills.length ? ` Mentions ${c.skills.slice(0, 6).join(", ")}.` : "";
  const pay = c.salaryText ? ` Pay stated: ${c.salaryText}.` : "";
  return clip(`${title} at ${company}, ${where}. ${exp}${skills}${pay}`, 600);
}

export function classifyRules(raw: RawJob, company: ClassifyCompany): ClassifiedJob {
  const text = raw.descriptionText ?? "";
  const loc = parseLocations(raw.locations, raw.workplaceHint, raw.title);
  const emp = employmentType(raw.employmentTypeHint, raw.title, text);
  const sen = seniorityFromTitle(raw.title);
  const exp = parseExperience(text);
  const sal = parseSalary([raw.salaryHint ?? "", text].join("\n"));
  // Title only: company blurbs at the top of descriptions mention "AI" etc. and mislabel non-tech roles.
  const track = trackFromTitle(raw.title) ?? "other";
  const skills = skillsFromText(`${raw.title}\n${text}`);

  const rejectReasons: string[] = [];
  const flags: string[] = [];

  if (!loc.inIndia) rejectReasons.push("not in India");
  if (REJECTED_EMPLOYMENT.includes(emp)) rejectReasons.push(`employment type: ${emp}`);
  if (sen.reject) rejectReasons.push(sen.reject);
  // Levels II and III vary by company (Google's SWE III is early-career): keep them only when the posting
  // itself states ≤ 2 years. Level IV+ is always out.
  if ((sen.level === 2 || sen.level === 3) && !(exp.minYears !== undefined && exp.minYears <= 2)) {
    rejectReasons.push(`level ${sen.level === 2 ? "II" : "III"} without ≤2 years stated`);
  }
  if (sen.level === 3 && exp.minYears !== undefined && exp.minYears <= 2) flags.push("level III (stretch)");
  if (exp.minYears !== undefined && exp.minYears > 2) rejectReasons.push(`requires ${exp.minYears}+ years`);
  const staffing = staffingSignal(text, company.name);
  if (staffing) rejectReasons.push(staffing);
  if (company.kind === "staffing") rejectReasons.push("staffing company");
  if (company.kind === "services" || isItServicesEmployer(company.name)) flags.push("it services employer");

  if (exp.minYears === undefined) flags.push("experience not stated");
  if (emp === "unknown") flags.push("employment type not stated");
  if (!raw.detailFetched || text.length < 200) flags.push("thin description");

  const base = {
    normalizedTitle: normalizeTitle(raw.title),
    descriptionHash: descriptionHash(raw.title, text),
    locations: raw.locations,
    cities: loc.cities,
    workplace: loc.workplace,
    remoteIndia: loc.remoteIndia,
    inIndia: loc.inIndia,
    employmentType: emp,
    minYears: exp.minYears,
    maxYears: exp.maxYears,
    expText: exp.expText,
    seniority: sen.seniority,
    track,
    skills,
    ...sal,
    freshersEligible: rejectReasons.length === 0,
    rejectReasons,
    flags,
    classifierVersion: CLASSIFIER_VERSION,
  };
  return { ...base, summary: ruleSummary(base, raw.title, company.name) };
}

/**
 * Rules first; the AI only fills gaps (skills, track when "other", summary) and can only make a job
 * *less* eligible — it never overrides a rules rejection.
 */
export async function classify(raw: RawJob, company: ClassifyCompany, ai?: JobEnricher): Promise<ClassifiedJob> {
  const c = classifyRules(raw, company);
  if (!ai || c.rejectReasons.length || !raw.detailFetched) return c;
  let e: AiEnrichment | null = null;
  try {
    e = await ai.enrich({ title: raw.title, company: company.name, text: raw.descriptionText.slice(0, 12000), descriptionHash: c.descriptionHash });
  } catch {
    e = null;
  }
  const parsed = e ? AiEnrichmentSchema.safeParse(e) : null;
  if (!parsed?.success) return c;
  const ae = parsed.data;
  const out: ClassifiedJob = {
    ...c,
    skills: [...new Set([...c.skills, ...ae.skills])].slice(0, 15),
    track: c.track === "other" ? ae.track : c.track,
    summary: clip(ae.summary, 600),
    classifierVersion: `${CLASSIFIER_VERSION}+ai`,
  };
  if (!ae.freshersEligible) {
    out.freshersEligible = false;
    out.rejectReasons = [...c.rejectReasons, "ai: not suitable for 0–2 years"];
  }
  return out;
}
