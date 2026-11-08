import { htmlToText } from "../text";
import { fetchPosting } from "./generic";
import type { Adapter, AdapterContext, CompanyRef, RawJob } from "../types";
import { compact, findInBoard, jsonOrGone, requireSlug, toDate } from "./util";

/* ----------------------------- Lever ----------------------------- */
interface LeverPosting {
  id: string;
  text: string;
  hostedUrl: string;
  applyUrl?: string;
  createdAt?: number;
  workplaceType?: string;
  descriptionPlain?: string;
  description?: string;
  additionalPlain?: string;
  lists?: { text: string; content: string }[];
  categories?: { location?: string; commitment?: string; team?: string; allLocations?: string[] };
  salaryRange?: { min?: number; max?: number; currency?: string; interval?: string };
  country?: string;
}

function mapLever(p: LeverPosting): RawJob {
  const lists = (p.lists ?? []).map((l) => `${l.text}\n${htmlToText(l.content)}`).join("\n\n");
  const sr = p.salaryRange;
  return {
    source: "lever",
    sourceJobId: p.id,
    url: p.hostedUrl,
    applyUrl: p.applyUrl,
    title: p.text.trim(),
    descriptionText: [p.descriptionPlain ?? htmlToText(p.description), lists, p.additionalPlain].filter(Boolean).join("\n\n"),
    locations: compact([...(p.categories?.allLocations ?? []), p.categories?.location]),
    workplaceHint: p.workplaceType,
    employmentTypeHint: p.categories?.commitment,
    department: p.categories?.team,
    postedAt: toDate(p.createdAt),
    salaryHint: sr?.min ? `${sr.currency ?? ""} ${sr.min}-${sr.max ?? ""} ${sr.interval ?? ""}`.trim() : undefined,
    detailFetched: true,
  };
}

export const lever: Adapter = {
  ats: "lever",
  tier: "api",
  async listJobs(company, ctx) {
    const slug = requireSlug(company);
    const data = await ctx.http.json<LeverPosting[]>(`https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`);
    return { jobs: data.map(mapLever), complete: true };
  },
  async getJob(url, company, ctx) {
    const m = url.match(/lever\.co\/([^/]+)\/([0-9a-f-]{36})/i);
    const slug = m?.[1] ?? requireSlug(company);
    const id = m?.[2];
    if (!id) return findInBoard(() => lever.listJobs(company, ctx), (j) => j.url === url);
    const p = await jsonOrGone<LeverPosting>(ctx, `https://api.lever.co/v0/postings/${slug}/${id}`);
    return p ? mapLever(p) : null;
  },
};

/* --------------------------- Greenhouse --------------------------- */
interface GhJob {
  id: number;
  title: string;
  absolute_url: string;
  location?: { name?: string };
  offices?: { name?: string; location?: string | null }[];
  content?: string;
  updated_at?: string;
  first_published?: string;
  departments?: { name: string }[];
  metadata?: { name: string; value: unknown }[] | null;
}

function mapGh(j: GhJob): RawJob {
  return {
    source: "greenhouse",
    sourceJobId: String(j.id),
    url: j.absolute_url,
    applyUrl: j.absolute_url,
    title: j.title.trim(),
    descriptionText: htmlToText(j.content),
    locations: compact([j.location?.name, ...(j.offices ?? []).map((o) => o.location ?? o.name)]),
    department: j.departments?.[0]?.name,
    postedAt: toDate(j.first_published ?? j.updated_at),
    detailFetched: j.content !== undefined,
  };
}

export const greenhouse: Adapter = {
  ats: "greenhouse",
  tier: "api",
  async listJobs(company, ctx) {
    const slug = requireSlug(company);
    const data = await ctx.http.json<{ jobs: GhJob[] }>(
      `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs?content=true`,
    );
    return { jobs: data.jobs.map(mapGh), complete: true };
  },
  async getJob(url, company, ctx) {
    const u = new URL(url);
    const id = u.searchParams.get("gh_jid") ?? url.match(/\/jobs\/(\d+)/)?.[1];
    const slug = url.match(/greenhouse\.io\/(?:embed\/job_app\?for=)?([^/?]+)\/jobs/)?.[1] ?? requireSlug(company);
    if (!id) return null;
    const j = await jsonOrGone<GhJob>(ctx, `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs/${id}?content=true`);
    return j ? mapGh(j) : null;
  },
};

