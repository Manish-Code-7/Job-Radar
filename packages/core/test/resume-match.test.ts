import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { can, hardFilter, monthsInRanges, parseResumeRules, scoreMatch, type MatchJob, type MatchProfile } from "../src";

const NOW = new Date("2026-11-08T00:00:00Z");

describe("rules resume parser", () => {
  const r = parseResumeRules(readFileSync(join(__dirname, "fixtures", "resume-fresher.txt"), "utf8"), NOW);
  it("name, education, graduation year", () => {
    expect(r.name).toBe("Ananya Rao");
    expect(r.education).toMatch(/B\.Tech in Computer Science/);
    expect(r.gradYear).toBe(2025);
  });
  it("skills from every section", () => {
    for (const s of ["Java", "Python", "TypeScript", "React", "Node.js", "Spring", "PostgreSQL", "Docker", "AWS", "FastAPI", "scikit-learn"]) expect(r.skills).toContain(s);
  });
  it("'Next.js'/'Node.js' don't imply JavaScript", () => {
    expect(r.skills).not.toContain("JavaScript");
  });
  it("internships don't count as work experience", () => {
    expect(r.internshipMonths).toBe(6); // Jan–Jun 2025
    expect(r.experienceMonths).toBe(17); // Jul 2025 – Nov 2026 inclusive
  });
  it("projects with their skills", () => {
    expect(r.projects.map((p) => p.title)).toEqual(["Campus Placement Tracker", "Resume Ranker"]);
    expect(r.projects[1]!.skills).toEqual(expect.arrayContaining(["Python", "FastAPI"]));
  });
  it("date range forms", () => {
    expect(monthsInRanges("Mar 2024 - Feb 2025", NOW)).toBe(12);
    expect(monthsInRanges("06/2025 – present", NOW)).toBe(18);
    expect(monthsInRanges("Jan'24 to Dec'24", NOW)).toBe(12);
    expect(monthsInRanges("no dates here", NOW)).toBe(0);
  });
});

const profile: MatchProfile = { skills: ["Java", "Spring", "SQL", "AWS"], experienceMonths: 12, cities: ["Bengaluru"], remoteOk: true, tracks: ["software"], minPayLpa: 6, avoidKinds: ["services"] };
const job = (o: Partial<MatchJob> = {}): MatchJob => ({ title: "SDE I", skills: ["Java", "Spring", "Kafka", "AWS"], cities: ["Bengaluru"], workplace: "onsite", remoteIndia: false, track: "software", minYears: 1, salaryMaxLpa: null, companyKind: "product", firstSeenAt: NOW, ...o });

describe("matching", () => {
  it("hard filters", () => {
    expect(hardFilter(profile, job())).toBeNull();
    expect(hardFilter(profile, job({ cities: ["Pune"] }))).toBe("location");
    expect(hardFilter(profile, job({ cities: ["Pune"], workplace: "remote", remoteIndia: true }))).toBeNull(); // remote OK
    expect(hardFilter(profile, job({ minYears: 3 }))).toBe("experience"); // 3 > 1 yr + 1
    expect(hardFilter(profile, job({ minYears: 2 }))).toBeNull(); // within exp + 1
    expect(hardFilter(profile, job({ track: "qa" }))).toBe("track");
    expect(hardFilter(profile, job({ salaryMaxLpa: 4 }))).toBe("salary");
    expect(hardFilter(profile, job({ companyKind: "services" }))).toBe("company type");
  });
  it("score, reasons and gaps", () => {
    const m = scoreMatch(profile, job(), NOW);
    expect(m.skillScore).toBe(0.75); // 3 of 4 listed skills
    expect(m.reasons[0]).toBe("You know Java, Spring, AWS");
    expect(m.gaps).toEqual(["Kafka"]);
    expect(m.score).toBeGreaterThan(70);
  });
  it("a stretch ranks lower, and 2-skill jobs can't max out the skill part", () => {
    expect(scoreMatch(profile, job({ minYears: 2 }), NOW).score).toBeLessThan(scoreMatch(profile, job({ minYears: 1 }), NOW).score);
    expect(scoreMatch(profile, job({ skills: ["Java", "AWS"] }), NOW).skillScore).toBe(0.5);
  });
  it("stale and skill-poor jobs score lower", () => {
    const fresh = scoreMatch(profile, job(), NOW).score;
    const stale = scoreMatch(profile, job({ firstSeenAt: new Date(NOW.getTime() - 25 * 864e5) }), NOW).score;
    const offSkills = scoreMatch(profile, job({ skills: ["Go", "Rust", "Kubernetes"] }), NOW).score;
    expect(stale).toBeLessThan(fresh);
    expect(offSkills).toBeLessThan(stale);
  });
  it("embeddings add a semantic part", () => {
    const e = Array.from({ length: 384 }, (_, i) => Math.sin(i));
    const m = scoreMatch({ ...profile, embedding: e }, job({ embedding: e }), NOW);
    expect(m.semanticScore).toBe(1);
    expect(m.reasons).toContain("Close to your projects");
  });
  it("plans: nothing gated yet", () => {
    expect(can({ plan: "free" }, "feed")).toBe(true);
    expect(can({ plan: "free" }, "whatsapp_alerts")).toBe(true);
    expect(can(null, "feed")).toBe(false);
  });
});
