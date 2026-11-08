import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { classifyRules, parseExperience } from "../src/classifier";
import type { RawJob } from "../src/types";

/**
 * The 75 hand-labelled jobs from job-radar-data.zip (data/jobs). Each was judged relevant for a
 * 0–2-year candidate ("match" or "stretch"), with a human summary of the experience asked ("exp").
 * The postings' full text isn't included, so we classify title + the stated experience + location.
 */
interface SampleJob {
  company: string;
  title: string;
  exp: string;
  location: string;
  track: "Software" | "AI-ML" | "DevOps";
  tier: "match" | "stretch";
  url: string;
}

const dir = join(__dirname, "fixtures", "sample-jobs");
const jobs: (SampleJob & { file: string })[] = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((f) => ({ file: f, ...(JSON.parse(readFileSync(join(dir, f), "utf8")) as SampleJob) }));

const TRACK = { Software: "software", "AI-ML": "ai_ml", DevOps: "devops" } as const;

/** Labels the title alone can't support; the AI step (company context) decides these. */
const TRACK_NEEDS_CONTEXT = new Set([
  "ashby-nanonets-c3715ba7.json", // "Forward Deployed Engineer" at an AI company → labelled AI-ML
  "lever-zimperium-5b35759a.json", // "AI Software Engineer (Python)" → labelled DevOps
]);

function toRaw(j: SampleJob): RawJob {
  const text = j.exp === "Not stated" ? "" : `Experience: ${j.exp}.`;
  return {
    source: "custom",
    sourceJobId: j.url,
    url: j.url,
    title: j.title,
    descriptionText: text.padEnd(250, " "),
    locations: j.location.split(/\s*[·(]\s*|\bor\b/).map((s) => s.replace(/[)]/g, "").trim()).filter(Boolean),
    detailFetched: true,
  };
}

describe("sample jobs (data/jobs)", () => {
  it("has the 75 fixtures", () => expect(jobs).toHaveLength(75));

  it.each(jobs.map((j) => [`${j.file}: ${j.title} (${j.exp})`, j] as const))("%s → in India and eligible", (_n, j) => {
    const c = classifyRules(toRaw(j), { name: j.company, kind: "product" });
    expect(c.inIndia, "inIndia").toBe(true);
    expect(c.rejectReasons, "reject reasons").toEqual([]);
    expect(c.freshersEligible).toBe(true);
  });

  it.each(jobs.filter((j) => !TRACK_NEEDS_CONTEXT.has(j.file)).map((j) => [`${j.file}: ${j.title}`, j] as const))("%s → track", (_n, j) => {
    const c = classifyRules(toRaw(j), { name: j.company, kind: "product" });
    expect(c.track).toBe(TRACK[j.track]);
  });

  it("experience phrasing from the labels", () => {
    expect(parseExperience("Experience: 1 yr min.").minYears).toBe(1);
    expect(parseExperience("Experience: 6 months min.").minYears).toBe(0);
    expect(parseExperience("Experience: Freshers–1 yr.").minYears).toBe(0);
    expect(parseExperience("Experience: 2026 graduates.").minYears).toBe(0);
    expect(parseExperience("Experience: Entry-level.").minYears).toBe(0);
    expect(parseExperience("Experience: 1–2 yrs (freshers considered).").minYears).toBe(1);
  });
});
