import { extractBySelectors, extractLinks, GENERIC_JOB_LINK } from "../adapters/generic";
import { extractJobPostings, jobFromLd } from "../adapters/jsonld";
import { parseLocations } from "../classifier/rules";
import { htmlToText, jaccard, normalizeWs, titleSimilarity } from "../text";
import type { Extracted, PageType, S4 } from "./signals";

export const CLOSED_PHRASES = [
  "no longer accepting",
  "position has been filled",
  "job not found",
  "this job may have been taken down",
  "expired",
  "job was removed",
  "posting is closed",
  "page not found",
  "no longer available",
  "job is no longer open",
  "this position is closed",
  "requisition is closed",
  "job has been closed",
  "sorry, this job has been filled",
  "the job you are looking for",
  "position is no longer",
];

/** Phrases that only count in prominent places (title/h1/first screen), because "expired" etc. appear in body copy. */
export function findClosedPhrase(html: string, text?: string): string | undefined {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";
  const h = [...html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)].map((m) => m[1]).join(" ");
  const t = text ?? htmlToText(html);
  // Short pages are almost entirely "the message"; for long pages only look at the headline area.
  const head = normalizeWs(`${htmlToText(title)} ${htmlToText(h)} ${t.length < 1500 ? t : t.slice(0, 400)}`).toLowerCase();
  return CLOSED_PHRASES.find((p) => head.includes(p));
}

