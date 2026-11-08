/**
 * Neon Function `jobstats`: a small public, read-only JSON API next to the database.
 *   GET /        → coverage + counts (verified-open eligible jobs, companies, last crawl)
 *   GET /jobs    → latest verified-open jobs for 0–2 yrs (?track=&city=&limit=); summary + link only
 * Never returns full job descriptions (we only publish our own summary and link out to apply).
 */
import { parseEnv } from "@neon/env";
import pg from "pg";
import config from "../../../../neon";

const { postgres } = parseEnv(config, ["DATABASE_URL"]);
// Module scope: reused across requests on the same isolate. Keep it small, each isolate has its own.
const pool = new pg.Pool({ connectionString: postgres.databaseUrl, max: 5, idleTimeoutMillis: 30_000 });
// An idle client dropped by the server must not crash the isolate.
pool.on("error", (e) => console.error("pg pool error", e.message));

const VERIFIED = `j.status = 'open' and j.freshers_eligible and not j.hidden_by_reports
  and j.last_verified_at > now() - interval '36 hours'`;
const TRACKS = new Set(["software", "ai_ml", "devops", "data", "qa", "other"]);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "public, max-age=60", "access-control-allow-origin": "*" },
  });

async function stats() {
  const { rows } = await pool.query(`
    select
      (select count(*)::int from jobs j where ${VERIFIED}) as verified_open,
      (select count(*)::int from companies where active and not excluded) as companies,
      (select count(distinct company_id)::int from jobs j where ${VERIFIED}) as companies_hiring,
      (select max(finished_at) from crawl_runs where status = 'ok') as last_crawl_at`);
  const byTrack = await pool.query(`select track, count(*)::int as n from jobs j where ${VERIFIED} group by track order by n desc`);
  return { ...rows[0], by_track: byTrack.rows };
}

async function jobs(url: URL) {
  const track = url.searchParams.get("track");
  const city = url.searchParams.get("city");
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") ?? 20) || 20));
  const params: unknown[] = [];
  let where = VERIFIED;
  if (track && TRACKS.has(track)) {
    params.push(track);
    where += ` and j.track = $${params.length}`;
  }
  if (city) {
    params.push(city);
    where += ` and $${params.length} = any(j.cities)`;
  }
  params.push(limit);
  const { rows } = await pool.query(
    `select j.id, j.title, c.name as company, j.cities, j.workplace, j.track, j.min_years, j.max_years,
            j.salary_text, j.summary, j.url, j.last_verified_at
       from jobs j join companies c on c.id = j.company_id
      where ${where}
      order by j.first_seen_at desc
      limit $${params.length}`,
    params,
  );
  return { jobs: rows };
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "GET") return json({ error: "method not allowed" }, 405);
    try {
      if (url.pathname === "/" || url.pathname === "") return json(await stats());
      if (url.pathname === "/jobs") return json(await jobs(url));
      return json({ error: "not found" }, 404);
    } catch (e) {
      console.error("jobstats failed", (e as Error).message);
      return json({ error: "internal error" }, 500);
    }
  },
};
