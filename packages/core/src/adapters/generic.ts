import type { RenderedPage } from "../browser";
import { FetchError, isFetchError } from "../fetch/http";
import { decodeEntities, htmlToText, normalizeWs } from "../text";
import type { Adapter, AdapterContext, Ats, CompanyRef, ListResult, RawJob } from "../types";
import { extractJobPostings, jobFromLd } from "./jsonld";
import { uniq } from "./util";

export const GENERIC_JOB_LINK =
  /\/(jobs?|careers?|positions?|openings?|vacanc(y|ies)|requisitions?|job-?details?)\/[^?#]*?(\d{3,}|[a-z0-9-]{12,})/i;
const NOT_JOB = /\/(search|category|categories|teams?|locations?|departments?|benefits|life|about|culture|faq|blog)\/?($|\?)/i;

export interface BrowserAtsConfig {
  ats: Ats;
  /** Matches individual posting URLs. */
  jobLink: RegExp;
  /** Where to start when the company has no careersUrl. */
  listUrl?: (c: CompanyRef) => string | undefined;
  /** The list page needs JS. Skip the plain-HTTP attempt. */
  needsRender?: boolean;
  renderOpts?: { scrolls?: number; clickSelector?: string; maxClicks?: number };
  /** Detail pages need JS. */
  detailNeedsRender?: boolean;
  idFromUrl?: (url: string) => string;
}

export function defaultIdFromUrl(url: string): string {
  const u = new URL(url);
  const digits = u.pathname.match(/\d{4,}/g);
  if (digits?.length) return digits.sort((a, b) => b.length - a.length)[0]!;
  const q = [...u.searchParams.entries()].find(([k]) => /(job|req|id)/i.test(k));
  return q ? q[1] : u.pathname.replace(/\/$/, "");
}

export function extractLinks(html: string, baseUrl: string): { href: string; text: string }[] {
  const out: { href: string; text: string }[] = [];
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    try {
      out.push({ href: new URL(decodeEntities(m[1]!), baseUrl).toString(), text: normalizeWs(htmlToText(m[2]!)) });
    } catch {
      /* bad URL */
    }
  }
  return out;
}

export function extractSitemapLocs(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => decodeEntities(m[1]!));
}

function sameSite(a: string, b: string): boolean {
  const root = (h: string) => h.split(".").slice(-2).join(".");
  return root(new URL(a).hostname) === root(new URL(b).hostname);
}

