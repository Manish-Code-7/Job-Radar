import type { CompanyKind, Track } from "../types";

export interface MatchProfile {
  skills: string[];
  experienceMonths: number;
  cities: string[];
  remoteOk: boolean;
  tracks: Track[];
  minPayLpa?: number | null;
  avoidKinds: CompanyKind[];
  embedding?: number[] | null;
}

export interface MatchJob {
  title: string;
  skills: string[];
  cities: string[];
  workplace: string;
  remoteIndia: boolean;
  track: Track;
  minYears?: number | null;
  salaryMaxLpa?: number | null;
  companyKind: CompanyKind;
  firstSeenAt: Date;
  postedAt?: Date | null;
  embedding?: number[] | null;
}

export interface MatchResult {
  score: number; // 0..100
  skillScore: number;
  semanticScore: number | null;
  freshnessScore: number;
  companyScore: number;
  reasons: string[];
  gaps: string[];
}

export const WEIGHTS = { skills: 0.45, semantic: 0.35, freshness: 0.1, company: 0.1 } as const;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9+#]/g, "");

/** Hard filters: returns the reason a job is excluded, or null if it passes. */
export function hardFilter(p: MatchProfile, j: MatchJob): string | null {
  const remoteFits = p.remoteOk && (j.remoteIndia || j.workplace === "remote");
  if (p.cities.length && !remoteFits && !j.cities.some((c) => p.cities.includes(c))) return "location";
  if (!p.cities.length && !p.remoteOk && j.workplace === "remote") return "remote";
  const expYears = p.experienceMonths / 12;
  if (j.minYears != null && j.minYears > expYears + 1) return "experience";
  if (p.tracks.length && !p.tracks.includes(j.track)) return "track";
  if (p.minPayLpa != null && j.salaryMaxLpa != null && j.salaryMaxLpa < p.minPayLpa) return "salary";
  if (p.avoidKinds.includes(j.companyKind)) return "company type";
  return null;
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** bge-small cosines for related texts sit roughly in 0.55–0.9; stretch that band to 0..1. */
export function semanticFromCosine(c: number): number {
  return Math.max(0, Math.min(1, (c - 0.55) / 0.35));
}

export function freshness(j: Pick<MatchJob, "firstSeenAt" | "postedAt">, now = new Date()): number {
  const t = (j.postedAt ?? j.firstSeenAt).getTime();
  const days = Math.max(0, (now.getTime() - t) / 864e5);
  if (days <= 3) return 1;
  return Math.max(0, 1 - (days - 3) / 18); // 0 at 21 days
}

export function scoreMatch(p: MatchProfile, j: MatchJob, now = new Date()): MatchResult {
  const mine = new Map(p.skills.map((s) => [norm(s), s]));
  const matched = j.skills.filter((s) => mine.has(norm(s)));
  const missing = j.skills.filter((s) => !mine.has(norm(s)));
  // No skills listed → neutral. Count overlap against at least 4 skills so a job listing only 2–3 can't max it out.
  const skillScore = j.skills.length ? Math.min(1, matched.length / Math.max(4, Math.min(j.skills.length, 8))) : 0.5;
  const semanticScore = p.embedding?.length && j.embedding?.length ? semanticFromCosine(cosine(p.embedding, j.embedding)) : null;
  const freshnessScore = freshness(j, now);
  const companyScore = j.companyKind === "services" || j.companyKind === "staffing" ? 0.3 : 1;

  // Without embeddings, the semantic weight is shared out over the other parts.
  const w = semanticScore === null ? { s: WEIGHTS.skills / 0.65, f: WEIGHTS.freshness / 0.65, c: WEIGHTS.company / 0.65, m: 0 } : { s: WEIGHTS.skills, f: WEIGHTS.freshness, c: WEIGHTS.company, m: WEIGHTS.semantic };
  const expYears = p.experienceMonths / 12;
  const stretch = j.minYears != null && j.minYears > expYears;
  // Asking for more experience than you have still shows (up to +1 yr) but ranks lower.
  const raw = (w.s * skillScore + w.m * (semanticScore ?? 0) + w.f * freshnessScore + w.c * companyScore) * (stretch ? 0.85 : 1);

  const reasons: string[] = [];
  if (matched.length) reasons.push(`You know ${matched.slice(0, 4).join(", ")}${matched.length > 4 ? ` +${matched.length - 4} more` : ""}`);
  if (j.minYears == null) reasons.push("Experience not stated");
  else if (j.minYears <= p.experienceMonths / 12) reasons.push(j.minYears === 0 ? "Open to freshers" : `Asks ${j.minYears}+ yr, you have ${(p.experienceMonths / 12).toFixed(1).replace(/\.0$/, "")}`);
  else reasons.push(`Asks ${j.minYears}+ yr: a stretch`);
  if (semanticScore !== null && semanticScore >= 0.6) reasons.push("Close to your projects");
  if (freshnessScore === 1) reasons.push("Posted in the last 3 days");

  return {
    score: Math.round(Math.max(0, Math.min(1, raw)) * 100),
    skillScore,
    semanticScore,
    freshnessScore,
    companyScore,
    reasons,
    gaps: missing.slice(0, 4),
  };
}

export function profileEmbeddingText(p: { skills: string[]; tracks: string[]; projects: { title: string; summary?: string }[]; education?: string | null }): string {
  return [
    `Skills: ${p.skills.join(", ")}`,
    p.tracks.length ? `Interested in: ${p.tracks.join(", ")}` : "",
    ...p.projects.slice(0, 5).map((x) => `Project: ${x.title}. ${x.summary ?? ""}`),
    p.education ? `Education: ${p.education}` : "",
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 1500);
}
