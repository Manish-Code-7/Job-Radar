import { describe, expect, it } from "vitest";
import {
  amazon,
  ashby,
  custom,
  detectFromSignals,
  greenhouse,
  icims,
  lever,
  oracle,
  findIndiaFacet,
  parseWorkdayUrl,
  recruitee,
  smartrecruiters,
  workable,
  workday,
  workdayJobId,
} from "../src/adapters";
import type { BrowserDriver, RenderedPage } from "../src/browser";
import type { AdapterContext, CompanyRef, RawJob } from "../src/types";
import { fakeHttp, fixture, json, politeFor, type Route } from "./helpers/fake";

function ctxFor(routes: Route[], extra: Partial<AdapterContext> = {}) {
  const { client, calls } = fakeHttp(routes);
  return { ctx: { http: politeFor(client), ...extra } as AdapterContext, calls };
}

function expectWellFormed(jobs: RawJob[]) {
  expect(jobs.length).toBeGreaterThan(0);
  for (const j of jobs) {
    expect(j.sourceJobId).toBeTruthy();
    expect(j.title).toBeTruthy();
    expect(j.url).toMatch(/^https:\/\//);
    expect(Array.isArray(j.locations)).toBe(true);
  }
}

const co = (ats: CompanyRef["ats"], atsSlug?: string, careersUrl?: string): CompanyRef => ({ name: "Acme", ats, atsSlug, careersUrl });

describe("API-tier adapters (recorded fixtures)", () => {
  it("lever", async () => {
    const { ctx, calls } = ctxFor([[/api\.lever\.co\/v0\/postings\/cred\?mode=json/, json("lever.json")]]);
    const r = await lever.listJobs(co("lever", "cred"), ctx);
    expect(r.complete).toBe(true);
    expectWellFormed(r.jobs);
    expect(r.jobs[0]!.url).toMatch(/jobs\.lever\.co\/cred\//);
    expect(r.jobs[0]!.descriptionText.length).toBeGreaterThan(100);
    expect(calls[0]!.headers!["user-agent"]).toMatch(/^JobRadarBot\/1\.0 \(\+https:\/\/example\.com\/bot\)$/);
  });

  it("greenhouse (HTML-escaped content is decoded)", async () => {
    const { ctx } = ctxFor([[/boards-api\.greenhouse\.io\/v1\/boards\/groww\/jobs\?content=true/, json("greenhouse.json")]]);
    const r = await greenhouse.listJobs(co("greenhouse", "groww"), ctx);
    expectWellFormed(r.jobs);
    const d = r.jobs[0]!.descriptionText;
    expect(d).not.toMatch(/&lt;|<\/?p>|<div/);
    expect(d.length).toBeGreaterThan(100);
  });

  it("greenhouse getJob → null on 404", async () => {
    const { ctx } = ctxFor([[/boards-api.*\/jobs\/999/, () => ({ status: 404 })]]);
    expect(await greenhouse.getJob("https://job-boards.greenhouse.io/groww/jobs/999", co("greenhouse", "groww"), ctx)).toBeNull();
  });

  it("ashby", async () => {
    const { ctx } = ctxFor([[/api\.ashbyhq\.com\/posting-api\/job-board\/sarvam/, json("ashby.json")]]);
    const r = await ashby.listJobs(co("ashby", "sarvam"), ctx);
    expectWellFormed(r.jobs);
    expect(r.jobs[0]!.url).toMatch(/jobs\.ashbyhq\.com\/sarvam\//);
  });

  it("smartrecruiters (list + detail for unknown jobs only)", async () => {
    const list = JSON.parse(fixture("smartrecruiters-list.json"));
    const firstId = list.content[0].id as string;
    const { ctx, calls } = ctxFor([
      [/postings\?limit=100&offset=0/, json("smartrecruiters-list.json")],
      [new RegExp(`postings/${firstId}$`), json("smartrecruiters-detail.json")],
    ]);
    const known = new Set<string>(list.content.slice(1).map((c: { id: string }) => c.id));
    const r = await smartrecruiters.listJobs(co("smartrecruiters", "BoschGroup"), { ...ctx, knownJobIds: known });
    expectWellFormed(r.jobs);
    expect(r.jobs[0]!.detailFetched).toBe(true);
    expect(r.jobs[0]!.descriptionText.length).toBeGreaterThan(100);
    expect(r.jobs[1]!.detailFetched).toBe(false);
    expect(calls.filter((c) => /postings\/\d+$/.test(c.url))).toHaveLength(1);
  });

  it("workable", async () => {
    const { ctx } = ctxFor([[/apply\.workable\.com\/api\/v1\/widget\/accounts\/huggingface/, json("workable.json")]]);
    const r = await workable.listJobs(co("workable", "huggingface"), ctx);
    expectWellFormed(r.jobs);
    expect(r.jobs[0]!.workplaceHint).toBe("Remote");
  });

  it("recruitee", async () => {
    const { ctx } = ctxFor([[/bunq\.recruitee\.com\/api\/offers/, json("recruitee.json")]]);
    const r = await recruitee.listJobs(co("recruitee", "bunq"), ctx);
    expectWellFormed(r.jobs);
  });

  it("amazon (India filter, paginates until empty)", async () => {
    let n = 0;
    const { ctx, calls } = ctxFor([
      [/amazon\.jobs\/en\/search\.json/, () => (n++ === 0 ? { body: fixture("amazon.json") } : { body: JSON.stringify({ hits: 3, jobs: [] }) })],
    ]);
    const r = await amazon.listJobs(co("amazon"), ctx);
    expectWellFormed(r.jobs);
    expect(r.jobs.every((j) => /IND/.test(j.locations.join()))).toBe(true);
    expect(decodeURIComponent(calls[0]!.url)).toContain("normalized_country_code[]=IND");
  });
});

describe("workday", () => {
  const site = "https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite";

  it("parses tenant/site URLs", () => {
    expect(parseWorkdayUrl(site)).toMatchObject({ tenant: "nvidia", site: "NVIDIAExternalCareerSite" });
    expect(parseWorkdayUrl("https://x.wd3.myworkdayjobs.com/External/job/India/SE_R123")).toMatchObject({ site: "External" });
    expect(workdayJobId("/job/India-Bengaluru/Research-Scientist_JR2028483")).toBe("JR2028483");
  });

  it("finds the India location facet at any depth", () => {
    const facets = JSON.parse(fixture("workday-list.json")).facets;
    expect(findIndiaFacet(facets)).toEqual({ param: "locationHierarchy1", id: "2fcb99c455831013ea52b82135ba3266" });
    expect(findIndiaFacet([{ facetParameter: "locationCountry", values: [{ descriptor: "India", id: "c1" }] }])).toEqual({ param: "locationCountry", id: "c1" });
    expect(findIndiaFacet([])).toBeNull();
  });

  it("India board ≤ 500 → one unfiltered India pass → complete snapshot", async () => {
    const list = JSON.parse(fixture("workday-list.json"));
    const bodies: unknown[] = [];
    const { ctx } = ctxFor([
      [/\/jobs$/, (req) => {
        const b = JSON.parse(req.body!);
        bodies.push(b);
        return { body: JSON.stringify(b.offset === 0 ? { ...list, total: 3 } : { jobPostings: [] }) };
      }],
    ]);
    const r = await workday.listJobs(co("workday", undefined, site), { ...ctx, maxDetailFetches: 0 });
    expect(r.complete).toBe(true);
    expect(bodies[1]).toEqual({ appliedFacets: { locationHierarchy1: ["2fcb99c455831013ea52b82135ba3266"] }, limit: 20, offset: 0, searchText: "" });
  });

  it("lists via CXS with POST + fetches details", async () => {
    const list = JSON.parse(fixture("workday-list.json"));
    const { ctx, calls } = ctxFor([
      [/\/wday\/cxs\/nvidia\/NVIDIAExternalCareerSite\/jobs$/, (req) => {
        const b = JSON.parse(req.body!);
        return { body: JSON.stringify(b.offset === 0 ? list : { total: 0, jobPostings: [] }) };
      }],
      [/\/wday\/cxs\/nvidia\/NVIDIAExternalCareerSite\/job\//, json("workday-detail.json")],
    ]);
    const r = await workday.listJobs(co("workday", undefined, site), { ...ctx, searchTexts: ["software engineer"], maxDetailFetches: 1 });
    expectWellFormed(r.jobs);
    expect(r.complete).toBe(false); // search-filtered
    const posts = calls.filter((c) => c.method === "POST").map((c) => JSON.parse(c.body!));
    expect(posts[0]).toEqual({ appliedFacets: {}, limit: 20, offset: 0, searchText: "software engineer" }); // facet probe
    expect(posts[1].appliedFacets).toEqual({ locationHierarchy1: ["2fcb99c455831013ea52b82135ba3266"] }); // then India only
    expect(r.jobs[0]!.detailFetched).toBe(true);
    expect(r.jobs[0]!.descriptionText.length).toBeGreaterThan(100);
    expect(r.jobs[1]!.detailFetched).toBe(false);
  });

  it("falls back to browser network capture on 403", async () => {
    const list = JSON.parse(fixture("workday-list.json"));
    const browser: BrowserDriver = {
      async render(url, opts) {
        expect(opts?.captureJson?.test("https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/NVIDIAExternalCareerSite/jobs")).toBe(true);
        return { requestedUrl: url, finalUrl: url, status: 200, html: "", text: "", title: "", links: [], requestUrls: [], frameUrls: [], json: [{ url, status: 200, body: list }] } satisfies RenderedPage;
      },
      async applyProbe() {
        return { outcome: "error" };
      },
    };
    const { ctx } = ctxFor(
      [[/\/wday\/cxs\/.*\/jobs$/, () => ({ status: 403, headers: { server: "cloudflare" }, body: "<title>Just a moment...</title>" })]],
      { browser, maxDetailFetches: 0 },
    );
    const r = await workday.listJobs(co("workday", undefined, site), { ...ctx, searchTexts: ["x"] });
    expect(r.jobs).toHaveLength(3);
    expect(r.complete).toBe(false);
  });
});

describe("oracle recruiting cloud", () => {
  it("lists + details", async () => {
    const list = JSON.parse(fixture("oracle-list.json"));
    const { ctx } = ctxFor([
      [/recruitingCEJobRequisitions\?/, (req) => ({ body: /offset=0/.test(req.url) ? JSON.stringify(list) : JSON.stringify({ items: [{ TotalJobsCount: 0, requisitionList: [] }] }) })],
      [/recruitingCEJobRequisitionDetails/, json("oracle-detail.json")],
    ]);
    const r = await oracle.listJobs(
      co("oracle", "CX_1001", "https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/requisitions"),
      { ...ctx, searchTexts: ["software"], maxDetailFetches: 1 },
    );
    expectWellFormed(r.jobs);
    expect(r.jobs[0]!.url).toMatch(/\/sites\/CX_1001\/job\/\d+$/);
    expect(r.jobs[0]!.descriptionText.length).toBeGreaterThan(100);
  });
});

describe("browser-tier / generic adapters (synthetic fixtures)", () => {
  const sitemap = `<?xml version="1.0"?><urlset>
    <url><loc>https://careers.acme.in/jobs/12345/associate-software-engineer</loc></url>
    <url><loc>https://careers.acme.in/jobs/search</loc></url>
    <url><loc>https://careers.acme.in/about</loc></url></urlset>`;

  it("custom: sitemap → JSON-LD JobPosting", async () => {
    const { ctx } = ctxFor([
      [/careers\.acme\.in\/sitemap\.xml/, () => ({ body: sitemap })],
      [/\/jobs\/12345\//, () => ({ body: fixture("page-jsonld.html") })],
    ]);
    const r = await custom.listJobs({ ...co("custom"), careersUrl: "https://careers.acme.in/" }, ctx);
    expect(r.complete).toBe(false); // link discovery never claims completeness
    expect(r.jobs).toHaveLength(1);
    expect(r.jobs[0]).toMatchObject({ sourceJobId: "12345", title: "Associate Software Engineer", locations: ["Bengaluru, Karnataka, IN"] });
  });

  it("custom: no sitemap → links from the careers page; known IDs skip the detail fetch", async () => {
    const { ctx, calls } = ctxFor([
      [/careers\.acme\.in\/careers$/, () => ({ body: `<a href="/jobs/12345/ase">Associate SE</a><a href="/jobs/77777/de">Data Engineer</a><a href="/blog/x">Blog</a>` })],
      [/\/jobs\/12345\//, () => ({ body: fixture("page-jsonld.html") })],
    ]);
    const r = await custom.listJobs({ ...co("custom"), careersUrl: "https://careers.acme.in/careers" }, { ...ctx, knownJobIds: new Set(["77777"]) });
    expect(r.jobs.map((j) => j.sourceJobId).sort()).toEqual(["12345", "77777"]);
    expect(r.jobs.find((j) => j.sourceJobId === "77777")).toMatchObject({ detailFetched: false, title: "Data Engineer" });
    expect(calls.some((c) => c.url.includes("77777"))).toBe(false);
  });

  it("icims: builds the list URL from the slug and extracts ids", async () => {
    const { ctx } = ctxFor([
      [/careers-acme\.icims\.com\/sitemap\.xml/, () => ({ status: 404 })],
      [/careers-acme\.icims\.com\/jobs\/search/, () => ({ body: `<a href="https://careers-acme.icims.com/jobs/4321/software-engineer/job">SE</a>` })],
      [/\/jobs\/4321\//, () => ({ body: fixture("page-jsonld.html") })],
    ]);
    const r = await icims.listJobs(co("icims", "acme"), ctx);
    expect(r.jobs[0]!.sourceJobId).toBe("4321");
  });
});

describe("ATS detector", () => {
  it("recognises ATS fingerprints in URLs and HTML", () => {
    const d = (urls: string[], html = "", pageUrl = "https://acme.com/careers") => detectFromSignals({ pageUrl, urls, html })[0];
    expect(d(["https://jobs.lever.co/acme/123"])).toMatchObject({ ats: "lever", slug: "acme" });
    expect(d([], `<script src="https://boards.greenhouse.io/embed/job_board/js?for=acmeco"></script>`)).toMatchObject({ ats: "greenhouse", slug: "acmeco" });
    expect(d(["https://jobs.ashbyhq.com/Acme%20AI"])).toMatchObject({ ats: "ashby", slug: "Acme AI" });
    expect(d([], "", "https://acme.wd3.myworkdayjobs.com/en-US/External")).toMatchObject({ ats: "workday", careersUrl: "https://acme.wd3.myworkdayjobs.com/External" });
    expect(d(["https://careers-acme.icims.com/jobs/search"])).toMatchObject({ ats: "icims", slug: "acme" });
    expect(d(["https://acme.keka.com/careers/"])).toMatchObject({ ats: "keka", slug: "acme" });
    expect(d(["https://hdpc.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/requisitions"])).toMatchObject({ ats: "oracle", slug: "CX_1" });
    expect(d(["https://acme.darwinbox.in/ms/candidate/careers"])).toMatchObject({ ats: "darwinbox" });
    expect(d(["https://acme.zohorecruit.in/jobs/Careers"])).toMatchObject({ ats: "zoho" });
    expect(d([], "<html>no ats here</html>")).toBeUndefined();
  });
});