/* ----------------------------- Ashby ----------------------------- */
interface AshbyJob {
  id: string;
  title: string;
  location?: string;
  secondaryLocations?: { location: string }[];
  employmentType?: string;
  isRemote?: boolean;
  workplaceType?: string;
  descriptionPlain?: string;
  descriptionHtml?: string;
  publishedAt?: string;
  jobUrl: string;
  applyUrl?: string;
  isListed?: boolean;
  department?: string;
  compensation?: { compensationTierSummary?: string; scrapeableCompensationSalarySummary?: string };
  address?: { postalAddress?: { addressLocality?: string; addressRegion?: string; addressCountry?: string } };
}

function mapAshby(j: AshbyJob): RawJob {
  const addr = j.address?.postalAddress;
  return {
    source: "ashby",
    sourceJobId: j.id,
    url: j.jobUrl,
    applyUrl: j.applyUrl,
    title: j.title.trim(),
    descriptionText: j.descriptionPlain ?? htmlToText(j.descriptionHtml),
    locations: compact([
      j.location,
      ...(j.secondaryLocations ?? []).map((s) => s.location),
      addr ? compact([addr.addressLocality, addr.addressRegion, addr.addressCountry]).join(", ") : undefined,
    ]),
    workplaceHint: j.workplaceType ?? (j.isRemote ? "Remote" : undefined),
    employmentTypeHint: j.employmentType,
    department: j.department,
    postedAt: toDate(j.publishedAt),
    salaryHint: j.compensation?.scrapeableCompensationSalarySummary ?? j.compensation?.compensationTierSummary,
    detailFetched: true,
  };
}

export const ashby: Adapter = {
  ats: "ashby",
  tier: "api",
  async listJobs(company, ctx) {
    const slug = requireSlug(company);
    const data = await ctx.http.json<{ jobs: AshbyJob[] }>(
      `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}?includeCompensation=true`,
    );
    return { jobs: data.jobs.filter((j) => j.isListed !== false).map(mapAshby), complete: true };
  },
  async getJob(url, company, ctx) {
    const id = url.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0];
    return findInBoard(() => ashby.listJobs(company, ctx), (j) => j.sourceJobId === id || j.url === url);
  },
};

/* ------------------------- SmartRecruiters ------------------------- */
interface SrListItem {
  id: string;
  name: string;
  ref?: string;
  releasedDate?: string;
  location?: { city?: string; region?: string; country?: string; remote?: boolean; hybrid?: boolean; fullLocation?: string };
  typeOfEmployment?: { label?: string };
  experienceLevel?: { label?: string };
  department?: { label?: string };
  company?: { identifier?: string; name?: string };
}
interface SrDetail extends SrListItem {
  postingUrl?: string;
  applyUrl?: string;
  active?: boolean;
  jobAd?: { sections?: Record<string, { title?: string; text?: string }> };
}

function srUrl(companyId: string, id: string) {
  return `https://jobs.smartrecruiters.com/${companyId}/${id}`;
}

function mapSr(companyId: string, j: SrListItem | SrDetail): RawJob {
  const d = j as SrDetail;
  const sections = d.jobAd?.sections ?? {};
  const loc = j.location;
  return {
    source: "smartrecruiters",
    sourceJobId: j.id,
    url: d.postingUrl ?? srUrl(companyId, j.id),
    applyUrl: d.applyUrl,
    title: j.name.trim(),
    descriptionText: ["jobDescription", "qualifications", "additionalInformation"]
      .map((k) => htmlToText(sections[k]?.text))
      .filter(Boolean)
      .join("\n\n"),
    locations: compact([loc?.fullLocation ?? compact([loc?.city, loc?.region, loc?.country]).join(", ")]),
    workplaceHint: loc?.remote ? "Remote" : loc?.hybrid ? "Hybrid" : undefined,
    employmentTypeHint: j.typeOfEmployment?.label,
    department: j.department?.label,
    postedAt: toDate(j.releasedDate),
    detailFetched: !!d.jobAd,
  };
}

