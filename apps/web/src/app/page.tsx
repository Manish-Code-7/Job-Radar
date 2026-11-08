import { ArrowRight, BadgeCheck, Ban, Check, ChevronDown, FileText, Lock, Radar, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Monogram } from "@/components/logo";
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
  { icon: Radar, title: "Straight from company sites", body: "We read 300+ companies' own career pages: Workday, Greenhouse, Lever and more. Never job boards or reposts." },
  { icon: BadgeCheck, title: "Checked open every day", body: "Every link is re-verified daily. Filled roles and dead links disappear before you waste an application." },
  { icon: FileText, title: "Matched to your resume", body: "Only roles that fit 0–2 years, ranked by your skills and projects, with what to brush up on." },
];
const NEVER = ["No agency or consultancy reposts", "No “fresher” roles that ask for 5 years", "No expired links or closed roles", "No resume sharing with anyone"];
const FAQ = [
  { q: "Is it free?", a: "Yes. Job Radar is free for job seekers." },
  { q: "Where do the jobs come from?", a: "Only from the hiring company's own careers portal. We never copy listings from Naukri, LinkedIn, Indeed or other job boards." },
  { q: "What does “Verified open” mean?", a: "We checked the company's page in the last 36 hours and the job was still accepting applications. If a check fails, the job is hidden until we confirm it again." },
  { q: "What happens to my resume?", a: "It's stored encrypted and read on our own servers to match you. It's never sent to an outside AI service or shared with employers. You can download or delete it any time." },
];

function PreviewCard() {
  return (
    <div aria-hidden="true" className="relative">
      <div className="absolute -inset-6 -z-10 rounded-[2rem] bg-primary-soft/70 blur-2xl" />
      <div className="rounded-2xl border bg-card p-5 shadow-xl shadow-primary/5">
        <div className="flex items-start gap-3">
          <Monogram name="Razorpay" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">Software Engineer, Payments</p>
            <p className="text-sm text-muted-foreground">Razorpay · Bengaluru</p>
          </div>
          <div className="rounded-lg bg-ok-soft px-2.5 py-1.5 text-right text-ok">
            <p className="text-lg font-semibold leading-none">88</p>
            <p className="mt-1 text-[11px] font-medium">Strong match</p>
          </div>
        </div>
        <p className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-ok-soft px-2 py-1 text-xs font-medium text-ok"><BadgeCheck className="size-3.5" />Verified open · checked 2h ago</p>
        <ul className="mt-4 space-y-1.5 text-sm">
          <li className="flex gap-2"><Check className="mt-0.5 size-4 text-ok" />You know Java, Spring Boot, SQL</li>
          <li className="flex gap-2"><Check className="mt-0.5 size-4 text-ok" />Asks 0–2 years, you have 1</li>
        </ul>
        <div className="mt-4 flex flex-wrap gap-1.5">
          {["Java", "Spring", "SQL"].map((s) => <span key={s} className="inline-flex items-center gap-1 rounded-md bg-primary-soft px-2 py-0.5 text-xs font-medium text-primary"><Check className="size-3" />{s}</span>)}
          {["Kafka", "Redis"].map((s) => <span key={s} className="rounded-md border px-2 py-0.5 text-xs text-muted-foreground">{s}</span>)}
        </div>
        <div className="mt-4 flex gap-2 border-t pt-4">
          <span className="inline-flex h-10 flex-1 items-center justify-center rounded-lg bg-primary text-sm font-medium text-primary-foreground">Apply on Razorpay</span>
          <span className="inline-flex h-10 items-center rounded-lg border px-3 text-sm text-muted-foreground">Not for me</span>
        </div>
      </div>
    </div>
  );
}