/** Title/location via simple selectors, used when there is no JSON-LD. */
export function extractBySelectors(html: string, url: string, source: Ats): RawJob | null {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1];
  const h1 = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  const title = normalizeWs(decodeEntities(htmlToText(h1 ?? og ?? "")));
  if (!title || title.length > 200) return null;
  const locs = [
    ...html.matchAll(/<[^>]+(?:class|data-[a-z-]+|id)=["'][^"']*location[^"']*["'][^>]*>([\s\S]{1,300}?)<\/[a-z]+>/gi),
  ]
    .map((m) => normalizeWs(htmlToText(m[1]!)))
    .filter((s) => s && s.length < 120);
  const main = html.match(/<(main|article)\b[\s\S]*?<\/\1>/i)?.[0] ?? html;
  return {
    source,
    sourceJobId: defaultIdFromUrl(url),
    url,
    title,
    descriptionText: htmlToText(main).slice(0, 20000),
    locations: uniq(locs).slice(0, 5),
    detailFetched: true,
  };
}

export type ExtractMethod = "jsonld" | "selectors" | "ai";

export async function extractJobFromPage(
  page: { html: string; text?: string; url: string },
  source: Ats,
  ctx: AdapterContext,
): Promise<{ job: RawJob; method: ExtractMethod } | null> {
  const lds = extractJobPostings(page.html);
  for (const ld of lds) {
    const j = jobFromLd(ld, page.url, source, defaultIdFromUrl(page.url));
    if (j) return { job: { ...j, sourceJobId: defaultIdFromUrl(page.url) || j.sourceJobId }, method: "jsonld" };
  }
  const sel = extractBySelectors(page.html, page.url, source);
  if (sel && sel.descriptionText.length > 400) return { job: sel, method: "selectors" };
  if (ctx.ai) {
    const text = page.text ?? htmlToText(page.html);
    const ai = await ctx.ai.extractJob(text.slice(0, 15000), page.url).catch(() => null);
    if (ai?.title) {
      return {
        job: {
          source,
          sourceJobId: defaultIdFromUrl(page.url),
          url: page.url,
          title: ai.title,
          descriptionText: ai.descriptionText ?? text.slice(0, 20000),
          locations: ai.locations ?? [],
          employmentTypeHint: ai.employmentTypeHint,
          workplaceHint: ai.workplaceHint,
          detailFetched: true,
        },
        method: "ai",
      };
    }
  }
  return sel ? { job: sel, method: "selectors" } : null;
}

async function discoverFromSitemap(ctx: AdapterContext, startUrl: string, cfg: BrowserAtsConfig): Promise<string[]> {
  const origin = new URL(startUrl).origin;
  const queue = [`${origin}/sitemap.xml`];
  const found: string[] = [];
  for (let i = 0; i < queue.length && i < 6; i++) {
    let res;
    try {
      res = await ctx.http.fetch({ url: queue[i]! });
    } catch (e) {
      if (isFetchError(e) && e.kind === "circuit_open") throw e;
      continue;
    }
    if (res.status !== 200 || !/<(urlset|sitemapindex)/i.test(res.body)) continue;
    const locs = extractSitemapLocs(res.body);
    if (/<sitemapindex/i.test(res.body)) {
      queue.push(...locs.filter((l) => /job|career|posting|position/i.test(l)).slice(0, 5));
    } else {
      found.push(...locs.filter((l) => cfg.jobLink.test(l) && !NOT_JOB.test(l)));
    }
  }
  return uniq(found);
}

async function discoverFromPage(
  ctx: AdapterContext,
  listUrl: string,
  cfg: BrowserAtsConfig,
): Promise<{ links: { href: string; text: string }[]; rendered?: RenderedPage }> {
  const pick = (ls: { href: string; text: string }[]) =>
    ls.filter((l) => cfg.jobLink.test(l.href) && !NOT_JOB.test(l.href) && sameSite(l.href, listUrl));
  if (!cfg.needsRender) {
    try {
      const res = await ctx.http.fetch({ url: listUrl });
      if (res.status === 200) {
        const links = pick(extractLinks(res.body, res.url));
        if (links.length >= 1 || !ctx.browser) return { links };
      }
    } catch (e) {
      if (!ctx.browser || (isFetchError(e) && e.kind === "robots_disallowed")) throw e;
    }
  }
  if (!ctx.browser) throw new FetchError("http", `${cfg.ats} list page needs a browser`, listUrl);
  if (!(await ctx.http.isAllowed(listUrl))) throw new FetchError("robots_disallowed", "robots", listUrl);
  const page = await ctx.browser.render(listUrl, { scrolls: 3, ...cfg.renderOpts });
  return { links: pick(page.links), rendered: page };
}

/** Fetch one posting page; HTTP first, browser if the HTML is a JS shell. Null if the page is gone. */
export async function fetchPosting(
  ctx: AdapterContext,
  url: string,
  cfg: BrowserAtsConfig,
): Promise<{ job: RawJob; method: ExtractMethod } | null> {
  if (!cfg.detailNeedsRender) {
    try {
      const res = await ctx.http.fetch({ url });
      if (res.status === 404 || res.status === 410) return null;
      if (res.status === 200) {
        const r = await extractJobFromPage({ html: res.body, url: res.url }, cfg.ats, ctx);
        if (r && (r.method !== "selectors" || !ctx.browser)) return r;
      }
    } catch (e) {
      // Blocked plain HTTP (403 challenge / open circuit) → escalate to our own browser; anything else is fatal.
      const blocked = isFetchError(e) && (e.kind === "blocked" || e.kind === "circuit_open" || e.status === 403 || e.status === 429);
      if (!blocked || !ctx.browser) throw e;
    }
  }
  if (!ctx.browser) return null;
  if (!(await ctx.http.isAllowed(url))) throw new FetchError("robots_disallowed", "robots", url);
  const page = await ctx.browser.render(url);
  if (page.status === 403 || page.status === 429) throw new FetchError("blocked", `browser also blocked (${page.status})`, url, page.status);
  if (page.status === 404 || page.status === 410) return null;
  return extractJobFromPage({ html: page.html, text: page.text, url: page.finalUrl }, cfg.ats, ctx);
}

export function makeBrowserAdapter(cfg: BrowserAtsConfig): Adapter {
  const idOf = cfg.idFromUrl ?? defaultIdFromUrl;
  const adapter: Adapter = {
    ats: cfg.ats,
    tier: "browser",
    async listJobs(company, ctx): Promise<ListResult> {
      const listUrl = company.careersUrl ?? cfg.listUrl?.(company);
      if (!listUrl) throw new Error(`${company.name}: careersUrl required for ${cfg.ats}`);
      let urls = await discoverFromSitemap(ctx, listUrl, cfg);
      let anchorText = new Map<string, string>();
      if (!urls.length) {
        const { links } = await discoverFromPage(ctx, listUrl, cfg);
        urls = uniq(links.map((l) => l.href));
        anchorText = new Map(links.map((l) => [l.href, l.text]));
      }
      let budget = ctx.maxDetailFetches ?? 25;
      const jobs: RawJob[] = [];
      let fetched = 0;
      let blockedBoth = false;
      for (const url of urls) {
        const id = idOf(url);
        if (ctx.knownJobIds?.has(id) || budget <= 0) {
          jobs.push({
            source: cfg.ats,
            sourceJobId: id,
            url,
            title: anchorText.get(url) ?? "",
            descriptionText: "",
            locations: [],
            detailFetched: false,
          });
          continue;
        }
        budget--;
        try {
          const r = await fetchPosting(ctx, url, cfg);
          fetched++;
          if (r) jobs.push({ ...r.job, sourceJobId: id, url });
        } catch (e) {
          ctx.log?.("posting fetch failed", { url, err: (e as Error).message });
          if (isFetchError(e) && e.kind === "blocked" && /browser also blocked/.test(e.message)) {
            blockedBoth = true; // both our paths are blocked: stop for today
            break;
          }
        }
      }
      // Nothing readable and both our paths blocked → report it, so the budget router can escalate (Apify) and admins see it.
      if (blockedBoth && fetched === 0) throw new FetchError("blocked", `${cfg.ats}: postings blocked for HTTP and browser`, listUrl);
      // Link discovery can miss postings, so never claim a complete snapshot (S1 can't close jobs here).
      return { jobs, complete: false };
    },
    async getJob(url, _company, ctx) {
      const r = await fetchPosting(ctx, url, cfg);
      return r ? { ...r.job, sourceJobId: idOf(url), url } : null;
    },
  };
  return adapter;
}

export const BROWSER_CONFIGS: Record<string, BrowserAtsConfig> = {
  icims: {
    ats: "icims",
    jobLink: /icims\.com\/jobs\/\d+\//i,
    listUrl: (c) => (c.atsSlug ? `https://careers-${c.atsSlug}.icims.com/jobs/search?ss=1&in_iframe=1` : undefined),
    idFromUrl: (u) => u.match(/\/jobs\/(\d+)/)?.[1] ?? defaultIdFromUrl(u),
  },
  successfactors: {
    ats: "successfactors",
    // RMK sites: /job/<slug>/<id>/ or /<lang>/jobs/<id>/<slug>/; classic: career_job_req_id=<id>
    jobLink: /(\/job\/[^/]+\/\d+\/?$|\/jobs?\/\d{6,}\/[^/?#]+|career_job_req_id=\d+)/i,
    idFromUrl: (u) => u.match(/career_job_req_id=(\d+)/)?.[1] ?? u.match(/\/jobs?\/(\d{6,})\//)?.[1] ?? u.match(/\/(\d+)\/?$/)?.[1] ?? defaultIdFromUrl(u),
  },
  phenom: {
    ats: "phenom",
    jobLink: /\/job\/[A-Za-z0-9_-]+(\/[^/?#]+)?\/?$/i,
    renderOpts: { clickSelector: "[data-ph-at-id='load-more-jobs-button'], a.next-btn", maxClicks: 10 },
    idFromUrl: (u) => u.match(/\/job\/([A-Za-z0-9_-]+)/)?.[1] ?? defaultIdFromUrl(u),
  },
  keka: {
    ats: "keka",
    jobLink: /keka\.com\/careers\/jobdetails\/\d+/i,
    listUrl: (c) => (c.atsSlug ? `https://${c.atsSlug}.keka.com/careers/` : undefined),
    needsRender: true,
    detailNeedsRender: true,
  },
  kula: {
    ats: "kula",
    jobLink: /careers\.kula\.ai\/[^/]+\/\d+/i,
    listUrl: (c) => (c.atsSlug ? `https://careers.kula.ai/${c.atsSlug}` : undefined),
    needsRender: true,
    detailNeedsRender: true,
  },
  darwinbox: {
    ats: "darwinbox",
    jobLink: /darwinbox\.(in|com)\/ms\/candidate(v2)?\/(careers|a[a-z0-9]+)\/[a-z0-9]{8,}/i,
    listUrl: (c) => (c.atsSlug ? `https://${c.atsSlug}.darwinbox.in/ms/candidate/careers` : undefined),
    needsRender: true,
    detailNeedsRender: true,
    idFromUrl: (u) => new URL(u).pathname.split("/").filter(Boolean).pop() ?? u,
  },
  zoho: {
    ats: "zoho",
    jobLink: /zohorecruit\.(com|in|eu)\/jobs\/[^/]+\/\d{6,}/i,
    listUrl: (c) => (c.atsSlug ? `https://${c.atsSlug}.zohorecruit.in/jobs/Careers` : undefined),
    needsRender: true,
  },
  freshteam: {
    ats: "freshteam",
    jobLink: /freshteam\.com\/jobs\/[A-Za-z0-9_-]{6,}\/[^/?#]+/i,
    listUrl: (c) => (c.atsSlug ? `https://${c.atsSlug}.freshteam.com/jobs` : undefined),
    idFromUrl: (u) => u.match(/\/jobs\/([A-Za-z0-9_-]{6,})/)?.[1] ?? u,
  },
  google: {
    ats: "google",
    jobLink: /\/jobs\/results\/\d{6,}-/i,
    listUrl: () =>
      "https://www.google.com/about/careers/applications/jobs/results?location=India&target_level=EARLY&target_level=MID",
    idFromUrl: (u) => u.match(/\/results\/(\d+)/)?.[1] ?? u,
  },
  custom: { ats: "custom", jobLink: GENERIC_JOB_LINK },
};

export const icims = makeBrowserAdapter(BROWSER_CONFIGS.icims!);
export const successfactors = makeBrowserAdapter(BROWSER_CONFIGS.successfactors!);
export const phenom = makeBrowserAdapter(BROWSER_CONFIGS.phenom!);
export const keka = makeBrowserAdapter(BROWSER_CONFIGS.keka!);
export const kula = makeBrowserAdapter(BROWSER_CONFIGS.kula!);
export const darwinbox = makeBrowserAdapter(BROWSER_CONFIGS.darwinbox!);
export const zoho = makeBrowserAdapter(BROWSER_CONFIGS.zoho!);
export const freshteam = makeBrowserAdapter(BROWSER_CONFIGS.freshteam!);
export const google = makeBrowserAdapter(BROWSER_CONFIGS.google!);
export const custom = makeBrowserAdapter(BROWSER_CONFIGS.custom!);
