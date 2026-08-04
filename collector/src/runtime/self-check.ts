/**
 * **Pilot runtime — boot self-check (backend · bridge · origin · version · capability).**
 *
 * A packaged agent has no operator watching a terminal, so a mis-wired install must announce itself in terms
 * the seller can act on — one real screen name, one thing to do — rather than failing silently three steps
 * later when they press 연동. This extends the guided pre-flight (backend reachable, bridge allow-list, app
 * origin) with the two axes a *packaged* agent adds:
 *
 *  - **version** — is this build still supported by the backend it points at? (Optional required-minimum: only
 *    flagged when a minimum is supplied and this build is demonstrably older — never a false alarm.)
 *  - **capability** — does the agent actually have what a guided import needs: a review URL, a launchable
 *    Chrome, a writable profile area, and — the exact gap that makes Windows pilot pairing fail closed — an
 *    approval channel to show the pairing code on this platform.
 *
 * Pure: every fact (reachability, binary presence, writability, presenter availability) is computed by the
 * caller and passed in as a boolean/string, so the whole policy is deterministic and offline-testable. It
 * carries only sanitized enums — an issue code and a recovery-action key — never a URL, host, port, or path.
 */

import { checkGuidedPreflight, PREFLIGHT_RECOVERY, type GuidedPreflightIssue } from "../action-window/initial-import/guided-preflight";

/** The capability/version issues a packaged agent adds on top of the guided pre-flight's connectivity issues. */
export type RuntimeCapabilityIssue =
  | "AGENT_VERSION_UNSUPPORTED"
  | "APPROVAL_CHANNEL_UNAVAILABLE"
  | "REVIEW_URL_MISSING"
  | "BROWSER_UNAVAILABLE"
  | "PROFILE_DIR_UNWRITABLE";

/** The full self-check issue set — the pre-flight's plus the packaged-agent capabilities. */
export type RuntimeSelfCheckIssue = GuidedPreflightIssue | RuntimeCapabilityIssue;

/** One recovery action per capability issue — a key the operator log / FE resolves to real Korean copy. */
export const RUNTIME_CAPABILITY_RECOVERY: Readonly<Record<RuntimeCapabilityIssue, string>> = {
  AGENT_VERSION_UNSUPPORTED: "UPDATE_AGENT",
  APPROVAL_CHANNEL_UNAVAILABLE: "UPDATE_AGENT",
  REVIEW_URL_MISSING: "SET_REVIEW_URL",
  BROWSER_UNAVAILABLE: "INSTALL_CHROME",
  PROFILE_DIR_UNWRITABLE: "FIX_DATA_DIR_PERMISSIONS",
};

/** The merged recovery table over every self-check issue. */
export const RUNTIME_SELF_CHECK_RECOVERY: Readonly<Record<RuntimeSelfCheckIssue, string>> = {
  ...PREFLIGHT_RECOVERY,
  ...RUNTIME_CAPABILITY_RECOVERY,
};

export interface RuntimeSelfCheckInput {
  /** The SellerOps app URL the agent opens. */
  readonly appUrl: string;
  /** The bridge's parsed origin allow-list. */
  readonly allowedOrigins: readonly string[];
  /** Whether the backend reachability probe succeeded (the boot does the fetch). */
  readonly backendReachable: boolean;
  /** This build's agent version (e.g. "0.0.1-poc"). */
  readonly agentVersion: string;
  /** Optional minimum supported version, supplied out-of-band. Absent → the version axis is not checked. */
  readonly requiredAgentVersion?: string;
  /** Whether the NAVER review-management URL is configured (a guided import cannot open its surface without it). */
  readonly reviewUrlPresent: boolean;
  /** Whether a Chrome the agent can drive is present (bundled Chromium, or the configured installed channel). */
  readonly browserAvailable: boolean;
  /** Whether the account-profile area is writable (session cookies must persist there). */
  readonly profileDirWritable: boolean;
  /** Whether an approval presenter can reach a human on this platform (else production pairing fails closed). */
  readonly approvalChannelAvailable: boolean;
}

export interface RuntimeSelfCheckResult {
  readonly ok: boolean;
  readonly issues: readonly RuntimeSelfCheckIssue[];
}

/**
 * Compare two agent versions by their leading `major.minor.patch` numerics, treating a version WITH a
 * pre-release suffix (e.g. `0.0.1-poc`) as *lower* than the same numerics without one. Returns <0, 0, >0.
 * Un-parseable inputs compare as equal, so a version we cannot read never triggers a false "unsupported".
 */
export function compareAgentVersions(a: string, b: string): number {
  const parse = (v: string): { nums: [number, number, number]; pre: boolean } | null => {
    const m = /^\s*v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?\s*$/.exec(v);
    if (!m) return null;
    return { nums: [Number(m[1]), Number(m[2]), Number(m[3])], pre: /[-+]/.test(v) };
  };
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i += 1) {
    const d = pa.nums[i]! - pb.nums[i]!;
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  if (pa.pre === pb.pre) return 0;
  return pa.pre ? -1 : 1; // a pre-release is lower than the release of the same numerics
}

/**
 * Fold the gathered facts into an ordered issue list. Order = fix-this-first: connectivity (from the guided
 * pre-flight), then version, then the capabilities a run needs, with the approval channel first among them
 * because without it pairing itself cannot complete. `ok` is true only when nothing is wrong.
 */
export function runtimeSelfCheck(input: RuntimeSelfCheckInput): RuntimeSelfCheckResult {
  const issues: RuntimeSelfCheckIssue[] = [
    ...checkGuidedPreflight({
      appUrl: input.appUrl,
      allowedOrigins: input.allowedOrigins,
      backendReachable: input.backendReachable,
    }).issues,
  ];

  if (
    input.requiredAgentVersion !== undefined &&
    compareAgentVersions(input.agentVersion, input.requiredAgentVersion) < 0
  ) {
    issues.push("AGENT_VERSION_UNSUPPORTED");
  }
  if (!input.approvalChannelAvailable) issues.push("APPROVAL_CHANNEL_UNAVAILABLE");
  if (!input.reviewUrlPresent) issues.push("REVIEW_URL_MISSING");
  if (!input.browserAvailable) issues.push("BROWSER_UNAVAILABLE");
  if (!input.profileDirWritable) issues.push("PROFILE_DIR_UNWRITABLE");

  return { ok: issues.length === 0, issues };
}
