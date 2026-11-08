import { ATS_VALUES, COMPANY_KINDS, JOB_STATUSES, TRACKS } from "@job-radar/core/types";
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

export const atsEnum = pgEnum("ats", ATS_VALUES);
export const companyKindEnum = pgEnum("company_kind", COMPANY_KINDS);
export const trackEnum = pgEnum("track", TRACKS);
export const jobStatusEnum = pgEnum("job_status", JOB_STATUSES);
export const tierEnum = pgEnum("crawl_tier", ["api", "browser"]);
export const verdictEnum = pgEnum("verdict", ["open", "closed", "changed", "unknown"]);
export const workerEnum = pgEnum("check_worker", ["oracle", "gha", "fallback"]);
export const providerEnum = pgEnum("provider", ["firecrawl", "apify", "gemini", "jina", "ai_gateway"]);

const ts = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => ts("created_at").notNull().defaultNow();

/* -------------------------------- companies -------------------------------- */
export const companies = pgTable(
  "companies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    domain: text("domain"),
    aliases: text("aliases").array().notNull().default(sql`'{}'::text[]`),
    /** Extra hosts allowed for this company's job URLs (S4 allowlist), beyond `domain` and ATS hosts. */
    extraDomains: text("extra_domains").array().notNull().default(sql`'{}'::text[]`),
    cities: text("cities").array().notNull().default(sql`'{}'::text[]`),
    kind: companyKindEnum("kind").notNull().default("product"),
    ats: atsEnum("ats").notNull().default("unknown"),
    atsSlug: text("ats_slug"),
    careersUrl: text("careers_url"),
    tier: tierEnum("tier").notNull().default("api"),
    active: boolean("active").notNull().default(true),
    excluded: boolean("excluded").notNull().default(false),
    excludedReason: text("excluded_reason"),
    priority: integer("priority").notNull().default(2), // 1 = highest
    /** Hour of day (IST, 0–23) when this company's daily crawl runs: spreads Workday tenants across the day. */
    crawlHour: integer("crawl_hour").notNull().default(3),
    lastCrawledAt: ts("last_crawled_at"),
    lastCrawlStatus: text("last_crawl_status"),
    lastCrawlError: text("last_crawl_error"),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    blockedUntil: ts("blocked_until"),
    lastFullSnapshotAt: ts("last_full_snapshot_at"),
    lastApifyFullAt: ts("last_apify_full_at"),
    detectConfidence: real("detect_confidence"),
    seedMeta: jsonb("seed_meta"),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("companies_name_uq").on(t.name), index("companies_ats_idx").on(t.ats)],
);

/* ----------------------------------- jobs ----------------------------------- */
export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    source: atsEnum("source").notNull(),
    sourceJobId: text("source_job_id").notNull(),
    url: text("url").notNull(),
    applyUrl: text("apply_url"),
    title: text("title").notNull(),
    normalizedTitle: text("normalized_title").notNull(),
    summary: text("summary"), // ≤ 600 chars, our own words
    descriptionHash: text("description_hash"),
    locations: text("locations").array().notNull().default(sql`'{}'::text[]`),
    cities: text("cities").array().notNull().default(sql`'{}'::text[]`),
    workplace: text("workplace").notNull().default("unknown"),
    remoteIndia: boolean("remote_india").notNull().default(false),
    employmentType: text("employment_type").notNull().default("unknown"),
    minYears: real("min_years"),
    maxYears: real("max_years"),
    expText: text("exp_text"),
    seniority: text("seniority").notNull().default("unknown"),
    track: trackEnum("track").notNull().default("other"),
    skills: text("skills").array().notNull().default(sql`'{}'::text[]`),
    salaryMinLpa: real("salary_min_lpa"),
    salaryMaxLpa: real("salary_max_lpa"),
    salaryText: text("salary_text"),
    freshersEligible: boolean("freshers_eligible").notNull().default(false),
    rejectReasons: text("reject_reasons").array().notNull().default(sql`'{}'::text[]`),
    flags: text("flags").array().notNull().default(sql`'{}'::text[]`),
    classifierVersion: text("classifier_version"),
    postedAt: ts("posted_at"),
    firstSeenAt: ts("first_seen_at").notNull().defaultNow(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
    lastVerifiedAt: ts("last_verified_at"),
    status: jobStatusEnum("status").notNull().default("pending"),
    closedAt: ts("closed_at"),
    closedReason: text("closed_reason"),
    checkFailures: integer("check_failures").notNull().default(0),
    userReports24h: integer("user_reports_24h").notNull().default(0),
    hiddenByReports: boolean("hidden_by_reports").notNull().default(false),
    /** Job has been shown to at least one user (raises its verification priority). */
    shownAt: ts("shown_at"),
    embedding: vector("embedding", { dimensions: 384 }),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("jobs_url_uq").on(t.url),
    uniqueIndex("jobs_source_id_uq").on(t.companyId, t.source, t.sourceJobId),
    index("jobs_status_idx").on(t.status, t.freshersEligible),
    index("jobs_company_idx").on(t.companyId),
    index("jobs_verified_idx").on(t.lastVerifiedAt),
  ],
);

