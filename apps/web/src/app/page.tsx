import { BadgeCheck, FileText, Radar } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

async function stats() {
  try {
    const { db } = await import("@/lib/db");
    const { sql } = await import("@job-radar/db");
    const r = await db.execute(sql`select
      (select count(*)::int from jobs where status = 'open' and freshers_eligible and last_verified_at > now() - interval '36 hours') as jobs,
      (select count(*)::int from companies where active and not excluded) as companies`);
    return r.rows[0] as { jobs: number; companies: number };
  } catch {
    return null;
  }
}

const STEPS = [
  { icon: Radar, title: "We read company career pages", body: "Only the hiring company's own site: never job boards or reposts." },
  { icon: BadgeCheck, title: "We check every job, every day", body: "If a link is dead or the role is filled, it disappears from your feed." },
  { icon: FileText, title: "Matched to your resume", body: "Roles for 0–2 years' experience, ranked by your skills and projects." },
];

export default async function Home({ searchParams }: { searchParams: Promise<{ deleted?: string }> }) {
  const s = await getSession().catch(() => null);
  if (s) redirect("/feed");
  const [{ deleted }, st] = await Promise.all([searchParams, stats()]);
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-4">
        {deleted && <p role="status" className="mt-6 rounded-lg bg-muted p-3 text-sm">Your account has been deleted. Thanks for trying Job Radar.</p>}
        <section className="py-16 sm:py-24">
          <p className="mb-3 text-sm font-medium text-primary">For freshers and 0–2 years in India</p>
          <h1 className="max-w-2xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">Real openings. Verified today. Matched to you.</h1>
          <p className="mt-4 max-w-xl text-lg text-muted-foreground">No expired links, no agency reposts, no &ldquo;5+ years&rdquo; roles dressed up as entry level. Just jobs you can apply to now, straight on the company&apos;s site.</p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link href="/sign-in?next=/feed" className="inline-flex h-12 items-center rounded-lg bg-primary px-6 font-medium text-primary-foreground hover:opacity-90">Get my matches — free</Link>
            {st && <span className="text-sm text-muted-foreground"><b className="text-foreground tabular-nums">{st.jobs.toLocaleString("en-IN")}</b> verified openings from <b className="text-foreground tabular-nums">{st.companies}</b> companies right now</span>}
          </div>
        </section>
        <section aria-label="How it works" className="grid gap-4 pb-20 sm:grid-cols-3">
          {STEPS.map(({ icon: Icon, title, body }, i) => (
            <div key={title} className="rounded-xl border bg-card p-5">
              <Icon className="size-6 text-primary" aria-hidden="true" />
              <h2 className="mt-3 font-semibold"><span className="sr-only">Step {i + 1}: </span>{title}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{body}</p>
            </div>
          ))}
        </section>
      </main>
      <footer className="border-t">
        <div className="mx-auto flex max-w-5xl flex-wrap gap-4 px-4 py-6 text-sm text-muted-foreground">
          <Link href="/privacy" className="hover:text-foreground">Privacy</Link>
          <Link href="/takedown" className="hover:text-foreground">Employers: remove a listing</Link>
        </div>
      </footer>
    </>
  );
}