async function srDetail(ctx: AdapterContext, companyId: string, id: string) {
  return jsonOrGone<SrDetail>(
    ctx,
    `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(companyId)}/postings/${encodeURIComponent(id)}`,
  );
}

export const smartrecruiters: Adapter = {
  ats: "smartrecruiters",
  tier: "api",
  async listJobs(company, ctx) {
    const cid = requireSlug(company);
    const items: SrListItem[] = [];
    let complete = true;
    for (let offset = 0; offset < 2000; offset += 100) {
      const page = await ctx.http.json<{ totalFound: number; content: SrListItem[] }>(
        `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(cid)}/postings?limit=100&offset=${offset}`,
      );
      items.push(...page.content);
      if (page.content.length < 100 || items.length >= page.totalFound) break;
      if (offset + 100 >= 2000) complete = false;
    }
    let budget = ctx.maxDetailFetches ?? 40;
    const jobs: RawJob[] = [];
    for (const it of items) {
      if (!ctx.knownJobIds?.has(it.id) && budget-- > 0) {
        const d = await srDetail(ctx, cid, it.id).catch(() => null);
        jobs.push(mapSr(cid, d ?? it));
      } else jobs.push(mapSr(cid, it));
    }
    return { jobs, complete };
  },
  async getJob(url, company, ctx) {
    const m = url.match(/smartrecruiters\.com\/([^/]+)\/(\d+)/);
    const cid = m?.[1] ?? requireSlug(company);
    if (!m?.[2]) return null;
    const d = await srDetail(ctx, cid, m[2]);
    if (!d || d.active === false) return null;
    return mapSr(cid, d);
  },
};

/* ---------------------------- Workable ---------------------------- */
interface WorkableJob {
  title: string;
  shortcode: string;
  employment_type?: string;
  telecommuting?: boolean;
  department?: string;
  url?: string;
  shortlink?: string;
  application_url?: string;
  published_on?: string;
  created_at?: string;
  city?: string;
  state?: string;
  country?: string;
  experience?: string;
  description?: string;
  locations?: { city?: string; region?: string; country?: string; hidden?: boolean }[];
}

function mapWorkable(slug: string, j: WorkableJob): RawJob {
  const locs = (j.locations?.length ? j.locations : [{ city: j.city, region: j.state, country: j.country }])
    .filter((l) => !("hidden" in l && l.hidden))
    .map((l) => compact([l.city, l.region, l.country]).join(", "));
  return {
    source: "workable",
    sourceJobId: j.shortcode,
    url: j.url ?? `https://apply.workable.com/${slug}/j/${j.shortcode}/`,
    applyUrl: j.application_url,
    title: j.title.trim(),
    descriptionText: htmlToText(j.description),
    locations: compact(locs),
    workplaceHint: j.telecommuting ? "Remote" : undefined,
    employmentTypeHint: j.employment_type,
    department: j.department,
    postedAt: toDate(j.published_on ?? j.created_at),
    detailFetched: j.description !== undefined,
  };
}

export const workable: Adapter = {
  ats: "workable",
  tier: "api",
  async listJobs(company, ctx) {
    const slug = requireSlug(company);
    const data = await ctx.http.json<{ jobs: WorkableJob[] }>(
      `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(slug)}?details=true`,
    );
    return { jobs: data.jobs.map((j) => mapWorkable(slug, j)), complete: true };
  },
  async getJob(url, company, ctx) {
    const code = url.match(/\/j\/([A-Z0-9]+)/i)?.[1];
    return findInBoard(() => workable.listJobs(company, ctx), (j) => j.sourceJobId === code || j.url === url);
  },
};

/* ---------------------------- Recruitee ---------------------------- */
interface RecruiteeOffer {
  id: number;
  slug: string;
  title: string;
  description?: string;
  requirements?: string;
  location?: string;
  city?: string;
  country?: string;
  remote?: boolean;
  hybrid?: boolean;
  employment_type_code?: string;
  careers_url: string;
  careers_apply_url?: string;
  published_at?: string;
  status?: string;
  locations?: { city?: string; country?: string; state?: string }[];
  salary?: { min?: string | number; max?: string | number; currency?: string; period?: string } | null;
}

