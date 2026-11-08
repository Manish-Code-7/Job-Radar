import { requireAdmin } from "@/lib/auth";
import { env } from "@/lib/env";
import { realtime, recentCrawlRunsQuery } from "@/lib/realtime";

/**
 * Seal (or renew) the admin crawl-runs live query. A sealed query is a short-lived bearer capability,
 * so it is only issued to admins, over POST, and never cached.
 */
export async function POST() {
  if (!(await requireAdmin())) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const sealed = await realtime().seal({ query: recentCrawlRunsQuery() });
  return Response.json({ sealed, url: env.NEON_REALTIME_URL }, { headers: { "cache-control": "no-store" } });
}
