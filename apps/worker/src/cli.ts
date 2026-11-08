import { getAdapter, hasAdapter, type ListResult } from "@job-radar/core";
import { and, companies, eq, ilike, inArray, jobs, sql, type CompanyRow } from "@job-radar/db";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { crawlCompany } from "./crawl";
import { makeDeps, type Deps } from "./deps";
import { detectCompany } from "./detect";
import { env } from "./env";
import { info } from "./log";
import { seed } from "./seed";
import { runAudit, verifyCompanyJobs, verifyOne } from "./verifyjobs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    company: { type: "string" },
    dry: { type: "boolean", default: false },
    force: { type: "boolean", default: false },
    shard: { type: "string" },
    of: { type: "string", default: "4" },
    job: { type: "string" },
    file: { type: "string" },
    sample: { type: "string", default: "50" },
    apply: { type: "string", default: "10" },
    pending: { type: "boolean", default: false },
    url: { type: "string" },
  },
});
const cmd = positionals[0];

async function findCompany(deps: Deps, name: string): Promise<CompanyRow> {
  const [c] = await deps.db.select().from(companies).where(ilike(companies.name, name));
  if (c) return c;
  const like = await deps.db.select().from(companies).where(ilike(companies.name, `%${name}%`)).limit(5);
  if (like.length === 1) return like[0]!;
  throw new Error(`company "${name}" not found${like.length ? `; did you mean ${like.map((l) => l.name).join(", ")}?` : ""}`);
}

function printCrawl(r: Awaited<ReturnType<typeof crawlCompany>>) {
  console.log(`\nstatus: ${r.status}${r.via ? `  via: ${r.via}` : ""}${r.reason ? `\nreason: ${r.reason}` : ""}`);
  if (!r.report) return;
  const rep = r.report;
  console.log(`found ${rep.found} (complete snapshot: ${rep.complete}), non-India skipped ${rep.skippedNonIndia}, new ${rep.newJobs.length}, existing ${rep.updated}, would close ${rep.closed.length}, changed ${rep.changed.length}`);
  const eligible = rep.newJobs.filter((n) => n.classified.freshersEligible);
  console.log(`eligible for 0–2 yrs: ${eligible.length}/${rep.newJobs.length}\n`);
  for (const n of rep.newJobs.slice(0, 8)) {
    const c = n.classified;
    console.log(`${c.freshersEligible ? "✓" : "✗"} ${n.title}`);
    console.log(`    ${c.cities.join(", ") || c.workplace} · ${c.track} · exp ${c.minYears ?? "?"}–${c.maxYears ?? "?"} · ${c.seniority}${c.salaryText ? ` · ${c.salaryText}` : ""}`);
    if (c.rejectReasons.length) console.log(`    reject: ${c.rejectReasons.join("; ")}`);
    if (c.flags.length) console.log(`    flags: ${c.flags.join("; ")}`);
    console.log(`    ${n.url}`);
  }
}

/** GitHub Actions pool: no DB access — read the shard from the web app, post snapshots back. */
async function ghaCrawl(shard: number, of: number) {
  const deps = makeDeps({ withDb: false });
  const headers = { authorization: `Bearer ${env.INGEST_TOKEN}`, "content-type": "application/json" };
  const res = await fetch(`${env.INGEST_URL}/companies?shard=${shard}&of=${of}`, { headers });
  if (!res.ok) throw new Error(`ingest API ${res.status}`);
  const list = (await res.json()) as { companies: (CompanyRow & { knownJobIds: string[] })[] };
  for (const c of list.companies) {
    if (!hasAdapter(c.ats) || getAdapter(c.ats).tier === "browser") continue; // browser tier stays on the VM
    let result: ListResult | null = null;
    let error: string | undefined;
    try {
      result = await getAdapter(c.ats).listJobs(c, { http: deps.http, knownJobIds: new Set(c.knownJobIds), maxDetailFetches: 40 });
    } catch (e) {
      error = (e as Error).message;
    }
    const post = await fetch(`${env.INGEST_URL}/snapshot`, {
      method: "POST",
      headers,
      body: JSON.stringify({ companyId: c.id, shard, result: result && { complete: result.complete, jobs: result.jobs.map(({ raw: _r, ...j }) => j) }, error }),
    });
    info("gha snapshot posted", { company: c.name, status: post.status, jobs: result?.jobs.length ?? 0, error });
  }
}

