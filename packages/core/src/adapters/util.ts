import { FetchError } from "../fetch/http";
import type { AdapterContext, CompanyRef, ListResult, RawJob } from "../types";

export function requireSlug(company: CompanyRef): string {
  if (!company.atsSlug) throw new Error(`${company.name}: atsSlug required for ${company.ats}`);
  return company.atsSlug;
}

export function toDate(v: unknown): Date | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const d = typeof v === "number" ? new Date(v) : new Date(String(v));
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

export function compact(xs: (string | null | undefined)[]): string[] {
  return uniq(xs.map((x) => (x ?? "").trim()).filter(Boolean));
}

/** Fetch JSON, mapping 404/410 to null (the resource is gone) and anything else to a FetchError. */
export async function jsonOrGone<T>(ctx: AdapterContext, url: string): Promise<T | null> {
  const res = await ctx.http.fetch({ url });
  if (res.status === 404 || res.status === 410) return null;
  if (res.status < 200 || res.status >= 300) throw new FetchError("http", `HTTP ${res.status}`, url, res.status);
  try {
    return JSON.parse(res.body) as T;
  } catch {
    throw new FetchError("http", "invalid JSON", url, res.status);
  }
}

/** getJob for boards without a per-posting endpoint: re-list and find by id. Null only if the snapshot was complete. */
export async function findInBoard(
  list: () => Promise<ListResult>,
  match: (j: RawJob) => boolean,
): Promise<RawJob | null> {
  const res = await list();
  const hit = res.jobs.find(match);
  if (hit) return hit;
  if (res.complete) return null;
  throw new FetchError("http", "job not in partial snapshot; cannot decide", "");
}

export function lastPathSegment(url: string): string {
  return new URL(url).pathname.split("/").filter(Boolean).pop() ?? "";
}
