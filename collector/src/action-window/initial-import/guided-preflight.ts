/**
 * **Guided Acquisition Reliability — agent-side pre-flight self-check (pure).**
 *
 * Before the seller ever presses 연동, the agent can already tell that the guided journey is mis-wired in the
 * exact ways the first live runs were: the FE it opens sits on an origin the bridge's allow-list does not
 * include (the `:5174` vs `:5173` gotcha — the browser connects, the bridge rejects the WebSocket, and the
 * seller sees "로컬 도우미가 실행되지 않았어요" with no idea why), the allow-list is empty so no FE could ever
 * connect, or the backend is unreachable so nothing will ingest. This module folds those observations into a
 * single ordered list of issues, each with the one thing to fix.
 *
 * Pure: no I/O, no clock, no fetch. The caller (the boot) does the one reachability probe and passes a boolean;
 * everything here is a deterministic policy over already-gathered facts, so it is fully unit-testable offline.
 * It carries only sanitized enums — an issue code and a recovery-action key — never a URL, host, or port value.
 */

/** What the self-check found wrong, in the order the boot should surface them (connectivity before origin). */
export type GuidedPreflightIssue = "BACKEND_UNREACHABLE" | "BRIDGE_ORIGINS_EMPTY" | "APP_ORIGIN_NOT_ALLOWED";

/** The single recovery action for each issue — a key the operator log / FE resolves to real copy, never prose. */
export const PREFLIGHT_RECOVERY: Readonly<Record<GuidedPreflightIssue, string>> = {
  BACKEND_UNREACHABLE: "START_BACKEND",
  BRIDGE_ORIGINS_EMPTY: "SET_BRIDGE_ORIGINS",
  APP_ORIGIN_NOT_ALLOWED: "ALIGN_BRIDGE_ORIGIN",
};

export interface GuidedPreflightInput {
  /** The SellerOps app URL the agent opens (agent's `SELLEROPS_APP_URL`). */
  readonly appUrl: string;
  /** The bridge's parsed origin allow-list (agent's `BRIDGE_ALLOWED_ORIGINS`). */
  readonly allowedOrigins: readonly string[];
  /** Whether a reachability probe to the backend succeeded — the boot does the fetch and passes the result. */
  readonly backendReachable: boolean;
}

export interface GuidedPreflightResult {
  readonly ok: boolean;
  readonly issues: readonly GuidedPreflightIssue[];
}

/** The scheme+host+port of a URL, or `null` if it does not parse — the comparison unit for the allow-list. */
export function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Fold the gathered facts into the ordered issue list. Connectivity first (a down backend is the most basic
 * failure), then the bridge allow-list, then the specific origin mismatch. An un-parseable `appUrl` cannot be
 * proven mismatched, so it is NOT reported as `APP_ORIGIN_NOT_ALLOWED` — the check fails closed toward silence
 * only where it genuinely cannot tell, never toward a false alarm.
 */
export function checkGuidedPreflight(input: GuidedPreflightInput): GuidedPreflightResult {
  const issues: GuidedPreflightIssue[] = [];
  if (!input.backendReachable) issues.push("BACKEND_UNREACHABLE");
  if (input.allowedOrigins.length === 0) {
    issues.push("BRIDGE_ORIGINS_EMPTY");
  } else {
    const appOrigin = originOf(input.appUrl);
    const allowed = input.allowedOrigins.map((o) => originOf(o) ?? o);
    // Only flag a mismatch we can actually prove: a parseable app origin absent from the allow-list. An empty
    // list is already reported above, so this branch only runs when there IS a list to disagree with.
    if (appOrigin !== null && !allowed.includes(appOrigin)) issues.push("APP_ORIGIN_NOT_ALLOWED");
  }
  return { ok: issues.length === 0, issues };
}