async function main() {
  if (cmd === "crawl" && values.shard !== undefined && !env.DATABASE_URL && env.INGEST_URL) {
    return ghaCrawl(Number(values.shard), Number(values.of));
  }
  const deps = makeDeps();
  try {
    switch (cmd) {
      case "seed": {
        const file = values.file ? resolve(process.env.INIT_CWD ?? process.cwd(), values.file) : join(ROOT, "data/directory.json");
        const r = await seed(deps.db, file);
        console.log(`seeded ${r.total} companies (${r.inserted} new, ${r.updated} updated); ${r.unknown.length} need ATS detection: run \`pnpm worker detect --pending\``);
        break;
      }
      case "crawl": {
        if (values.company) {
          const c = await findCompany(deps, values.company);
          console.log(`crawl ${c.name} [ats=${c.ats} tier=${c.tier}]${values.dry ? " (dry run: nothing written)" : ""}`);
          printCrawl(await crawlCompany(deps, c, { dry: values.dry, force: values.force || values.dry }));
          if (!values.dry) await verifyCompanyJobs(deps, c);
        } else if (values.shard !== undefined) {
          const shard = Number(values.shard);
          const of = Number(values.of);
          const all = await deps.db.select().from(companies).where(and(eq(companies.active, true), eq(companies.excluded, false))).orderBy(companies.name);
          for (const c of all.filter((_, i) => i % of === shard)) printCrawl(await crawlCompany(deps, c, { dry: values.dry }));
        } else throw new Error("crawl needs --company <name> or --shard N [--of M]");
        break;
      }
      case "detect": {
        const list = values.pending
          ? await deps.db.select().from(companies).where(and(eq(companies.ats, "unknown"), eq(companies.excluded, false)))
          : [await findCompany(deps, values.company ?? "")];
        for (const c of list) console.log(c.name, "→", JSON.stringify(await detectCompany(deps, c, { dry: values.dry })));
        break;
      }
      case "verify": {
        if (values.job) {
          const [row] = await deps.db.select().from(jobs).innerJoin(companies, eq(jobs.companyId, companies.id)).where(eq(jobs.id, values.job));
          if (!row) throw new Error("job not found");
          console.log(JSON.stringify(await verifyOne(deps, row.jobs, row.companies, "manual"), null, 2));
        } else if (values.company) {
          console.log(await verifyCompanyJobs(deps, await findCompany(deps, values.company)));
        }
        break;
      }
      case "render": {
        // Debug: what does our own Playwright see on a page? (robots.txt respected)
        if (!values.url) throw new Error("render needs --url");
        if (!(await deps.http.isAllowed(values.url))) throw new Error("robots.txt disallows this URL");
        const p = await deps.browser().render(values.url, { scrolls: 2, captureJson: /\/(api|graphql|jobs?|careers?|postings?|openings?)\b/i });
        console.log(`status ${p.status} · final ${p.finalUrl} · title "${p.title}" · ${p.links.length} links · ${p.json.length} JSON responses · ${p.text.length} chars text`);
        for (const l of p.links.slice(0, 60)) console.log(`  ${l.text.slice(0, 50).padEnd(50)} ${l.href}`);
        for (const j of p.json.slice(0, 10)) console.log(`  JSON ${j.status} ${j.url}`);
        break;
      }
      case "probe": {
        // Debug: run the S5 Apply-click probe on one URL.
        if (!values.url) throw new Error("probe needs --url");
        if (!(await deps.http.isAllowed(values.url))) throw new Error("robots.txt disallows this URL");
        console.log(JSON.stringify(await deps.browser().applyProbe(values.url)));
        break;
      }
      case "ai-check": {
        // End-to-end check of the AI route (Neon AI Gateway or Gemini) on one public job posting.
        if (!deps.ai) throw new Error("no AI configured (NEON_AI_GATEWAY_TOKEN or GEMINI_API_KEY)");
        console.log(`provider ${deps.ai.provider} · model ${deps.ai.model}`);
        const r = await deps.ai.enrich({
          title: "Associate Software Engineer",
          company: "Acme",
          text: "Build REST APIs in Java and Spring Boot with PostgreSQL. 0-2 years of experience. Freshers welcome. Bengaluru.",
          descriptionHash: `ai-check-${Date.now()}`,
        });
        console.log(r ? `ok: ${JSON.stringify(r)}` : "no result (see the warn line above); the classifier falls back to rules only");
        break;
      }
      case "report":
        await verificationReport(deps, Number(values.sample), Number(values.apply));
        break;
      case "audit":
        console.log(await runAudit(deps));
        break;
      case "start": {
        const { startQueue } = await import("./queue");
        await startQueue(deps);
        await new Promise(() => {}); // run forever
        break;
      }
      default:
        console.log(`usage:
  pnpm worker seed [--file data/directory.json]
  pnpm worker detect --company <name> | --pending [--dry]
  pnpm worker crawl --company <name> [--dry] [--force]
  pnpm worker crawl --shard N --of M          (GitHub Actions pool when INGEST_URL is set and DATABASE_URL is not)
  pnpm worker verify --job <id> | --company <name>
  pnpm worker report --sample 50 --apply 10   (verification report → reports/)
  pnpm worker render --url <url>               (debug: what our Playwright sees)
  pnpm worker probe --url <url>                (debug: S5 Apply-click probe)
  pnpm worker ai-check                         (call the AI route once: Neon AI Gateway or Gemini)
  pnpm worker audit
  pnpm worker start                            (long-running pg-boss worker)`);
    }
  } finally {
    await deps.close();
  }
}

