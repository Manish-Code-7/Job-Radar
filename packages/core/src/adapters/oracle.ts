import { htmlToText } from "../text";
import type { Adapter, AdapterContext, CompanyRef, RawJob } from "../types";
import { compact, jsonOrGone, toDate } from "./util";
import { DEFAULT_WORKDAY_SEARCHES } from "./workday";

/** Oracle Recruiting Cloud (Candidate Experience) public REST API. */
export interface OracleSite {
  origin: string;
  siteNumber: string;
  lang: string;
}

export function parseOracleUrl(url: string): OracleSite | null {
  const u = new URL(url);
  const m = u.pathname.match(/\/hcmUI\/CandidateExperience\/([a-z]{2})\/sites\/([^/]+)/i);
  if (!m) return null;
  return { origin: u.origin, lang: m[1]!, siteNumber: m[2]! };
}

interface OracleReq {
  Id: string;
  Title: string;
  PostedDate?: string;
  PrimaryLocation?: string;
  PrimaryLocationCountry?: string;
  ShortDescriptionStr?: string;
  WorkplaceType?: string;
  JobSchedule?: string;
  secondaryLocations?: { Name?: string }[];
}
interface OracleDetail extends OracleReq {
  ExternalDescriptionStr?: string;
  ExternalQualificationsStr?: string;
  ExternalResponsibilitiesStr?: string;
  JobType?: string;
}

function jobUrl(s: OracleSite, id: string) {
  return `${s.origin}/hcmUI/CandidateExperience/${s.lang}/sites/${s.siteNumber}/job/${id}`;
}

function map(s: OracleSite, r: OracleReq | OracleDetail): RawJob {
  const d = r as OracleDetail;
  const full = [d.ExternalDescriptionStr, d.ExternalResponsibilitiesStr, d.ExternalQualificationsStr]
    .map((x) => htmlToText(x))
    .filter(Boolean)
    .join("\n\n");
  return {
    source: "oracle",
    sourceJobId: String(r.Id),
    url: jobUrl(s, String(r.Id)),
    title: r.Title.trim(),
    descriptionText: full || htmlToText(r.ShortDescriptionStr),
    locations: compact([r.PrimaryLocation, ...(r.secondaryLocations ?? []).map((l) => l.Name)]),
    workplaceHint: r.WorkplaceType,
    employmentTypeHint: r.JobSchedule ?? d.JobType,
    postedAt: toDate(r.PostedDate),
    detailFetched: !!full,
  };
}

async function detail(ctx: AdapterContext, s: OracleSite, id: string) {
  const url =
    `${s.origin}/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails?expand=all&onlyData=true` +
    `&finder=ById;Id=%22${encodeURIComponent(id)}%22,siteNumber=${encodeURIComponent(s.siteNumber)}`;
  const r = await jsonOrGone<{ items: OracleDetail[] }>(ctx, url);
  return r?.items?.[0] ?? null;
}

export const oracle: Adapter = {
  ats: "oracle",
  tier: "api",
  async listJobs(company: CompanyRef, ctx: AdapterContext) {
    const s = parseOracleUrl(company.careersUrl ?? "");
    if (!s) throw new Error(`${company.name}: careersUrl must be an Oracle CandidateExperience site URL`);
    const searches = ctx.searchTexts ?? DEFAULT_WORKDAY_SEARCHES;
    const byId = new Map<string, OracleReq>();
    let complete = searches.length === 1 && searches[0] === "";
    for (const q of searches) {
      let total = Infinity;
      for (let offset = 0; offset < total && offset < 500; offset += 25) {
        const kw = q ? `,keyword=%22${encodeURIComponent(q)}%22` : "";
        const url =
          `${s.origin}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true` +
          `&expand=requisitionList.secondaryLocations&finder=findReqs;siteNumber=${s.siteNumber},limit=25,offset=${offset}${kw},sortBy=POSTING_DATES_DESC`;
        const page = await ctx.http.json<{ items: { TotalJobsCount?: number; requisitionList: OracleReq[] }[] }>(url);
        const item = page.items[0];
        total = item?.TotalJobsCount ?? 0;
        for (const r of item?.requisitionList ?? []) byId.set(String(r.Id), r);
        if ((item?.requisitionList.length ?? 0) < 25) break;
        if (offset + 25 >= 500 && total > 500) complete = false;
      }
    }
    let budget = ctx.maxDetailFetches ?? 30;
    const jobs: RawJob[] = [];
    for (const r of byId.values()) {
      if (!ctx.knownJobIds?.has(String(r.Id)) && budget-- > 0) {
        const d = await detail(ctx, s, String(r.Id)).catch(() => null);
        jobs.push(map(s, d ?? r));
      } else jobs.push(map(s, r));
    }
    return { jobs, complete };
  },
  async getJob(url, _company, ctx) {
    const s = parseOracleUrl(url);
    const id = url.match(/\/job\/(\d+)/)?.[1];
    if (!s || !id) return null;
    const d = await detail(ctx, s, id);
    return d ? map(s, d) : null;
  },
};
