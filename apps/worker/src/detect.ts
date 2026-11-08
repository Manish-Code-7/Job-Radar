import { API_TIER_ATS, budgetedStep, detectAts, extractLinks, Priority, runChain, type Detection } from "@job-radar/core";
import { companies, eq, type CompanyRow } from "@job-radar/db";
import type { Deps } from "./deps";
import { info } from "./log";

/** Detect the ATS for a company: own Playwright first, then Firecrawl (1 credit: links + rawHtml). */
export async function detectCompany(deps: Deps, c: CompanyRow, o: { dry?: boolean } = {}): Promise<Detection> {
  const input = { name: c.name, domain: c.domain, careersUrl: c.careersUrl };
  const ctx = { http: deps.http, browser: deps.browser() };
  const start = c.careersUrl ?? (c.domain ? `https://${c.domain}/careers` : undefined);

  const steps = [
    {
      name: "own-playwright",
      run: async () => {
        const d = await detectAts(input, ctx);
        return d.ats === "custom" && d.confidence < 0.5 ? null : d; // not sure → let Firecrawl look
      },
    },
  ];
  if (deps.firecrawl && start) {
    steps.push(
      budgetedStep(deps.router, "firecrawl", {
        provider: "firecrawl",
        estimate: 1,
        priority: Priority.Onboarding,
        task: "detect",
        companyId: c.id,
        cacheKey: `detect:${start}`,
        async call() {
          const r = await deps.firecrawl!.scrape(start, { formats: ["links", "rawHtml"] });
          const html = r.rawHtml ?? "";
          const finalUrl = r.finalUrl ?? start;
          const links = (r.links ?? []).map((href) => ({ href, text: "" })).concat(extractLinks(html, finalUrl));
          const d = await detectAts(input, { http: deps.http }, { finalUrl, html, links, requestUrls: [], frameUrls: [] });
          return { value: d, units: r.creditsUsed ?? 1 };
        },
      }),
    );
  }
  const res = await runChain<Detection>(steps);
  const d = res.value ?? { ats: "custom" as const, careersUrl: start, confidence: 0.2 };
  info("detect", { company: c.name, ...d, via: res.via, attempts: res.attempts });
  if (!o.dry) {
    await deps.db
      .update(companies)
      .set({
        ats: d.ats,
        atsSlug: d.slug ?? c.atsSlug,
        careersUrl: d.careersUrl ?? c.careersUrl,
        tier: API_TIER_ATS.includes(d.ats) || d.ats === "workday" || d.ats === "oracle" ? "api" : "browser",
        detectConfidence: d.confidence,
        updatedAt: new Date(),
      })
      .where(eq(companies.id, c.id));
  }
  return d;
}
