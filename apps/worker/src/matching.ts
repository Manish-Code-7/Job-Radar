import { hardFilter, profileEmbeddingText, scoreMatch, type CompanyKind, type MatchJob, type MatchProfile, type Track } from "@job-radar/core";
import { and, companies, eq, gt, inArray, isNotNull, isNull, jobs, matches, not, profiles, sql } from "@job-radar/db";
import type { Deps } from "./deps";
import { info } from "./log";

const KEEP_TOP = 200;
const MIN_SCORE = 15; // low enough that thin profiles still see their closest jobs (ranked low)

/** Recompute one user's matches against every verified-open, eligible job. */
export async function recomputeProfile(deps: Deps, userId: string) {
  const [p] = await deps.db.select().from(profiles).where(eq(profiles.userId, userId));
  if (!p) return { skipped: "no profile" };
  if (!p.consentAt || p.consentWithdrawnAt) {
    await deps.db.delete(matches).where(eq(matches.userId, userId));
    return { skipped: "no consent" };
  }

  // Local embedding of the profile (bge-small, CPU). Nothing leaves the server.
  let embedding = p.embedding ?? null;
  const vec = await deps.embed([profileEmbeddingText({ skills: p.skills, tracks: p.tracks, projects: p.projects, education: p.education })]).catch(() => null);
  if (vec?.[0]) {
    embedding = vec[0];
    await deps.db.update(profiles).set({ embedding }).where(eq(profiles.userId, userId));
  }

  const rows = await deps.db
    .select({
      id: jobs.id,
      title: jobs.title,
      skills: jobs.skills,
      cities: jobs.cities,
      workplace: jobs.workplace,
      remoteIndia: jobs.remoteIndia,
      track: jobs.track,
      minYears: jobs.minYears,
      salaryMaxLpa: jobs.salaryMaxLpa,
      firstSeenAt: jobs.firstSeenAt,
      postedAt: jobs.postedAt,
      embedding: jobs.embedding,
      kind: companies.kind,
    })
    .from(jobs)
    .innerJoin(companies, eq(companies.id, jobs.companyId))
    .where(and(eq(jobs.status, "open"), eq(jobs.freshersEligible, true), eq(jobs.hiddenByReports, false), gt(jobs.lastVerifiedAt, sql`now() - interval '72 hours'`)));

  const prof: MatchProfile = {
    skills: p.skills,
    experienceMonths: p.experienceMonths,
    cities: p.cities,
    remoteOk: p.remoteOk,
    tracks: p.tracks as Track[],
    minPayLpa: p.minPayLpa,
    avoidKinds: p.avoidKinds as CompanyKind[],
    embedding,
  };
  const scored = rows
    .map((r) => {
      const j: MatchJob = { ...r, companyKind: r.kind, embedding: r.embedding ?? null };
      return hardFilter(prof, j) ? null : { jobId: r.id, ...scoreMatch(prof, j) };
    })
    .filter((x): x is NonNullable<typeof x> => !!x && x.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, KEEP_TOP);

  const now = new Date();
  await deps.db.transaction(async (tx) => {
    // Keep dismissed rows so a dismissed job never comes back; replace everything else.
    await tx.delete(matches).where(and(eq(matches.userId, userId), isNull(matches.dismissedAt), scored.length ? not(inArray(matches.jobId, scored.map((s) => s.jobId))) : sql`true`));
    for (const s of scored) {
      const v = { score: s.score, skillScore: s.skillScore, semanticScore: s.semanticScore, freshnessScore: s.freshnessScore, companyScore: s.companyScore, reasons: s.reasons, gaps: s.gaps, computedAt: now };
      await tx.insert(matches).values({ userId, jobId: s.jobId, ...v }).onConflictDoUpdate({ target: [matches.userId, matches.jobId], set: v });
    }
    await tx.update(profiles).set({ matchesComputedAt: now, matchesProfileVersion: p.updatedAt }).where(eq(profiles.userId, userId));
  });
  info("match:profile", { userId, candidates: rows.length, kept: scored.length });
  return { candidates: rows.length, kept: scored.length };
}

/** After crawls: refresh every onboarded user with consent. */
export async function recomputeAll(deps: Deps) {
  const users = await deps.db.select({ id: profiles.userId }).from(profiles).where(and(isNotNull(profiles.onboardedAt), isNotNull(profiles.consentAt), isNull(profiles.consentWithdrawnAt)));
  for (const u of users) await recomputeProfile(deps, u.id);
  return { users: users.length };
}