/* -------------------------------- job_checks -------------------------------- */
export const jobChecks = pgTable(
  "job_checks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    at: ts("at").notNull().defaultNow(),
    kind: text("kind").notNull(), // company | on-click | user-report | audit | manual
    signals: jsonb("signals").notNull(),
    verdict: verdictEnum("verdict").notNull(),
    reason: text("reason"),
    /** Set when this check saw the page as closed — used to confirm closure ≥6h later. */
    closedObservation: jsonb("closed_observation"),
    attempts: jsonb("attempts"),
    latencyMs: integer("latency_ms"),
    worker: workerEnum("worker").notNull(),
    providerUnits: jsonb("provider_units"), // [{provider, units}]
  },
  (t) => [index("job_checks_job_idx").on(t.jobId, t.at)],
);

/* -------------------------------- crawl_runs -------------------------------- */
export const crawlRuns = pgTable(
  "crawl_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    startedAt: ts("started_at").notNull().defaultNow(),
    finishedAt: ts("finished_at"),
    status: text("status").notNull().default("running"), // running | ok | failed | blocked | skipped
    adapter: atsEnum("adapter"),
    via: text("via"), // own-http | own-playwright | apify | firecrawl
    worker: workerEnum("worker").notNull().default("oracle"),
    shard: integer("shard"),
    complete: boolean("complete"),
    jobsFound: integer("jobs_found"),
    jobsNew: integer("jobs_new"),
    jobsClosed: integer("jobs_closed"),
    error: text("error"),
    providerUnits: jsonb("provider_units"),
    dryRun: boolean("dry_run").notNull().default(false),
  },
  (t) => [index("crawl_runs_company_idx").on(t.companyId, t.startedAt)],
);

/* -------------------------------- raw_payloads (30-day TTL) -------------------------------- */
export const rawPayloads = pgTable(
  "raw_payloads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    crawlRunId: uuid("crawl_run_id").references(() => crawlRuns.id, { onDelete: "cascade" }),
    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "cascade" }),
    url: text("url"),
    payload: jsonb("payload").notNull(),
    createdAt: createdAt(),
    expiresAt: ts("expires_at").notNull().default(sql`now() + interval '30 days'`),
  },
  (t) => [index("raw_payloads_expires_idx").on(t.expiresAt)],
);

/* -------------------------------- verification_audits -------------------------------- */
export const verificationAudits = pgTable(
  "verification_audits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    ats: atsEnum("ats").notNull(),
    at: ts("at").notNull().defaultNow(),
    statusBefore: jobStatusEnum("status_before").notNull(),
    outcome: text("outcome").notNull(), // form | login | external_ats | closed | no_button | error
    falseOpen: boolean("false_open").notNull(),
    detail: text("detail"),
    finalUrl: text("final_url"),
  },
  (t) => [index("verification_audits_ats_idx").on(t.ats, t.at)],
);