export default async function Home({ searchParams }: { searchParams: Promise<{ deleted?: string }> }) {
  const s = await getSession().catch(() => null);
  if (s) redirect("/feed");
  const [{ deleted }, st] = await Promise.all([searchParams, stats()]);
  return (
    <>
      <SiteHeader />
      <main>
        {deleted && <p role="status" className="mx-auto mt-6 max-w-6xl rounded-lg bg-muted px-4 py-3 text-sm">Your account has been deleted. Thanks for trying Job Radar.</p>}

        <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-14 sm:py-20 lg:grid-cols-[1.1fr_1fr]">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-[13px] text-muted-foreground">
              <span className="size-1.5 rounded-full bg-ok" aria-hidden="true" />For freshers and 0–2 years in India
            </p>
            <h1 className="mt-5 text-[40px] font-semibold leading-[1.08] tracking-tight text-balance sm:text-[56px]">Real openings. Verified today. Matched to you.</h1>
            <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-muted-foreground">
              Stop applying to dead links and “entry-level” roles that want five years. Job Radar shows only jobs you can apply to right now, straight on the company&apos;s own site.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link href="/sign-in?next=/feed" className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-primary px-6 text-[15px] font-medium text-primary-foreground transition-colors hover:bg-primary/90">
                Get my matches, free<ArrowRight className="size-4" aria-hidden="true" />
              </Link>
              <a href="#how" className="inline-flex h-12 items-center justify-center rounded-lg px-4 text-[15px] text-muted-foreground hover:text-foreground">How it works</a>
            </div>
            {st && (
              <dl className="mt-10 grid max-w-md grid-cols-2 gap-6 border-t pt-6">
                <div><dt className="text-[13px] text-muted-foreground">Verified openings now</dt><dd className="mt-1 text-3xl font-semibold tabular-nums">{st.jobs.toLocaleString("en-IN")}</dd></div>
                <div><dt className="text-[13px] text-muted-foreground">Companies tracked</dt><dd className="mt-1 text-3xl font-semibold tabular-nums">{st.companies.toLocaleString("en-IN")}</dd></div>
              </dl>
            )}
          </div>
          <PreviewCard />
        </section>

        <section id="how" aria-labelledby="how-h" className="border-y bg-card">
          <div className="mx-auto max-w-6xl px-4 py-16">
            <h2 id="how-h" className="text-[28px] font-semibold tracking-tight">How it works</h2>
            <ol className="mt-8 grid gap-6 sm:grid-cols-3">
              {STEPS.map(({ icon: Icon, title, body }, i) => (
                <li key={title} className="rounded-xl border bg-background p-6">
                  <div className="flex items-center gap-3">
                    <span className="grid size-10 place-items-center rounded-lg bg-primary-soft text-primary"><Icon className="size-5" aria-hidden="true" /></span>
                    <span className="text-sm font-medium text-muted-foreground">Step {i + 1}</span>
                  </div>
                  <h3 className="mt-4 font-semibold">{title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section aria-labelledby="never-h" className="mx-auto grid max-w-6xl gap-10 px-4 py-16 lg:grid-cols-2">
          <div>
            <h2 id="never-h" className="text-[28px] font-semibold tracking-tight">What you won&apos;t see</h2>
            <p className="mt-3 max-w-md text-muted-foreground">Most fresher job feeds are full of noise. We filter it out before it reaches you.</p>
            <ul className="mt-6 space-y-3">
              {NEVER.map((n) => <li key={n} className="flex items-center gap-3"><span className="grid size-7 place-items-center rounded-full bg-bad-soft text-bad"><Ban className="size-4" aria-hidden="true" /></span>{n}</li>)}
            </ul>
          </div>
          <div className="rounded-2xl border bg-card p-6">
            <div className="flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-lg bg-ok-soft text-ok"><ShieldCheck className="size-5" aria-hidden="true" /></span>
              <h3 className="font-semibold">Your data, your call</h3>
            </div>
            <ul className="mt-5 space-y-3 text-sm text-muted-foreground">
              <li className="flex gap-2.5"><Lock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />Resume stored encrypted and read only on our servers, never by an outside AI.</li>
              <li className="flex gap-2.5"><Check className="mt-0.5 size-4 shrink-0" aria-hidden="true" />Download, edit or delete everything in Settings, any time.</li>
              <li className="flex gap-2.5"><Check className="mt-0.5 size-4 shrink-0" aria-hidden="true" />Built for India&apos;s DPDP Act. <Link href="/privacy" className="text-primary underline underline-offset-2">Read the privacy notice</Link>.</li>
            </ul>
          </div>
        </section>

        <section aria-labelledby="faq-h" className="mx-auto max-w-3xl px-4 pb-16">
          <h2 id="faq-h" className="text-[28px] font-semibold tracking-tight">Questions</h2>
          <div className="mt-6 divide-y rounded-xl border bg-card">
            {FAQ.map(({ q, a }) => (
              <details key={q} className="group px-5">
                <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 font-medium [&::-webkit-details-marker]:hidden">
                  {q}<ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
                </summary>
                <p className="pb-5 text-sm leading-relaxed text-muted-foreground">{a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 pb-20">
          <div className="flex flex-col items-start justify-between gap-6 rounded-2xl bg-primary px-6 py-10 text-primary-foreground sm:flex-row sm:items-center sm:px-10">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">Your next job is already posted somewhere.</h2>
              <p className="mt-2 opacity-85">Set up in two minutes. Upload your resume and see your matches.</p>
            </div>
            <Link href="/sign-in?next=/feed" className="inline-flex h-12 shrink-0 items-center gap-2 rounded-lg bg-primary-foreground px-6 font-medium text-primary hover:opacity-90">
              Get started<ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </div>
        </section>
      </main>
      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-8 text-sm text-muted-foreground">
          <span>© {new Date().getFullYear()} Job Radar</span>
          <Link href="/privacy" className="hover:text-foreground">Privacy</Link>
          <Link href="/takedown" className="hover:text-foreground">Employers: remove a listing</Link>
        </div>
      </footer>
    </>
  );
}