/**
 * Verification report: N jobs spread across seeded companies, each checked with the full agent
 * (S2 HTTP probe + S3 rendered check forced, even when the feed already says open), plus the
 * Playwright Apply probe (S5) on a subset.
 */
async function verificationReport(deps: Deps, sample: number, applyN: number) {
  const rows = await deps.db
    .select()
    .from(jobs)
    .innerJoin(companies, eq(jobs.companyId, companies.id))
    // Eligible jobs only: those are the ones users will see. Spread across companies.
    .where(and(inArray(jobs.status, ["open", "pending", "unknown", "changed"]), eq(jobs.freshersEligible, true)))
    .orderBy(sql`row_number() over (partition by ${jobs.companyId} order by random())`, sql`random()`)
    .limit(sample);
  const out: Record<string, unknown>[] = [];
  let i = 0;
  for (const { jobs: j, companies: c } of rows) {
    const { verifyJob } = await import("@job-radar/core");
    const v = await verifyJob(
      { id: j.id, url: j.url, title: j.title, locations: j.locations, company: { id: c.id, name: c.name, aliases: c.aliases, domain: c.domain, extraDomains: c.extraDomains } },
      { http: deps.http, browser: deps.browser(), router: deps.router, firecrawl: deps.firecrawl, jinaHttp: deps.jinaHttp, workerName: deps.workerName },
      { s1: { snapshotOk: true, complete: false, present: j.status === "open", feedTitle: j.title, at: (j.lastSeenAt ?? new Date()).toISOString() }, forceProbe: true },
    );
    const s5 = i++ < applyN ? await deps.browser().applyProbe(j.url) : undefined;
    out.push({ company: c.name, ats: c.ats, title: j.title, url: j.url, verdict: v.verdict, reason: v.reason, s2: v.signals.s2 && { outcome: v.signals.s2.outcome, status: v.signals.s2.status, hops: v.signals.s2.chain.length, closedReason: v.signals.s2.closedReason }, s3: v.signals.s3 && { via: v.signals.s3.via, pageType: v.signals.s3.pageType, hasApply: v.signals.s3.hasApply, closedReason: v.signals.s3.closedReason }, s4: v.signals.s4 && { pass: v.signals.s4.pass, titleSimilarity: v.signals.s4.titleSimilarity, reasons: v.signals.s4.reasons }, s5, attempts: v.attempts.map((a) => `${a.step}:${a.outcome}`).join(" → "), latencyMs: v.latencyMs });
    console.log(`${String(i).padStart(2)} ${v.verdict.padEnd(7)} ${c.name} · ${j.title}${s5 ? `  [apply: ${s5.outcome}]` : ""}`);
  }
  const dir = join(ROOT, "reports");
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  writeFileSync(join(dir, `verification-${stamp}.json`), JSON.stringify(out, null, 2));
  const tally = out.reduce<Record<string, number>>((a, r) => ((a[r.verdict as string] = (a[r.verdict as string] ?? 0) + 1), a), {});
  const md = [
    `# Verification report — ${new Date().toISOString()}`,
    "",
    `${out.length} jobs, ${new Set(out.map((r) => r.company)).size} companies. Verdicts: ${Object.entries(tally).map(([k, v]) => `${k} ${v}`).join(", ")}.`,
    `S2 + S3 were forced on every job (the feed alone would have decided most). Apply probe (S5) ran on the first ${Math.min(applyN, out.length)}.`,
    "",
    "| # | Company | ATS | Title | Verdict | S2 | S3 | S4 | S5 apply | Path |",
    "|---|---|---|---|---|---|---|---|---|---|",
    ...out.map((r, k) => {
      const s2 = r.s2 as { outcome?: string; status?: number } | undefined;
      const s3 = r.s3 as { via?: string; pageType?: string; hasApply?: boolean } | undefined;
      const s4 = r.s4 as { pass?: boolean; titleSimilarity?: number } | undefined;
      const s5 = r.s5 as { outcome?: string } | undefined;
      return `| ${k + 1} | ${r.company} | ${r.ats} | [${String(r.title).replace(/\|/g, "/")}](${r.url}) | **${r.verdict}** | ${s2 ? `${s2.outcome} ${s2.status ?? ""}` : "–"} | ${s3 ? `${s3.pageType} via ${s3.via}${s3.hasApply ? ", Apply ✓" : ""}` : "–"} | ${s4 ? (s4.pass ? "pass" : "FAIL") + (s4.titleSimilarity !== undefined ? ` (${s4.titleSimilarity.toFixed(2)})` : "") : "–"} | ${s5?.outcome ?? "–"} | ${r.attempts} |`;
    }),
  ].join("\n");
  writeFileSync(join(dir, `verification-${stamp}.md`), md);
  console.log(`\nreport written to reports/verification-${stamp}.md`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
