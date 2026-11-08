import { skillsFromText } from "../classifier/rules";
import { normalizeWs } from "../text";

/** What we extract from a resume. The user reviews and edits all of it before it's used. */
export interface ParsedResume {
  name?: string;
  skills: string[];
  experienceMonths: number;
  internshipMonths: number;
  education?: string;
  gradYear?: number;
  projects: { title: string; summary?: string; skills?: string[] }[];
}

const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
const MON = String.raw`(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?`;
const DATE = String.raw`(?:${MON}\s*[' ]?\s*(\d{2,4})|(\d{1,2})\s*/\s*(\d{4})|(\d{4}))`;
const RANGE = new RegExp(`${DATE}\\s*(?:-|–|—|to)\\s*(?:(present|current|now|till date|ongoing)|${DATE})`, "gi");

function ym(mon: string | undefined, year: string | undefined, num: string | undefined, numYear: string | undefined, bareYear: string | undefined): number | null {
  if (mon && year) {
    const y = year.length === 2 ? 2000 + Number(year) : Number(year);
    return y * 12 + (MONTHS[mon.toLowerCase().slice(0, 4).replace(/t$/, "")] ?? MONTHS[mon.toLowerCase().slice(0, 3)] ?? 0);
  }
  if (num && numYear) return Number(numYear) * 12 + Number(num) - 1;
  if (bareYear) return Number(bareYear) * 12;
  return null;
}

const SECTION = /^\s*(experience|work experience|professional experience|employment|internships?|projects?|academic projects|personal projects|education|skills|technical skills|certifications?|achievements|awards|publications|extra[- ]curricular|summary|profile|objective)\s*:?\s*$/i;

function sections(text: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  let current = "header";
  out.set(current, []);
  for (const raw of text.split(/\r?\n/)) {
    const line = normalizeWs(raw);
    if (!line) continue;
    const m = line.match(SECTION);
    if (m) {
      const k = m[1]!.toLowerCase();
      current = /intern/.test(k) ? "internships" : /experience|employment/.test(k) ? "experience" : /project/.test(k) ? "projects" : /education/.test(k) ? "education" : /skill/.test(k) ? "skills" : k;
      if (!out.has(current)) out.set(current, []);
      continue;
    }
    out.get(current)!.push(line);
  }
  return out;
}

/** Sum non-overlapping months covered by date ranges in a block of text. */
export function monthsInRanges(block: string, now = new Date()): number {
  const covered = new Set<number>();
  const nowYm = now.getFullYear() * 12 + now.getMonth();
  for (const m of block.matchAll(RANGE)) {
    const start = ym(m[1], m[2], m[3], m[4], m[5]);
    const end = m[6] ? nowYm : ym(m[7], m[8], m[9], m[10], m[11]);
    if (start === null || end === null || end < start || end - start > 600) continue;
    for (let i = start; i <= Math.min(end, nowYm); i++) covered.add(i);
  }
  return covered.size;
}

const DEGREE =
  /\b(b\.?\s?tech|b\.?\s?e\.?|bachelor of (technology|engineering|science|computer applications)|b\.?\s?sc|bca|m\.?\s?tech|m\.?\s?e\.?|mca|m\.?\s?sc|master of [a-z ]+|b\.?\s?com|bba|mba|diploma)\b[^\n,;|]{0,80}/i;

/** Rules-only resume parser (no AI, nothing leaves the server). */
export function parseResumeRules(text: string, now = new Date()): ParsedResume {
  const secs = sections(text);
  const all = text;
  const block = (k: string) => (secs.get(k) ?? []).join("\n");

  const skills = skillsFromText([block("skills"), block("projects"), block("experience"), block("internships"), all].join("\n"), 25);

  const edu = block("education") || all;
  const degree = edu.match(DEGREE)?.[0];
  const years = [...edu.matchAll(/\b(20[0-4]\d)\b/g)].map((m) => Number(m[1]));
  const gradHint = edu.match(/(?:graduat\w*|class of|batch|expected|passing|pass[- ]?out)\D{0,20}(20[0-4]\d)/i)?.[1];
  const gradYear = gradHint ? Number(gradHint) : years.length ? Math.max(...years) : undefined;

  // Work experience vs internships: internships are reported separately and don't count as experience.
  const expBlock = block("experience");
  const internLines = expBlock.split("\n").filter((l) => /\bintern(ship)?\b/i.test(l));
  const internshipMonths = monthsInRanges([block("internships"), ...internLines].join("\n"), now);
  const workOnly = expBlock
    .split("\n")
    .filter((l) => !/\bintern(ship)?\b/i.test(l))
    .join("\n");
  const experienceMonths = monthsInRanges(workOnly, now);

  const projects: ParsedResume["projects"] = [];
  let cur: ParsedResume["projects"][number] | null = null;
  for (const line of secs.get("projects") ?? []) {
    const bullet = /^[•\-*–·]/.test(line);
    if (!bullet && line.length <= 90) {
      cur = { title: line.replace(/\s*[|–-]\s*(github|link|demo).*$/i, "") };
      projects.push(cur);
    } else if (cur) {
      cur.summary = normalizeWs(`${cur.summary ?? ""} ${line.replace(/^[•\-*–·]\s*/, "")}`).slice(0, 300);
    }
  }
  for (const p of projects) p.skills = skillsFromText(`${p.title} ${p.summary ?? ""}`, 8);

  const first = (secs.get("header") ?? [])[0];
  const name = first && /^[A-Za-z][A-Za-z .'-]{2,60}$/.test(first) && first.split(" ").length <= 5 ? first : undefined;

  return { name, skills, experienceMonths, internshipMonths, education: degree ? normalizeWs(degree) : undefined, gradYear, projects: projects.slice(0, 8) };
}
