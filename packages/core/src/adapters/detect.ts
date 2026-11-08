import type { RenderedPage } from "../browser";
import { isFetchError } from "../fetch/http";
import type { AdapterContext, Ats, CompanyRef } from "../types";
import { API_TIER_ATS } from "../types";
import { extractLinks } from "./generic";
import { getAdapter } from "./index";

export interface Detection {
  ats: Ats;
  slug?: string;
  careersUrl?: string;
  confidence: number; // 0..1
  evidence?: string;
}

interface Rule {
  ats: Ats;
  re: RegExp;
  /** Builds slug + canonical careers URL from the match. */
  build: (m: RegExpMatchArray, url: string) => { slug?: string; careersUrl?: string };
}

const SKIP_SLUGS = new Set(["embed", "api", "v0", "v1", "jobs", "careers", "posting-api", "widget", "js"]);

const RULES: Rule[] = [
  { ats: "lever", re: /(?:jobs|api)\.lever\.co\/(?:v0\/postings\/)?([a-z0-9._-]+)/i, build: (m) => ({ slug: m[1], careersUrl: `https://jobs.lever.co/${m[1]}` }) },
  { ats: "greenhouse", re: /greenhouse\.io\/(?:embed\/job_board(?:\/js)?\?for=|v1\/boards\/)([a-z0-9_-]+)/i, build: (m) => ({ slug: m[1], careersUrl: `https://job-boards.greenhouse.io/${m[1]}` }) },
  { ats: "greenhouse", re: /(?:job-)?boards\.greenhouse\.io\/([a-z0-9_-]+)/i, build: (m) => ({ slug: m[1], careersUrl: `https://job-boards.greenhouse.io/${m[1]}` }) },
  { ats: "ashby", re: /jobs\.ashbyhq\.com\/([^/?#"'\s]+)/i, build: (m) => ({ slug: decodeURIComponent(m[1]!), careersUrl: `https://jobs.ashbyhq.com/${m[1]}` }) },
  { ats: "ashby", re: /api\.ashbyhq\.com\/posting-api\/job-board\/([^/?#"'\s]+)/i, build: (m) => ({ slug: m[1], careersUrl: `https://jobs.ashbyhq.com/${m[1]}` }) },
  { ats: "smartrecruiters", re: /(?:careers|jobs)\.smartrecruiters\.com\/([a-z0-9_-]+)/i, build: (m) => ({ slug: m[1], careersUrl: `https://careers.smartrecruiters.com/${m[1]}` }) },
  { ats: "workable", re: /apply\.workable\.com\/(?:api\/v\d\/(?:widget\/)?accounts\/)?([a-z0-9_-]+)/i, build: (m) => ({ slug: m[1], careersUrl: `https://apply.workable.com/${m[1]}/` }) },
  { ats: "recruitee", re: /([a-z0-9-]+)\.recruitee\.com/i, build: (m) => ({ slug: m[1], careersUrl: `https://${m[1]}.recruitee.com/` }) },
  { ats: "workday", re: /([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([A-Za-z0-9_-]+)/, build: (m) => ({ slug: `${m[1]}/${m[3]}`, careersUrl: `https://${m[1]}.${m[2]}.myworkdayjobs.com/${m[3]}` }) },
  { ats: "icims", re: /(?:careers-)?([a-z0-9-]+)\.icims\.com/i, build: (m, u) => ({ slug: m[1]!.replace(/^careers-/, ""), careersUrl: u.includes("icims.com") ? `https://${m[0]}/jobs/search?ss=1` : undefined }) },
  { ats: "oracle", re: /([a-z0-9.-]+\.oraclecloud\.com)\/hcmUI\/CandidateExperience\/([a-z]{2})\/sites\/([A-Za-z0-9_]+)/i, build: (m) => ({ slug: m[3], careersUrl: `https://${m[1]}/hcmUI/CandidateExperience/${m[2]}/sites/${m[3]}` }) },
  { ats: "successfactors", re: /(career\d*\.successfactors\.(?:com|eu)|jobs\.sap\.com|rmkcdn\.successfactors\.com|\.sapsf\.(?:com|eu))/i, build: () => ({}) },
  { ats: "phenom", re: /(cdn\.phenompeople\.com|phenompeople|phApp\.ddo)/i, build: () => ({}) },
  { ats: "keka", re: /([a-z0-9-]+)\.keka\.com\/careers/i, build: (m) => ({ slug: m[1], careersUrl: `https://${m[1]}.keka.com/careers/` }) },
  { ats: "kula", re: /careers\.kula\.ai\/([a-z0-9_-]+)/i, build: (m) => ({ slug: m[1], careersUrl: `https://careers.kula.ai/${m[1]}` }) },
  { ats: "darwinbox", re: /([a-z0-9-]+)\.darwinbox\.(?:in|com)/i, build: (m) => ({ slug: m[1], careersUrl: `https://${m[1]}.darwinbox.in/ms/candidate/careers` }) },
  { ats: "zoho", re: /([a-z0-9-]+)\.zohorecruit\.(com|in|eu)/i, build: (m) => ({ slug: m[1], careersUrl: `https://${m[1]}.zohorecruit.${m[2]}/jobs/Careers` }) },
  { ats: "freshteam", re: /([a-z0-9-]+)\.freshteam\.com/i, build: (m) => ({ slug: m[1], careersUrl: `https://${m[1]}.freshteam.com/jobs` }) },
  { ats: "amazon", re: /amazon\.jobs/i, build: () => ({ careersUrl: "https://www.amazon.jobs/en/search?country[]=IND" }) },
  { ats: "google", re: /google\.com\/about\/careers|careers\.google\.com/i, build: () => ({}) },
];

/** Pure: look at URLs (links, iframes, network requests) and HTML for known ATS fingerprints. */
export function detectFromSignals(signals: { pageUrl: string; urls: string[]; html: string }): Detection[] {
  const scores = new Map<string, Detection & { hits: number }>();
  const sources: [string, number][] = [
    [signals.pageUrl, 1.0],
    ...signals.urls.map((u) => [u, 0.8] as [string, number]),
    [signals.html.slice(0, 500_000), 0.5],
  ];
  for (const [text, weight] of sources) {
    for (const r of RULES) {
      const m = text.match(r.re);
      if (!m) continue;
      const built = r.build(m, text.length < 2048 ? text : signals.pageUrl);
      if (built.slug && SKIP_SLUGS.has(built.slug.toLowerCase())) continue;
      const key = `${r.ats}:${built.slug ?? ""}`;
      const prev = scores.get(key);
      if (prev) {
        prev.hits++;
        prev.confidence = Math.min(1, prev.confidence + weight * 0.2);
      } else {
        scores.set(key, { ats: r.ats, ...built, confidence: weight * 0.8, evidence: m[0], hits: 1 });
      }
    }
  }
  return [...scores.values()]
    .sort((a, b) => b.confidence - a.confidence)
    .map(({ hits: _h, ...d }) => d);
}

/** Confirm an API-tier result by calling its feed. */
async function confirm(d: Detection, ctx: AdapterContext, name: string): Promise<boolean> {
  if (!API_TIER_ATS.includes(d.ats) || !d.slug) return true;
  try {
    const res = await getAdapter(d.ats).listJobs({ name, ats: d.ats, atsSlug: d.slug, careersUrl: d.careersUrl }, { ...ctx, maxDetailFetches: 0 });
    return Array.isArray(res.jobs);
  } catch (e) {
    return !(isFetchError(e) && e.status === 404);
  }
}

export interface DetectInput {
  name: string;
  domain?: string | null;
  careersUrl?: string | null;
}

/**
 * Render the careers page once (browser if available, else HTTP), inspect links/iframes/scripts/XHR,
 * and confirm API-tier hits by calling the feed. `page` lets a caller pass a pre-rendered page (e.g. Firecrawl).
 */
export async function detectAts(
  input: DetectInput,
  ctx: AdapterContext,
  page?: Pick<RenderedPage, "finalUrl" | "html" | "requestUrls" | "frameUrls" | "links">,
): Promise<Detection> {
  const start = input.careersUrl ?? (input.domain ? `https://${input.domain}/careers` : null);
  if (!start) return { ats: "unknown", confidence: 0 };

  // Fast path: the URL itself is an ATS URL.
  const direct = detectFromSignals({ pageUrl: start, urls: [], html: "" })[0];
  if (direct && direct.confidence >= 0.8 && (await confirm(direct, ctx, input.name))) return direct;

  let p = page;
  if (!p) {
    if (ctx.browser) {
      p = await ctx.browser.render(start, { waitMs: 2500 });
    } else {
      const res = await ctx.http.fetch({ url: start });
      p = { finalUrl: res.url, html: res.body, requestUrls: [], frameUrls: [], links: extractLinks(res.body, res.url) };
    }
  }
  const candidates = detectFromSignals({
    pageUrl: p.finalUrl,
    urls: [...p.frameUrls, ...p.requestUrls, ...p.links.map((l) => l.href)],
    html: p.html,
  });
  for (const c of candidates) {
    if (await confirm(c, ctx, input.name)) {
      return { ...c, careersUrl: c.careersUrl ?? p.finalUrl };
    }
  }
  return { ats: "custom", careersUrl: p.finalUrl, confidence: 0.3 };
}