const APPLY_TEXT = /^\s*(apply( now| for (this )?(job|position|role))?|apply online|submit (your )?application|i'?m interested|easy apply|start (your )?application)\s*$/i;

export function hasApplyControl(html: string): boolean {
  for (const m of html.matchAll(/<(a|button|input)\b([^>]*)>([\s\S]{0,200}?)<\/\1>|<input\b([^>]*)\/?>/gi)) {
    const attrs = (m[2] ?? m[4] ?? "").toLowerCase();
    const text = htmlToText(m[3] ?? "");
    if (APPLY_TEXT.test(text)) return true;
    if (/(aria-label|value|title)=["'][^"']*apply[^"']*["']/.test(attrs)) return true;
    if (/data-(automation-id|ph-at-id|testid|qa)=["'][^"']*apply/.test(attrs)) return true;
    if (/href=["'][^"']*\/apply(\/|\?|["'])/.test(attrs)) return true;
  }
  // Inline application forms (Greenhouse/Lever hosted pages).
  return /<form[^>]+(id|class|action)=["'][^"']*(application|apply)[^"']*["']/i.test(html);
}

/**
 * True when the visible body has no real content: an SPA shell whose only job data is in meta tags or
 * JSON-LD (e.g. Ashby, Workday). Metadata alone never proves a posting is open, so these need a rendered check.
 */
export function isMetadataOnly(html: string): boolean {
  const body = html.match(/<body\b[\s\S]*<\/body>/i)?.[0] ?? html;
  return htmlToText(body).length < 300;
}

export interface PageAnalysis {
  pageType: PageType;
  hasApply: boolean;
  closedReason?: string;
  extracted: Extracted;
  validThroughPast?: boolean;
}

export function analyzePage(html: string, url: string, text?: string, now = new Date()): PageAnalysis {
  const closed = findClosedPhrase(html, text);
  const lds = extractJobPostings(html);
  const ld = lds[0] ? jobFromLd(lds[0], url, "custom", "") : null;
  const hasApply = hasApplyControl(html);
  if (ld?.validThrough && ld.validThrough.getTime() < now.getTime() - 864e5) {
    return {
      pageType: "job_posting",
      hasApply,
      closedReason: "validThrough in the past",
      extracted: { title: ld.title, company: ld.companyNameOnPage, locations: ld.locations },
      validThroughPast: true,
    };
  }
  if (closed) {
    return { pageType: "error", hasApply: false, closedReason: `closed text: "${closed}"`, extracted: { locations: [] } };
  }
  if (ld) {
    return { pageType: "job_posting", hasApply, extracted: { title: ld.title, company: ld.companyNameOnPage, locations: ld.locations } };
  }
  const titleTag = htmlToText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  if (/\b(404|not found|error)\b/i.test(titleTag) && htmlToText(html).length < 3000) {
    return { pageType: "error", hasApply: false, closedReason: "error page", extracted: { locations: [] } };
  }
  const jobLinks = extractLinks(html, url).filter((l) => GENERIC_JOB_LINK.test(l.href)).length;
  const sel = extractBySelectors(html, url, "custom");
  const bodyLen = (text ?? htmlToText(html)).length;
  if (sel && hasApply && bodyLen > 500 && jobLinks < 15) {
    return { pageType: "job_posting", hasApply, extracted: { title: sel.title, locations: sel.locations } };
  }
  if (jobLinks >= 5) return { pageType: "job_list", hasApply: false, extracted: { locations: [] } };
  return { pageType: "other", hasApply, extracted: { title: sel?.title, locations: sel?.locations ?? [] } };
}

/* ------------------------------ Identity (S4) ------------------------------ */
export const ATS_HOSTS = [
  "lever.co", "greenhouse.io", "ashbyhq.com", "smartrecruiters.com", "workable.com", "recruitee.com", "myworkdayjobs.com",
  "myworkdaysite.com", "icims.com", "successfactors.com", "successfactors.eu", "sapsf.com", "oraclecloud.com", "keka.com",
  "kula.ai", "darwinbox.in", "darwinbox.com", "zohorecruit.com", "zohorecruit.in", "freshteam.com", "amazon.jobs",
  "google.com", "phenompeople.com",
];

export function hostAllowed(url: string, companyDomains: string[]): boolean {
  const h = new URL(url).hostname.toLowerCase();
  const ok = (d: string) => h === d || h.endsWith("." + d);
  return companyDomains.some((d) => d && ok(d.toLowerCase().replace(/^www\./, ""))) || ATS_HOSTS.some(ok);
}

function companyMatches(onPage: string | undefined, names: string[]): boolean {
  if (!onPage) return true; // not stated → cannot fail
  const p = onPage.toLowerCase();
  return names.some((n) => {
    const x = n.toLowerCase();
    return p.includes(x) || x.includes(p) || jaccard(p, x) >= 0.5;
  });
}

/**
 * Location check that only fails on evidence: the page must name a real place (a known Indian city or a
 * foreign country/city) that doesn't overlap what we stored. Labels like "Locations" or "Location (City) *"
 * picked up by selectors carry no place, so they can't fail the check.
 */
function locationsOverlap(expected: string[], found: string[]): boolean {
  if (!expected.length || !found.length) return true;
  const exp = parseLocations(expected);
  const got = parseLocations(found);
  const gotText = found.join(" | ");
  const gotHasPlace = got.cities.length > 0 || got.inIndia || FOREIGN_PLACE.test(gotText);
  if (!gotHasPlace) return true;
  if (exp.workplace === "remote" && got.workplace === "remote") return true;
  if (got.cities.some((c) => exp.cities.includes(c))) return true;
  if (!got.cities.length && got.inIndia && exp.inIndia) return true; // "India" vs a specific Indian city
  if (!exp.cities.length) return exp.inIndia ? got.inIndia || !FOREIGN_PLACE.test(gotText) : true; // we only knew "India" (or nothing)
  return false;
}

const FOREIGN_PLACE =
  /\b(united states|usa|canada|united kingdom|uk|london|germany|france|singapore|australia|netherlands|ireland|poland|spain|brazil|mexico|japan|uae|dubai|philippines|israel|san francisco|new york|seattle|toronto|austin|texas|california|washington)\b/i;

export const TITLE_SIM_THRESHOLD = 0.85;
const GENERIC_TITLE = /^\s*(careers?( at .*)?|jobs?( at .*)?|job details?|search jobs|current openings|open positions|join us|loading\W*)\s*$/i;

export function identityCheck(
  expected: { title: string; companyNames: string[]; locations: string[]; companyDomains: string[] },
  found: { title?: string; company?: string; locations: string[]; finalUrl?: string },
): S4 {
  const reasons: string[] = [];
  let titleSim: number | undefined;
  // A generic heading ("Careers at X", "Job details") from a half-rendered SPA is no evidence of drift.
  const generic = !found.title || GENERIC_TITLE.test(found.title);
  if (!generic) {
    titleSim = titleSimilarity(expected.title, found.title!);
    if (titleSim < TITLE_SIM_THRESHOLD) reasons.push(`title "${expected.title}" → "${found.title}" (${titleSim.toFixed(2)})`);
  }
  const hostOk = found.finalUrl ? hostAllowed(found.finalUrl, expected.companyDomains) : true;
  if (!hostOk) reasons.push(`host ${new URL(found.finalUrl!).hostname} not allowlisted`);
  // Page-level organisation names are noisy ("JPMC Candidate Experience page"); on an allowlisted host the
  // host already proves whose page this is, so a name mismatch only counts off-allowlist.
  const companyOk = companyMatches(found.company, expected.companyNames) || hostOk;
  if (!companyOk) reasons.push(`company "${found.company}"`);
  const locationOk = locationsOverlap(expected.locations, found.locations);
  if (!locationOk) reasons.push(`location ${found.locations.join("/")}`);
  // No usable title → we cannot confirm identity, but we have no evidence it changed either.
  if (generic && reasons.length === 0) return { pass: false, inconclusive: true, companyOk, locationOk, hostOk, reasons: ["no usable title on page"] };
  return { pass: reasons.length === 0, titleSimilarity: titleSim, companyOk, locationOk, hostOk, reasons };
}
