/** Plans and feature flags. Nothing is gated yet (Phase 2): every plan can use every feature. */
export type Plan = "free" | "pro";
export type Feature = "feed" | "resume_upload" | "email_digest" | "telegram_alerts" | "whatsapp_alerts" | "application_tracker" | "unlimited_matches";

const PLAN_FEATURES: Record<Plan, Feature[] | "all"> = { free: "all", pro: "all" };

export function can(user: { plan?: string | null } | null | undefined, feature: Feature): boolean {
  if (!user) return false;
  const plan = (user.plan === "pro" ? "pro" : "free") as Plan;
  const allowed = PLAN_FEATURES[plan];
  return allowed === "all" || allowed.includes(feature);
}
