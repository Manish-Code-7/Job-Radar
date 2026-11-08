import { describe, expect, it } from "vitest";
import {
  classify,
  classifyRules,
  employmentType,
  parseExperience,
  parseLocations,
  parseSalary,
  seniorityFromTitle,
  type JobEnricher,
} from "../src/classifier";
import type { RawJob } from "../src/types";

const raw = (title: string, descriptionText = "", extra: Partial<RawJob> = {}): RawJob => ({
  source: "greenhouse",
  sourceJobId: "1",
  url: "https://job-boards.greenhouse.io/acme/jobs/1",
  title,
  descriptionText: descriptionText.padEnd(250, " "),
  locations: ["Bengaluru, Karnataka, India"],
  detailFetched: true,
  ...extra,
});
const acme = { name: "Acme", kind: "product" as const };

describe("required classifier cases", () => {
  it('"Associate Software Engineer, AI" + "3 to 6 months" → eligible, ai_ml', () => {
    const c = classifyRules(raw("Associate Software Engineer, AI", "We need 3 to 6 months of experience in Python."), acme);
    expect(c.freshersEligible).toBe(true);
    expect(c.track).toBe("ai_ml");
    expect(c.minYears).toBe(0);
    expect(c.seniority).toBe("entry");
  });

  it('"SDE II" + "3–5 years" → not eligible', () => {
    const c = classifyRules(raw("SDE II", "3–5 years of experience building services."), acme);
    expect(c.freshersEligible).toBe(false);
    expect(c.minYears).toBe(3);
  });

  it('"Software Engineer II" + "1 year minimum" → eligible', () => {
    const c = classifyRules(raw("Software Engineer II", "Experience: 1 year minimum in backend development."), acme);
    expect(c.minYears).toBe(1);
    expect(c.freshersEligible).toBe(true);
  });

  it('"Associate SDE Intern" → not eligible', () => {
    const c = classifyRules(raw("Associate SDE Intern", "Six month internship."), acme);
    expect(c.freshersEligible).toBe(false);
    expect(c.employmentType).toBe("intern");
  });

  it('"Site Reliability Engineer - India", remote, no years → eligible, seniority unknown, flagged', () => {
    const c = classifyRules(
      raw("Site Reliability Engineer - India", "Run our Kubernetes clusters and on-call.", { locations: ["Remote - India"], workplaceHint: "Remote" }),
      acme,
    );
    expect(c.freshersEligible).toBe(true);
    expect(c.seniority).toBe("unknown");
    expect(c.flags).toContain("experience not stated");
    expect(c.remoteIndia).toBe(true);
    expect(c.track).toBe("devops");
  });

  it('"₹4–6 LPA" → salaryMaxLpa 6', () => {
    expect(parseSalary("CTC: ₹4–6 LPA")).toMatchObject({ salaryMinLpa: 4, salaryMaxLpa: 6 });
  });
});

describe("experience regex", () => {
  it.each([
    ["0-2 years of experience", 0, 2],
    ["1–3 yrs experience", 1, 3],
    ["2+ years of experience in Java", 2, undefined],
    ["at least 1 year of professional experience", 1, undefined],
    ["3 to 6 months experience", 0, 0.5],
    ["minimum 2 years experience", 2, undefined],
  ])("%s", (text, min, max) => {
    const e = parseExperience(text);
    expect(e.minYears).toBe(min);
    expect(e.maxYears).toBe(max);
  });

  it("freshers", () => expect(parseExperience("Freshers are welcome to apply")).toMatchObject({ minYears: 0, fresher: true }));
  it("ignores degree durations", () => expect(parseExperience("A 4 year degree program in CS").minYears).toBeUndefined());
  it("takes the smallest requirement", () =>
    expect(parseExperience("2+ years of experience required; 5+ years of experience preferred").minYears).toBe(2));
});

describe("seniority + employment", () => {
  it.each([
    ["Senior Software Engineer", "senior"],
    ["Sr. Data Engineer", "senior"],
    ["Staff Engineer", "senior"],
    ["Engineering Manager", "senior"],
    ["Solutions Architect", "senior"],
    ["Software Engineer III", "mid"],
    ["SDE 1", "entry"],
    ["Junior Developer", "entry"],
    ["Backend Engineer", "unknown"],
  ])("%s → %s", (t, s) => expect(seniorityFromTitle(t).seniority).toBe(s));

  it.each([
    ["Graduate Trainee", "apprentice"],
    ["Software Engineer (Contract)", "contract"],
    ["Temporary Data Analyst", "temporary"],
    ["Software Engineer", "unknown"],
  ])("%s → %s", (t, e) => expect(employmentType(undefined, t)).toBe(e));
});

describe("location", () => {
  it("parses Indian cities and aliases", () => {
    expect(parseLocations(["Bangalore", "Gurgaon, Haryana"]).cities).toEqual(["Bengaluru", "Delhi NCR"]);
  });
  it("rejects foreign-only remote", () => {
    const l = parseLocations(["Remote - US"], "Remote");
    expect(l.remoteIndia).toBe(false);
    expect(l.inIndia).toBe(false);
  });
});

describe("salary", () => {
  it.each([
    ["Salary: INR 4,00,000 - 6,00,000 per annum", 4, 6],
    ["CTC 8 LPA", 8, 8],
    ["₹ 12 to 18 lakhs", 12, 18],
  ])("%s", (t, min, max) => expect(parseSalary(t)).toMatchObject({ salaryMinLpa: min, salaryMaxLpa: max }));
  it("ignores unrelated numbers", () => expect(parseSalary("We have 300 engineers in 4 offices")).toEqual({}));
});

describe("staffing", () => {
  it("rejects 'hiring for our client'", () => {
    const c = classifyRules(raw("Software Engineer", "We are hiring for our client, a leading fintech."), acme);
    expect(c.freshersEligible).toBe(false);
    expect(c.rejectReasons.join()).toMatch(/staffing/);
  });
});

describe("AI enrichment", () => {
  const ai: JobEnricher = {
    async enrich() {
      return { skills: ["Go"], track: "software", freshersEligible: true, summary: "A backend role building payment services in Go for a Bengaluru team." };
    },
  };
  it("fills gaps without overriding rules", async () => {
    const c = await classify(raw("Backend Engineer", "Build payment services."), acme, ai);
    expect(c.summary).toMatch(/payment services/);
    expect(c.skills).toContain("Go");
    expect(c.classifierVersion).toMatch(/\+ai$/);
  });
  it("is skipped for rule-rejected jobs, and invalid output is ignored", async () => {
    const bad: JobEnricher = { enrich: async () => ({ skills: [], track: "nope" as never, freshersEligible: true, summary: "x" }) };
    expect((await classify(raw("Senior Engineer"), acme, ai)).classifierVersion).toBe("rules-1");
    expect((await classify(raw("Backend Engineer"), acme, bad)).classifierVersion).toBe("rules-1");
  });
});
