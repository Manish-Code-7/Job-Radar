import type { ClosedObservation, Signals, Verdict } from "./signals";

export const SECOND_CLOSE_GAP_MS = 6 * 3600_000;

export interface VerdictResult {
  verdict: Verdict;
  reason: string;
  /** Present when this check saw the page as closed; persisted so a later check can confirm it. */
  closedObservation?: ClosedObservation;
}

function currentClosed(s: Signals): { reason: string; definitive: boolean; at: string } | null {
  if (s.s2?.outcome === "closed") {
    return { reason: s.s2.closedReason ?? "closed", definitive: s.s2.closedStrength === "definitive", at: s.s2.at };
  }
  if (s.s3?.outcome === "ok" && s.s3.closedReason) {
    return { reason: s.s3.closedReason, definitive: false, at: s.s3.at };
  }
  return null;
}

/**
 * Pure verdict. Rules:
 * - closed: S1 missing from a successful *complete* snapshot; or the ATS itself says "not found"
 *   (definitive, e.g. Greenhouse `?error=true`); or S2/S3 closed now and in an earlier check ≥ 6h ago.
 * - changed: S4 ran and failed.
 * - open: S1 present, or (S2 ok and S3 job_posting with an Apply button and S4 pass).
 * - unknown: everything else. A failed/blocked fetch never closes; a metadata-only page never opens.
 */
export function decideVerdict(s: Signals, priorClosed: ClosedObservation[] = []): VerdictResult {
  if (s.s1 && s.s1.snapshotOk && s.s1.complete && !s.s1.present) {
    return { verdict: "closed", reason: "missing from full feed snapshot" };
  }

  if (s.s4 && !s.s4.pass && !s.s4.inconclusive) {
    return { verdict: "changed", reason: `identity: ${s.s4.reasons.join("; ")}` };
  }

  if (s.s1?.present && s.s1.snapshotOk) {
    return { verdict: "open", reason: "present in feed" };
  }

  const closedNow = currentClosed(s);
  if (closedNow) {
    const obs = { at: closedNow.at, reason: closedNow.reason };
    if (closedNow.definitive) return { verdict: "closed", reason: closedNow.reason, closedObservation: obs };
    const nowMs = Date.parse(closedNow.at);
    const earlier = priorClosed.find((p) => nowMs - Date.parse(p.at) >= SECOND_CLOSE_GAP_MS);
    if (earlier) {
      return { verdict: "closed", reason: `${closedNow.reason} (also at ${earlier.at})`, closedObservation: obs };
    }
    return { verdict: "unknown", reason: `closed once (${closedNow.reason}); confirming in ≥6h`, closedObservation: obs };
  }

  const s2ok = s.s2?.outcome === "ok" || s.s2?.outcome === "needs_render";
  const s3open = s.s3?.outcome === "ok" && s.s3.pageType === "job_posting" && s.s3.hasApply === true;
  if (s2ok && s3open && s.s4?.pass) {
    return { verdict: "open", reason: `page check via ${s.s3!.via}` };
  }

  if (s.s2?.outcome === "needs_render" && !s.s3) return { verdict: "unknown", reason: "metadata-only HTML; needs rendered check" };
  if (s.s2?.outcome === "error") return { verdict: "unknown", reason: `fetch failed: ${s.s2.error ?? s.s2.status}` };
  if (s.s3?.outcome === "error") return { verdict: "unknown", reason: `render failed: ${s.s3.error}` };
  if (s.s3?.pageType && s.s3.pageType !== "job_posting") return { verdict: "unknown", reason: `page looks like ${s.s3.pageType}` };
  if (s.s3 && !s.s3.hasApply) return { verdict: "unknown", reason: "no Apply button found" };
  return { verdict: "unknown", reason: "insufficient signals" };
}

export * from "../display";
