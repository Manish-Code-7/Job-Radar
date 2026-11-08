import { FetchError, isFetchError } from "../fetch/http";
import { htmlToText } from "../text";
import type { Adapter, AdapterContext, CompanyRef, ListResult, RawJob } from "../types";
import { compact, jsonOrGone } from "./util";

export interface WorkdaySite {
  origin: string; // https://tenant.wd5.myworkdayjobs.com
  tenant: string;
  site: string;
  cxsBase: string; // origin + /wday/cxs/tenant/site
}

export function parseWorkdayUrl(url: string): WorkdaySite | null {
  const u = new URL(url);
  const host = u.hostname.match(/^([^.]+)\.(wd\d+)\.myworkday(jobs|site)\.com$/i);
  if (!host) return null;
  const tenant = host[1]!;
  const parts = u.pathname.split("/").filter(Boolean);
  // Optional locale segment: en-US, fr-FR, …
  if (parts[0] && /^[a-z]{2}-[A-Z]{2}$/.test(parts[0])) parts.shift();
  // /wday/cxs/{tenant}/{site}/... form
  if (parts[0] === "wday" && parts[1] === "cxs") parts.splice(0, 3);
  const site = parts[0];
  if (!site) return null;
  return { origin: u.origin, tenant, site, cxsBase: `${u.origin}/wday/cxs/${tenant}/${site}` };
}

export const DEFAULT_WORKDAY_SEARCHES = ["software engineer", "associate", "devops", "machine learning"];

interface WdListPosting {
  title: string;
  externalPath: string;
  locationsText?: string;
  postedOn?: string;
  bulletFields?: string[];
}
interface WdList {
  total?: number;
  jobPostings: WdListPosting[];
}
interface WdDetail {
  jobPostingInfo: {
    id?: string;
    title: string;
    jobDescription?: string;
    location?: string;
    additionalLocations?: string[];
    timeType?: string;
    startDate?: string;
    postedOn?: string;
    jobReqId?: string;
    canApply?: boolean;
    externalUrl?: string;
    remoteType?: string;
  };
}

/** Browser-like headers; the worker's got-scraping transport adds the rest of a real browser fingerprint. */
function wdHeaders(s: WorkdaySite): Record<string, string> {
  return {
    accept: "application/json",
    "content-type": "application/json",
    "accept-language": "en-US,en;q=0.9",
    origin: s.origin,
    referer: `${s.origin}/${s.site}`,
  };
}

export function workdayJobId(externalPath: string, bullet?: string): string {
  return externalPath.match(/_([A-Za-z0-9-]+)(?:-\d+)?$/)?.[1] ?? bullet ?? externalPath;
}

/** "Posted 3 Days Ago" / "Posted Today" / "Posted 30+ Days Ago" → Date. */
export function parsePostedOn(s: string | undefined, now = new Date()): Date | undefined {
  if (!s) return undefined;
  const t = s.toLowerCase();
  const d = new Date(now);
  if (t.includes("today")) return d;
  if (t.includes("yesterday")) return new Date(d.getTime() - 864e5);
  const n = t.match(/(\d+)\+?\s*day/);
  return n ? new Date(d.getTime() - Number(n[1]) * 864e5) : undefined;
}

function mapList(s: WorkdaySite, p: WdListPosting): RawJob {
  return {
    source: "workday",
    sourceJobId: workdayJobId(p.externalPath, p.bulletFields?.[0]),
    url: `${s.origin}/${s.site}${p.externalPath}`,
    title: p.title.trim(),
    descriptionText: "",
    locations: compact([p.locationsText]),
    postedAt: parsePostedOn(p.postedOn),
    detailFetched: false,
    raw: { externalPath: p.externalPath },
  };
}

function mapDetail(s: WorkdaySite, externalPath: string, d: WdDetail): RawJob {
  const i = d.jobPostingInfo;
  return {
    source: "workday",
    sourceJobId: workdayJobId(externalPath, i.jobReqId),
    url: i.externalUrl ?? `${s.origin}/${s.site}${externalPath}`,
    title: i.title.trim(),
    descriptionText: htmlToText(i.jobDescription),
    locations: compact([i.location, ...(i.additionalLocations ?? [])]),
    workplaceHint: i.remoteType,
    employmentTypeHint: i.timeType,
    postedAt: i.startDate ? new Date(i.startDate) : parsePostedOn(i.postedOn),
    detailFetched: true,
    applyable: i.canApply,
    raw: { externalPath, jobReqId: i.jobReqId },
  };
}

interface WdFacetValue {
  descriptor?: string;
  id?: string;
  facetParameter?: string;
  values?: WdFacetValue[];
}

/** Find the "India" location facet at any depth (tenants use locationCountry, locationHierarchy1, …). */
export function findIndiaFacet(facets: WdFacetValue[] | undefined): { param: string; id: string } | null {
  let best: { param: string; id: string; score: number } | null = null;
  const walk = (list: WdFacetValue[] | undefined, param?: string) => {
    for (const f of list ?? []) {
      const p = f.facetParameter ?? param;
      if (f.values) walk(f.values, f.facetParameter ?? param);
      if (p && f.id && f.descriptor?.trim().toLowerCase() === "india") {
        const score = /country/i.test(p) ? 3 : /hierarchy1/i.test(p) ? 2 : 1;
        if (!best || score > best.score) best = { param: p, id: f.id, score };
      }
    }
  };
  walk(facets);
  return best ? { param: (best as { param: string }).param, id: (best as { id: string }).id } : null;
}

