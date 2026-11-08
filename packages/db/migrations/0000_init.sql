CREATE TYPE "public"."ats" AS ENUM('lever', 'greenhouse', 'ashby', 'smartrecruiters', 'workable', 'recruitee', 'workday', 'icims', 'successfactors', 'oracle', 'phenom', 'keka', 'kula', 'darwinbox', 'zoho', 'freshteam', 'amazon', 'google', 'custom', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."company_kind" AS ENUM('product', 'gcc', 'startup', 'mnc', 'services', 'staffing');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('pending', 'open', 'changed', 'unknown', 'closed', 'archived');--> statement-breakpoint
CREATE TYPE "public"."provider" AS ENUM('firecrawl', 'apify', 'gemini', 'jina');--> statement-breakpoint
CREATE TYPE "public"."crawl_tier" AS ENUM('api', 'browser');--> statement-breakpoint
CREATE TYPE "public"."track" AS ENUM('software', 'ai_ml', 'devops', 'data', 'qa', 'other');--> statement-breakpoint
CREATE TYPE "public"."verdict" AS ENUM('open', 'closed', 'changed', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."check_worker" AS ENUM('oracle', 'gha', 'fallback');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ats_policy" (
	"ats" "ats" PRIMARY KEY NOT NULL,
	"require_s3" boolean DEFAULT false NOT NULL,
	"false_open_rate" real,
	"sample_size" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"domain" text,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"extra_domains" text[] DEFAULT '{}'::text[] NOT NULL,
	"cities" text[] DEFAULT '{}'::text[] NOT NULL,
	"kind" "company_kind" DEFAULT 'product' NOT NULL,
	"ats" "ats" DEFAULT 'unknown' NOT NULL,
	"ats_slug" text,
	"careers_url" text,
	"tier" "crawl_tier" DEFAULT 'api' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"excluded" boolean DEFAULT false NOT NULL,
	"excluded_reason" text,
	"priority" integer DEFAULT 2 NOT NULL,
	"crawl_hour" integer DEFAULT 3 NOT NULL,
	"last_crawled_at" timestamp with time zone,
	"last_crawl_status" text,
	"last_crawl_error" text,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"blocked_until" timestamp with time zone,
	"last_full_snapshot_at" timestamp with time zone,
	"last_apify_full_at" timestamp with time zone,
	"detect_confidence" real,
	"seed_meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "crawl_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text DEFAULT 'running' NOT NULL,
	"adapter" "ats",
	"via" text,
	"worker" "check_worker" DEFAULT 'oracle' NOT NULL,
	"shard" integer,
	"complete" boolean,
	"jobs_found" integer,
	"jobs_new" integer,
	"jobs_closed" integer,
	"error" text,
	"provider_units" jsonb,
	"dry_run" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "domain_state" (
	"domain" text PRIMARY KEY NOT NULL,
	"last_request_at" timestamp with time zone,
	"consecutive_errors" integer DEFAULT 0 NOT NULL,
	"blocked_until" timestamp with time zone,
	"robots_txt" text,
	"robots_fetched_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "job_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"signals" jsonb NOT NULL,
	"verdict" "verdict" NOT NULL,
	"reason" text,
	"closed_observation" jsonb,
	"attempts" jsonb,
	"latency_ms" integer,
	"worker" "check_worker" NOT NULL,
	"provider_units" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "job_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"reporter_key" text NOT NULL,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"source" "ats" NOT NULL,
	"source_job_id" text NOT NULL,
	"url" text NOT NULL,
	"apply_url" text,
	"title" text NOT NULL,
	"normalized_title" text NOT NULL,
	"summary" text,
	"description_hash" text,
	"locations" text[] DEFAULT '{}'::text[] NOT NULL,
	"cities" text[] DEFAULT '{}'::text[] NOT NULL,
	"workplace" text DEFAULT 'unknown' NOT NULL,
	"remote_india" boolean DEFAULT false NOT NULL,
	"employment_type" text DEFAULT 'unknown' NOT NULL,
	"min_years" real,
	"max_years" real,
	"exp_text" text,
	"seniority" text DEFAULT 'unknown' NOT NULL,
	"track" "track" DEFAULT 'other' NOT NULL,
	"skills" text[] DEFAULT '{}'::text[] NOT NULL,
	"salary_min_lpa" real,
	"salary_max_lpa" real,
	"salary_text" text,
	"freshers_eligible" boolean DEFAULT false NOT NULL,
	"reject_reasons" text[] DEFAULT '{}'::text[] NOT NULL,
	"flags" text[] DEFAULT '{}'::text[] NOT NULL,
	"classifier_version" text,
	"posted_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_verified_at" timestamp with time zone,
	"status" "job_status" DEFAULT 'pending' NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_reason" text,
	"check_failures" integer DEFAULT 0 NOT NULL,
	"user_reports_24h" integer DEFAULT 0 NOT NULL,
	"hidden_by_reports" boolean DEFAULT false NOT NULL,
	"shown_at" timestamp with time zone,
	"embedding" vector(384),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "provider_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" "provider" NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"units" real NOT NULL,
	"task" text NOT NULL,
	"job_id" uuid,
	"company_id" uuid,
	"url" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "raw_payloads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"crawl_run_id" uuid,
	"job_id" uuid,
	"url" text,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone DEFAULT now() + interval '30 days' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "source_policy" (
	"source" "ats" PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"robots_reviewed_at" timestamp with time zone,
	"terms_note" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "takedown_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"company_id" uuid,
	"requester_name" text NOT NULL,
	"requester_email" text NOT NULL,
	"scope" text NOT NULL,
	"job_url" text,
	"message" text,
	"status" text DEFAULT 'new' NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" text,
	"note" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"plan" text DEFAULT 'free' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "verification_audits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"ats" "ats" NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"status_before" "job_status" NOT NULL,
	"outcome" text NOT NULL,
	"false_open" boolean NOT NULL,
	"detail" text,
	"final_url" text
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "crawl_runs" ADD CONSTRAINT "crawl_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_checks" ADD CONSTRAINT "job_checks_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_reports" ADD CONSTRAINT "job_reports_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "jobs" ADD CONSTRAINT "jobs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "provider_usage" ADD CONSTRAINT "provider_usage_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "provider_usage" ADD CONSTRAINT "provider_usage_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "raw_payloads" ADD CONSTRAINT "raw_payloads_crawl_run_id_crawl_runs_id_fk" FOREIGN KEY ("crawl_run_id") REFERENCES "public"."crawl_runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "raw_payloads" ADD CONSTRAINT "raw_payloads_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "takedown_requests" ADD CONSTRAINT "takedown_requests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "verification_audits" ADD CONSTRAINT "verification_audits_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "companies_name_uq" ON "companies" USING btree ("name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "companies_ats_idx" ON "companies" USING btree ("ats");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "crawl_runs_company_idx" ON "crawl_runs" USING btree ("company_id","started_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_checks_job_idx" ON "job_checks" USING btree ("job_id","at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_reports_job_idx" ON "job_reports" USING btree ("job_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "jobs_url_uq" ON "jobs" USING btree ("url");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "jobs_source_id_uq" ON "jobs" USING btree ("company_id","source","source_job_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jobs_status_idx" ON "jobs" USING btree ("status","freshers_eligible");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jobs_company_idx" ON "jobs" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jobs_verified_idx" ON "jobs" USING btree ("last_verified_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "provider_usage_idx" ON "provider_usage" USING btree ("provider","at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "raw_payloads_expires_idx" ON "raw_payloads" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "verification_audits_ats_idx" ON "verification_audits" USING btree ("ats","at");