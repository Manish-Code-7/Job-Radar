CREATE TABLE IF NOT EXISTS "consent_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"action" text NOT NULL,
	"version" text NOT NULL,
	"purposes" text[] DEFAULT '{}'::text[] NOT NULL,
	"ip_hash" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "deletion_requests" (
	"user_id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "matches" (
	"user_id" text NOT NULL,
	"job_id" uuid NOT NULL,
	"score" real NOT NULL,
	"skill_score" real NOT NULL,
	"semantic_score" real,
	"freshness_score" real NOT NULL,
	"company_score" real NOT NULL,
	"reasons" text[] DEFAULT '{}'::text[] NOT NULL,
	"gaps" text[] DEFAULT '{}'::text[] NOT NULL,
	"dismissed_at" timestamp with time zone,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "matches_user_id_job_id_pk" PRIMARY KEY("user_id","job_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"plan" text DEFAULT 'free' NOT NULL,
	"consent_version" text,
	"consent_at" timestamp with time zone,
	"consent_withdrawn_at" timestamp with time zone,
	"skills" text[] DEFAULT '{}'::text[] NOT NULL,
	"experience_months" integer DEFAULT 0 NOT NULL,
	"education" text,
	"grad_year" integer,
	"projects" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"resume_key" text,
	"resume_uploaded_at" timestamp with time zone,
	"parsed_by" text,
	"cities" text[] DEFAULT '{}'::text[] NOT NULL,
	"remote_ok" boolean DEFAULT true NOT NULL,
	"tracks" text[] DEFAULT '{}'::text[] NOT NULL,
	"min_pay_lpa" real,
	"avoid_kinds" text[] DEFAULT '{}'::text[] NOT NULL,
	"onboarded_at" timestamp with time zone,
	"embedding" vector(384),
	"matches_computed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "matches" ADD CONSTRAINT "matches_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "consent_records_user_idx" ON "consent_records" USING btree ("user_id","at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "matches_user_score_idx" ON "matches" USING btree ("user_id","score");