async function wdPage(s: WorkdaySite, ctx: AdapterContext, searchText: string, offset: number, appliedFacets: Record<string, string[]>) {
  const res = await ctx.http.fetch({
    url: `${s.cxsBase}/jobs`,
    method: "POST",
    headers: wdHeaders(s),
    body: JSON.stringify({ appliedFacets, limit: 20, offset, searchText }),
    useCache: false,
  });
  if (res.status !== 200) throw new FetchError("http", `workday list HTTP ${res.status}`, s.cxsBase, res.status);
  return JSON.parse(res.body) as WdList & { facets?: WdFacetValue[] };
}

async function listViaApi(s: WorkdaySite, ctx: AdapterContext, searchText: string, appliedFacets: Record<string, string[]>, maxJobs = 500) {
  const out: WdListPosting[] = [];
  let total = Infinity;
  for (let offset = 0; offset < total && offset < maxJobs; offset += 20) {
    const page = await wdPage(s, ctx, searchText, offset, appliedFacets);
    // Workday only reports `total` on the first page.
    if (offset === 0) total = page.total ?? 0;
    out.push(...page.jobPostings);
    if (page.jobPostings.length < 20) break;
  }
  return { postings: out, exhausted: out.length >= total || out.length < maxJobs };
}

/** Fallback when the CXS API is blocked: let the real site make the calls and capture them. */
async function listViaBrowser(s: WorkdaySite, ctx: AdapterContext): Promise<WdListPosting[]> {
  if (!ctx.browser) throw new FetchError("blocked", "workday blocked and no browser", s.origin);
  const page = await ctx.browser.render(`${s.origin}/${s.site}`, {
    captureJson: /\/wday\/cxs\/[^/]+\/[^/]+\/jobs(\?|$)/,
    clickSelector: "button[aria-label='next'], button[data-uxi-element-id='next']",
    maxClicks: 10,
  });
  return page.json.flatMap((r) => (r.body as WdList | undefined)?.jobPostings ?? []);
}

export const workday: Adapter = {
  ats: "workday",
  tier: "api",
  async listJobs(company: CompanyRef, ctx: AdapterContext): Promise<ListResult> {
    const s = parseWorkdayUrl(company.careersUrl ?? "");
    if (!s) throw new Error(`${company.name}: careersUrl must be a myworkdayjobs.com site URL`);
    const byPath = new Map<string, WdListPosting>();
    let complete = false;
    let indiaFiltered = false;
    try {
      // One probe request to discover the tenant's India facet.
      const probe = await wdPage(s, ctx, ctx.searchTexts?.[0] ?? "", 0, {});
      const india = findIndiaFacet(probe.facets);
      const facets: Record<string, string[]> = india ? { [india.param]: [india.id] } : {};
      indiaFiltered = !!india;
      let done = false;
      if (india && !ctx.searchTexts) {
        // Whole India board in one pass when it is small enough → a complete snapshot (S1 can close jobs).
        const r = await listViaApi(s, ctx, "", facets, 500);
        for (const p of r.postings) byPath.set(p.externalPath, p);
        complete = r.exhausted;
        done = r.exhausted;
      }
      if (!done) {
        for (const q of ctx.searchTexts ?? DEFAULT_WORKDAY_SEARCHES) {
          const r = await listViaApi(s, ctx, q, facets);
          for (const p of r.postings) byPath.set(p.externalPath, p);
        }
        complete = false;
      }
    } catch (e) {
      if (!isFetchError(e) || (e.kind !== "blocked" && e.status !== 403)) throw e;
      ctx.log?.("workday API blocked; using browser capture", { tenant: s.tenant });
      complete = false;
      for (const p of await listViaBrowser(s, ctx)) byPath.set(p.externalPath, p);
    }

    let budget = ctx.maxDetailFetches ?? 30;
    const jobs: RawJob[] = [];
    for (const p of byPath.values()) {
      const base = mapList(s, p);
      // List rows often say only "3 Locations"; the India facet already guarantees India.
      if (indiaFiltered && !/india/i.test(base.locations.join(" "))) base.locations.push("India");
      if (ctx.knownJobIds?.has(base.sourceJobId) || budget <= 0) {
        jobs.push(base);
        continue;
      }
      budget--;
      try {
        const d = await jsonOrGone<WdDetail>(ctx, `${s.cxsBase}${p.externalPath}`);
        const full = d ? mapDetail(s, p.externalPath, d) : base;
        if (indiaFiltered && !/india/i.test(full.locations.join(" "))) full.locations.push("India");
        jobs.push(full);
      } catch {
        jobs.push(base);
      }
    }
    return { jobs, complete };
  },
  async getJob(url, _company, ctx) {
    const s = parseWorkdayUrl(url);
    if (!s) return null;
    const path = new URL(url).pathname;
    const externalPath = path.slice(path.indexOf("/job/"));
    if (!externalPath.startsWith("/job/")) return null;
    const d = await jsonOrGone<WdDetail>(ctx, `${s.cxsBase}${externalPath}`);
    return d?.jobPostingInfo ? mapDetail(s, externalPath, d) : null;
  },
};
