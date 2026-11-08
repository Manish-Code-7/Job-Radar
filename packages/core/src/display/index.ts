/** Browser-safe display rules (no Node imports): used by client components. */
/* ------------------------------ Display ------------------------------ */
export type Badge = "verified" | "rechecking" | "hidden";

export const VERIFIED_MAX_H = 36;
export const RECHECKING_MAX_H = 72;
export const ARCHIVE_AFTER_DAYS = 21;

export function displayBadge(status: string, lastVerifiedAt: Date | null | undefined, now = new Date()): { badge: Badge; hoursAgo?: number } {
  if (status !== "open" || !lastVerifiedAt) return { badge: "hidden" };
  const h = (now.getTime() - lastVerifiedAt.getTime()) / 3600_000;
  if (h <= VERIFIED_MAX_H) return { badge: "verified", hoursAgo: Math.floor(h) };
  if (h <= RECHECKING_MAX_H) return { badge: "rechecking", hoursAgo: Math.floor(h) };
  return { badge: "hidden", hoursAgo: Math.floor(h) };
}

/** Archive closed jobs 21 days after closing, and anything not verified for 21 days. */
export function shouldArchive(
  job: { status: string; closedAt?: Date | null; lastVerifiedAt?: Date | null; firstSeenAt: Date },
  now = new Date(),
): boolean {
  if (job.status === "archived") return false;
  const days = (d: Date) => (now.getTime() - d.getTime()) / 864e5;
  if (job.status === "closed" && job.closedAt) return days(job.closedAt) >= ARCHIVE_AFTER_DAYS;
  return days(job.lastVerifiedAt ?? job.firstSeenAt) >= ARCHIVE_AFTER_DAYS;
}
