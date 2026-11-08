import { API_TIER_ATS, ATS_VALUES, COMPANY_KINDS, isItServicesEmployer, type Ats, type CompanyKind } from "@job-radar/core";
import { companies, sourcePolicy, sql, type Db } from "@job-radar/db";
import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import { info } from "./log";

/** data/directory.json row: {name, area, kind, ats, slug?, careers?, readable, note?} */
export const DirectoryRow = z.object({
  name: z.string().min(1),
  area: z.string().optional().nullable(),
  kind: z.string(),
  ats: z.string(),
  slug: z.string().optional().nullable(),
  careers: z.string().optional().nullable(),
  readable: z.union([z.boolean(), z.string()]).optional().nullable(),
  note: z.string().optional().nullable(),
});
export type DirectoryRow = z.infer<typeof DirectoryRow>;

export function mapKind(k: string): { kind: CompanyKind; excluded: boolean; reason?: string } {
  const s = k.trim().toLowerCase();
  if (/service/.test(s)) return { kind: "services", excluded: true, reason: "IT services (excluded by policy)" };
  if (/staff|recruit|agency|consult/.test(s)) return { kind: "staffing", excluded: true, reason: "staffing/agency" };
  if (/gcc|captive|capability/.test(s)) return { kind: "gcc", excluded: false };
  if (/startup/.test(s)) return { kind: "startup", excluded: false };
  if (/mnc|multinational/.test(s)) return { kind: "mnc", excluded: false };
  const exact = COMPANY_KINDS.find((x) => x === s);
  return { kind: exact ?? "product", excluded: false };
}

export function mapAts(a: string): Ats {
  const s = a.trim().toLowerCase().replace(/[^a-z]/g, "");
  const alias: Record<string, Ats> = { sapsuccessfactors: "successfactors", sf: "successfactors", oraclerecruiting: "oracle", oraclecloud: "oracle", taleo: "oracle", zohorecruit: "zoho", amazonjobs: "amazon", googlecareers: "google", none: "unknown", "": "unknown" };
  return alias[s] ?? (ATS_VALUES as readonly string[]).find((x) => x === s) as Ats ?? "unknown";
}

function domainOf(url?: string | null): string | null {
  if (!url) return null;
  try {
    const h = new URL(url).hostname.replace(/^www\./, "");
    // Don't treat an ATS host as the company's own domain.
    return /(lever\.co|greenhouse\.io|ashbyhq|myworkdayjobs|icims|smartrecruiters|workable|recruitee|oraclecloud|successfactors|keka|kula|darwinbox|zohorecruit|freshteam)/.test(h) ? null : h;
  } catch {
    return null;
  }
}

/** Deterministic crawl hour (IST) so Workday tenants are spread across the day. */
function crawlHourFor(name: string, ats: Ats): number {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return ats === "workday" ? h % 24 : 1 + (h % 6); // API boards in the 01:00–06:00 window
}

export async function seed(db: Db, file: string, enqueueDetect?: (companyId: string) => Promise<void>) {
  if (!existsSync(file)) throw new Error(`seed file not found: ${file}. Unzip job-radar-data.zip into ./data first.`);
  const rows = z.array(DirectoryRow).parse(JSON.parse(readFileSync(file, "utf8")));
  let inserted = 0;
  let updated = 0;
  const unknown: string[] = [];

  for (const r of rows) {
    const k = mapKind(r.kind);
    const ats = mapAts(r.ats);
    const services = !k.excluded && isItServicesEmployer(r.name);
    const values = {
      name: r.name.trim(),
      domain: domainOf(r.careers),
      cities: r.area ? [r.area.includes(",") ? r.area.split(",").pop()!.trim() : "Bengaluru"] : ["Bengaluru"],
      kind: services ? ("services" as const) : k.kind,
      ats,
      atsSlug: r.slug ?? null,
      careersUrl: r.careers ?? null,
      tier: (API_TIER_ATS.includes(ats) || ats === "workday" || ats === "oracle" ? "api" : "browser") as "api" | "browser",
      excluded: k.excluded || services,
      excludedReason: k.reason ?? (services ? "IT services employer list" : null),
      crawlHour: crawlHourFor(r.name, ats),
      seedMeta: { area: r.area, readable: r.readable, note: r.note, kindRaw: r.kind, atsRaw: r.ats },
    };
    const [res] = await db
      .insert(companies)
      .values(values)
      .onConflictDoUpdate({
        target: companies.name,
        // Never overwrite an ATS the detector or an admin already set with "unknown".
        set: { ...values, ats: sql`case when excluded.ats = 'unknown' then ${companies.ats} else excluded.ats end`, updatedAt: new Date() },
      })
      .returning({ id: companies.id, ats: companies.ats, inserted: sql<boolean>`(xmax = 0)` });
    if (res?.inserted) inserted++;
    else updated++;
    if (res && res.ats === "unknown" && !values.excluded) {
      unknown.push(r.name);
      await enqueueDetect?.(res.id);
    }
  }

  // Source policy: every adapter starts enabled; robots.txt is still checked on every request.
  for (const source of ATS_VALUES) {
    await db
      .insert(sourcePolicy)
      .values({ source, enabled: source !== "unknown", termsNote: "robots.txt enforced per request; review terms before scaling up" })
      .onConflictDoNothing();
  }
  info("seed done", { file, total: rows.length, inserted, updated, queuedForDetect: unknown.length });
  return { total: rows.length, inserted, updated, unknown };
}