/** Per-ATS policy derived from audits: when the false-open rate exceeds 5%, S3 becomes mandatory. */
export const atsPolicy = pgTable("ats_policy", {
  ats: atsEnum("ats").primaryKey(),
  requireS3: boolean("require_s3").notNull().default(false),
  falseOpenRate: real("false_open_rate"),
  sampleSize: integer("sample_size"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/* -------------------------------- domain_state -------------------------------- */
export const domainState = pgTable("domain_state", {
  domain: text("domain").primaryKey(),
  lastRequestAt: ts("last_request_at"),
  consecutiveErrors: integer("consecutive_errors").notNull().default(0),
  blockedUntil: ts("blocked_until"),
  robotsTxt: text("robots_txt"),
  robotsFetchedAt: ts("robots_fetched_at"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/* -------------------------------- provider_usage (budget ledger) -------------------------------- */
export const providerUsage = pgTable(
  "provider_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: providerEnum("provider").notNull(),
    at: ts("at").notNull().defaultNow(),
    units: real("units").notNull(), // firecrawl: credits, apify: USD, gemini: requests
    task: text("task").notNull(),
    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
    url: text("url"),
  },
  (t) => [index("provider_usage_idx").on(t.provider, t.at)],
);

/* -------------------------------- source_policy -------------------------------- */
/** On/off switch per source, set after reviewing its robots.txt/terms. */
export const sourcePolicy = pgTable("source_policy", {
  source: atsEnum("source").primaryKey(),
  enabled: boolean("enabled").notNull().default(false),
  robotsReviewedAt: ts("robots_reviewed_at"),
  termsNote: text("terms_note"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/* -------------------------------- AI cache (public job text only) -------------------------------- */
export const aiCache = pgTable("ai_cache", {
  key: text("key").primaryKey(), // `${model}:${descriptionHash}`
  value: jsonb("value").notNull(),
  createdAt: createdAt(),
});

/* -------------------------------- user reports + takedowns -------------------------------- */
export const jobReports = pgTable(
  "job_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    at: ts("at").notNull().defaultNow(),
    reporterKey: text("reporter_key").notNull(), // user id or hashed IP
    reason: text("reason"),
  },
  (t) => [index("job_reports_job_idx").on(t.jobId, t.at)],
);

export const takedownRequests = pgTable("takedown_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  at: ts("at").notNull().defaultNow(),
  companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
  requesterName: text("requester_name").notNull(),
  requesterEmail: text("requester_email").notNull(),
  scope: text("scope").notNull(), // company | job
  jobUrl: text("job_url"),
  message: text("message"),
  status: text("status").notNull().default("new"), // new | actioned | rejected
  resolvedAt: ts("resolved_at"),
  resolvedBy: text("resolved_by"),
  note: text("note"),
});

/* Users and sessions live in Neon Auth's `neon_auth` schema (Managed Better Auth), not here. */

/* -------------------------------- Phase 2: users, profiles, matching -------------------------------- */
/** One row per Neon Auth user (`neon_auth.user.id`). Resume-derived fields are editable by the user. */
export const profiles = pgTable("profiles", {
  userId: text("user_id").primaryKey(),
  email: text("email").notNull(),
  name: text("name"),
  plan: text("plan").notNull().default("free"),
  // Consent (DPDP): current state; history lives in consent_records.
  consentVersion: text("consent_version"),
  consentAt: ts("consent_at"),
  consentWithdrawnAt: ts("consent_withdrawn_at"),
  // From the resume (reviewed by the user).
  skills: text("skills").array().notNull().default(sql`'{}'::text[]`),
  experienceMonths: integer("experience_months").notNull().default(0),
  education: text("education"),
  gradYear: integer("grad_year"),
  projects: jsonb("projects").$type<{ title: string; summary?: string; skills?: string[] }[]>().notNull().default(sql`'[]'::jsonb`),
  resumeKey: text("resume_key"), // R2 object key of the encrypted PDF
  resumeUploadedAt: ts("resume_uploaded_at"),
  parsedBy: text("parsed_by"), // "ollama" | "rules"
  // Preferences.
  cities: text("cities").array().notNull().default(sql`'{}'::text[]`),
  remoteOk: boolean("remote_ok").notNull().default(true),
  tracks: text("tracks").array().notNull().default(sql`'{}'::text[]`),
  minPayLpa: real("min_pay_lpa"),
  avoidKinds: text("avoid_kinds").array().notNull().default(sql`'{}'::text[]`),
  onboardedAt: ts("onboarded_at"),
  embedding: vector("embedding", { dimensions: 384 }),
  matchesComputedAt: ts("matches_computed_at"),
  createdAt: createdAt(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const consentRecords = pgTable(
  "consent_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    at: ts("at").notNull().defaultNow(),
    action: text("action").notNull(), // granted | withdrawn
    version: text("version").notNull(),
    purposes: text("purposes").array().notNull().default(sql`'{}'::text[]`),
    ipHash: text("ip_hash"),
  },
  (t) => [index("consent_records_user_idx").on(t.userId, t.at)],
);

export const matches = pgTable(
  "matches",
  {
    userId: text("user_id").notNull(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    score: real("score").notNull(),
    skillScore: real("skill_score").notNull(),
    semanticScore: real("semantic_score"),
    freshnessScore: real("freshness_score").notNull(),
    companyScore: real("company_score").notNull(),
    reasons: text("reasons").array().notNull().default(sql`'{}'::text[]`),
    gaps: text("gaps").array().notNull().default(sql`'{}'::text[]`),
    dismissedAt: ts("dismissed_at"),
    computedAt: ts("computed_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.jobId] }), index("matches_user_score_idx").on(t.userId, t.score)],
);

/** Account deletions: our data is removed immediately; the Neon Auth user is purged by maintenance (≤ 7 days). */
export const deletionRequests = pgTable("deletion_requests", {
  userId: text("user_id").primaryKey(),
  email: text("email").notNull(),
  requestedAt: ts("requested_at").notNull().defaultNow(),
  completedAt: ts("completed_at"),
});
