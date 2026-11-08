import { COMPANY_KINDS, displayBadge, TRACKS } from "@job-radar/core";
import { and, companies, consentRecords, deletionRequests, desc, eq, gt, isNull, jobs, matches, profiles, sql } from "@job-radar/db";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { enqueue } from "@/lib/boss";
import { CONSENT_PURPOSES, CONSENT_VERSION, ensureProfile } from "@/lib/profile";
import { deleteResume } from "@/lib/storage";
import { router, userProcedure } from "../trpc";

const CITIES = ["Bengaluru", "Hyderabad", "Pune", "Chennai", "Mumbai", "Delhi NCR", "Kolkata", "Ahmedabad", "Kochi", "Thiruvananthapuram", "Coimbatore", "Mysuru", "Jaipur", "Chandigarh", "Indore"] as const;

async function recompute(userId: string) {
  // No de-duplication: each save must be followed by a recompute that sees it (the job is idempotent).
  await enqueue("match:profile", { userId });
}

export const meRouter = router({
  /** Profile + onboarding state. Creates the profile row on first call. */
  get: userProcedure.query(async ({ ctx }) => {
    const p = await ensureProfile(ctx.session.user);
    const { embedding: _e, ...rest } = p;
    return { profile: rest, consentVersion: CONSENT_VERSION, consentPurposes: CONSENT_PURPOSES, cities: CITIES };
  }),

  giveConsent: userProcedure.input(z.object({ version: z.literal(CONSENT_VERSION) })).mutation(async ({ ctx }) => {
    const u = ctx.session.user;
    await ensureProfile(u);
    const now = new Date();
    await ctx.db.insert(consentRecords).values({ userId: u.id, action: "granted", version: CONSENT_VERSION, purposes: CONSENT_PURPOSES });
    await ctx.db.update(profiles).set({ consentVersion: CONSENT_VERSION, consentAt: now, consentWithdrawnAt: null, updatedAt: now }).where(eq(profiles.userId, u.id));
    return { ok: true };
  }),

  /** Save the reviewed resume data (the user can edit everything we parsed). */
  saveResumeData: userProcedure
    .input(
      z.object({
        name: z.string().max(100).optional(),
        skills: z.array(z.string().min(1).max(40)).max(40),
        experienceMonths: z.number().int().min(0).max(600),
        education: z.string().max(200).optional(),
        gradYear: z.number().int().min(1990).max(2040).nullable().optional(),
        projects: z.array(z.object({ title: z.string().min(1).max(120), summary: z.string().max(400).optional() })).max(10),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(profiles)
        .set({ name: input.name || null, skills: [...new Set(input.skills.map((s) => s.trim()).filter(Boolean))], experienceMonths: input.experienceMonths, education: input.education || null, gradYear: input.gradYear ?? null, projects: input.projects, updatedAt: new Date() })
        .where(eq(profiles.userId, ctx.session.user.id));
      await recompute(ctx.session.user.id);
      return { ok: true };
    }),

  savePreferences: userProcedure
    .input(
      z.object({
        cities: z.array(z.enum(CITIES)).max(15),
        remoteOk: z.boolean(),
        tracks: z.array(z.enum(TRACKS)).max(6),
        minPayLpa: z.number().min(0).max(100).nullable(),
        avoidKinds: z.array(z.enum(COMPANY_KINDS)).max(6),
        finishOnboarding: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const p = await ensureProfile(ctx.session.user);
      if (!p.consentAt || p.consentWithdrawnAt) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Consent is needed first" });
      const { finishOnboarding, ...prefs } = input;
      await ctx.db.update(profiles).set({ ...prefs, ...(finishOnboarding ? { onboardedAt: p.onboardedAt ?? new Date() } : {}), updatedAt: new Date() }).where(eq(profiles.userId, p.userId));
      await recompute(p.userId);
      return { ok: true };
    }),

  /** Matched jobs. Only jobs verified open in the last 72h are shown; the badge says how fresh the check is. */
  feed: userProcedure
    .input(
      z.object({
        track: z.enum(TRACKS).optional(),
        city: z.string().max(40).optional(),
        remoteOnly: z.boolean().optional(),
        sort: z.enum(["best", "newest"]).default("best"),
        limit: z.number().int().min(1).max(100).default(30),
      }),
    )
    .query(async ({ ctx, input }) => {
      const p = await ensureProfile(ctx.session.user);
      const rows = await ctx.db
        .select({
          jobId: jobs.id,
          title: jobs.title,
          company: companies.name,
          companyKind: companies.kind,
          summary: jobs.summary,
          cities: jobs.cities,
          workplace: jobs.workplace,
          remoteIndia: jobs.remoteIndia,
          track: jobs.track,
          skills: jobs.skills,
          minYears: jobs.minYears,
          maxYears: jobs.maxYears,
          salaryText: jobs.salaryText,
          status: jobs.status,
          lastVerifiedAt: jobs.lastVerifiedAt,
          firstSeenAt: jobs.firstSeenAt,
          flags: jobs.flags,
          classifierVersion: jobs.classifierVersion,
          score: matches.score,
          reasons: matches.reasons,
          gaps: matches.gaps,
        })
        .from(matches)
        .innerJoin(jobs, eq(jobs.id, matches.jobId))
        .innerJoin(companies, eq(companies.id, jobs.companyId))
        .where(
          and(
            eq(matches.userId, p.userId),
            isNull(matches.dismissedAt),
            eq(jobs.status, "open"),
            eq(jobs.hiddenByReports, false),
            gt(jobs.lastVerifiedAt, sql`now() - interval '72 hours'`),
            input.track ? eq(jobs.track, input.track) : undefined,
            input.city ? sql`${input.city} = any(${jobs.cities})` : undefined,
            input.remoteOnly ? sql`(${jobs.remoteIndia} or ${jobs.workplace} = 'remote')` : undefined,
          ),
        )
        .orderBy(input.sort === "newest" ? desc(jobs.firstSeenAt) : desc(matches.score))
        .limit(input.limit);
      const mine = new Set(p.skills.map((s) => s.toLowerCase()));
      return {
        computedAt: p.matchesComputedAt,
        profileUpdatedAt: p.updatedAt,
        upToDate: !!p.matchesProfileVersion && p.matchesProfileVersion.getTime() >= p.updatedAt.getTime(),
        jobs: rows.map((r) => ({ ...r, badge: displayBadge(r.status, r.lastVerifiedAt), matchedSkills: r.skills.filter((s) => mine.has(s.toLowerCase())) })),
      };
    }),

  dismiss: userProcedure.input(z.object({ jobId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    await ctx.db.update(matches).set({ dismissedAt: new Date() }).where(and(eq(matches.userId, ctx.session.user.id), eq(matches.jobId, input.jobId)));
    return { ok: true };
  }),

  refreshMatches: userProcedure.mutation(async ({ ctx }) => {
    await recompute(ctx.session.user.id);
    return { queued: true };
  }),

  /** Withdraw consent: stop processing, delete resume + derived data and matches. The account stays. */
  withdrawConsent: userProcedure.mutation(async ({ ctx }) => {
    const p = await ensureProfile(ctx.session.user);
    if (p.resumeKey) await deleteResume(p.resumeKey).catch(() => {});
    await ctx.db.delete(matches).where(eq(matches.userId, p.userId));
    await ctx.db.insert(consentRecords).values({ userId: p.userId, action: "withdrawn", version: p.consentVersion ?? CONSENT_VERSION });
    await ctx.db
      .update(profiles)
      .set({ consentWithdrawnAt: new Date(), resumeKey: null, resumeUploadedAt: null, skills: [], projects: [], education: null, gradYear: null, experienceMonths: 0, embedding: null, onboardedAt: null, matchesComputedAt: null, updatedAt: new Date() })
      .where(eq(profiles.userId, p.userId));
    return { ok: true };
  }),

  /** Delete account: our data now (resume, profile, matches); the Neon Auth identity within 7 days. */
  deleteAccount: userProcedure.input(z.object({ confirm: z.literal("DELETE") })).mutation(async ({ ctx }) => {
    const u = ctx.session.user;
    const [p] = await ctx.db.select().from(profiles).where(eq(profiles.userId, u.id));
    if (p?.resumeKey) await deleteResume(p.resumeKey).catch(() => {});
    await ctx.db.delete(matches).where(eq(matches.userId, u.id));
    await ctx.db.delete(profiles).where(eq(profiles.userId, u.id));
    await ctx.db.insert(deletionRequests).values({ userId: u.id, email: u.email }).onConflictDoNothing();
    await enqueue("maintenance:daily", {}, { singletonKey: "maintenance-now", singletonSeconds: 60 } as never);
    return { ok: true };
  }),
});
