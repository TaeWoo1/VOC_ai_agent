/**
 * Pure NAVER session-precondition mapping (offline, sanitized, type-only imports).
 *
 * Single source of truth for the R4 fail-closed session contract: a coarse five-state
 * `SessionVerdict` (from the read-only session probe) → the Action Window precondition shape
 * (`READY` vs a reserved `SurfaceBlockerCode`). Both consumers share this:
 *   - the fixture driver's `prepareSurface` (`./naver-driver.ts`), and
 *   - the read-only live session-precondition probe entrypoint
 *     (`../cli/probe-session-precondition-same-session.ts`, §8-4 of the R4 preparation).
 *
 * Keeping the mapping here (not duplicated) means the driver and the live probe can never
 * disagree on what counts as a usable session. It imports only TYPES — no browser, no network,
 * no fs — so it is trivially hermetic and cannot leak.
 *
 * Mapping (already-reserved contract codes only):
 *   - LOGGED_IN                                        → ready (no blocker)
 *   - RECONNECT_REQUIRED                               → SESSION_EXPIRED
 *   - ACCOUNT_LOGIN_REQUIRED / AUTH_CHALLENGE_REQUIRED → LOGIN_REQUIRED
 *   - UNKNOWN (ambiguous — never proceed)              → UNSUPPORTED_STATE
 */
import type { SessionVerdict } from "../naver/session-verdict";
import type { SurfaceBlockerCode } from "./engine";

/**
 * Sanitized precondition result: a boolean readiness plus the coarse verdict, and — when NOT
 * ready — the reserved fail-closed blocker code. Enums/booleans only; no raw content, identity,
 * URL, or path is representable here.
 */
export type NaverSessionPrecondition =
  | { ready: true; verdict: "LOGGED_IN" }
  | { ready: false; verdict: Exclude<SessionVerdict, "LOGGED_IN">; blockerCode: SurfaceBlockerCode };

/**
 * Map a session verdict to its fail-closed `SurfaceBlockerCode`. A non-`LOGGED_IN` verdict always
 * yields a blocker; `LOGGED_IN` has no blocker and falls to the conservative `UNSUPPORTED_STATE`
 * default (defensive — callers only invoke this on the not-ready branch).
 */
export function naverSurfaceBlockerFor(verdict: SessionVerdict): SurfaceBlockerCode {
  switch (verdict) {
    case "RECONNECT_REQUIRED":
      return "SESSION_EXPIRED";
    case "ACCOUNT_LOGIN_REQUIRED":
    case "AUTH_CHALLENGE_REQUIRED":
      return "LOGIN_REQUIRED";
    default:
      return "UNSUPPORTED_STATE";
  }
}

/**
 * Classify a session verdict into the READY-vs-blocker precondition. Pure and deterministic —
 * the one authority both the fixture driver and the live §8-4 probe consult.
 */
export function naverSessionPrecondition(verdict: SessionVerdict): NaverSessionPrecondition {
  if (verdict === "LOGGED_IN") return { ready: true, verdict };
  return { ready: false, verdict, blockerCode: naverSurfaceBlockerFor(verdict) };
}