function mapRecruitee(o: RecruiteeOffer): RawJob {
  const s = o.salary;
  return {
    source: "recruitee",
    sourceJobId: String(o.id),
    url: o.careers_url,
    applyUrl: o.careers_apply_url,
    title: o.title.trim(),
    descriptionText: [htmlToText(o.description), htmlToText(o.requirements)].filter(Boolean).join("\n\n"),
    locations: compact([
      ...(o.locations ?? []).map((l) => compact([l.city, l.state, l.country]).join(", ")),
      o.location,
    ]),
    workplaceHint: o.remote ? "Remote" : o.hybrid ? "Hybrid" : undefined,
    employmentTypeHint: o.employment_type_code,
    postedAt: toDate(o.published_at),
    salaryHint: s?.min ? `${s.currency ?? ""} ${s.min}-${s.max ?? ""} ${s.period ?? ""}`.trim() : undefined,
    detailFetched: true,
  };
}

export const recruitee: Adapter = {
  ats: "recruitee",
  tier: "api",
  async listJobs(company, ctx) {
    const slug = requireSlug(company);
    const data = await ctx.http.json<{ offers: RecruiteeOffer[] }>(
      `https://${encodeURIComponent(slug)}.recruitee.com/api/offers/`,
    );
    return { jobs: data.offers.filter((o) => !o.status || o.status === "published").map(mapRecruitee), complete: true };
  },
  async getJob(url, company, ctx) {
    return findInBoard(() => recruitee.listJobs(company, ctx), (j) => j.url === url);
  },
};

/* ----------------------------- Amazon ----------------------------- */
interface AmazonJob {
  id_icims: string;
  title: string;
  job_path: string;
  city?: string;
  location?: string;
  normalized_location?: string;
  posted_date?: string;
  description?: string;
  basic_qualifications?: string;
  preferred_qualifications?: string;
  job_schedule_type?: string;
  job_category?: string;
}

function mapAmazon(j: AmazonJob): RawJob {
  return {
    source: "amazon",
    sourceJobId: j.id_icims,
    url: `https://www.amazon.jobs${j.job_path}`,
    title: j.title.trim(),
    descriptionText: [j.description, j.basic_qualifications, j.preferred_qualifications]
      .map((s) => htmlToText(s))
      .filter(Boolean)
      .join("\n\n"),
    locations: compact([j.normalized_location ?? j.location]),
    employmentTypeHint: j.job_schedule_type,
    department: j.job_category,
    postedAt: toDate(j.posted_date),
    detailFetched: true,
  };
}

/** India only, filtered to tech categories to keep the snapshot small. */
const AMAZON_CATEGORIES = ["software-development", "machine-learning-science", "data-science", "systems-quality-security-engineering"];

export const amazon: Adapter = {
  ats: "amazon",
  tier: "api",
  async listJobs(_company, ctx) {
    const jobs: RawJob[] = [];
    let complete = true;
    for (const cat of AMAZON_CATEGORIES) {
      let hits = Infinity;
      for (let offset = 0; offset < hits && offset < 1000; offset += 100) {
        const q = new URLSearchParams({
          offset: String(offset),
          result_limit: "100",
          sort: "recent",
          "normalized_country_code[]": "IND",
          "category[]": cat,
        });
        const page = await ctx.http.json<{ hits: number; jobs: AmazonJob[] }>(`https://www.amazon.jobs/en/search.json?${q}`);
        hits = page.hits;
        jobs.push(...page.jobs.map(mapAmazon));
        if (!page.jobs.length) break;
        if (offset + 100 >= 1000 && hits > 1000) complete = false;
      }
    }
    const seen = new Set<string>();
    return { jobs: jobs.filter((j) => !seen.has(j.sourceJobId) && seen.add(j.sourceJobId)), complete };
  },
  async getJob(url, _company, ctx) {
    // Re-listing all of India is too heavy for one posting; read the page (JSON-LD) instead.
    const id = url.match(/\/jobs\/(\d+)/)?.[1];
    const r = await fetchPosting(ctx, url, { ats: "amazon", jobLink: /\/jobs\/\d+/ });
    return r ? { ...r.job, sourceJobId: id ?? r.job.sourceJobId } : null;
  },
};

export const API_ADAPTERS = { lever, greenhouse, ashby, smartrecruiters, workable, recruitee, amazon } satisfies Record<
  string,
  Adapter
>;

export type { CompanyRef };
