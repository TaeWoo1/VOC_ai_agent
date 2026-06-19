import type { CollectorState } from "../status";
import type { SessionVerdict } from "./session-verdict";

/**
 * Pure mapping: five-state `SessionVerdict` → the discovery halt decision.
 *
 * This is the seam that makes the verdict (built in `session-verdict.ts`, until now
 * consumed only by the diagnostic probe) the PRIMARY classifier for discovery. The old
 * 3-value path (`detectSession` → `SessionState` → `decideState`) collapsed every
 * not-logged-in page into a single `SESSION_EXPIRED`, so a page that only needs a
 * known-account click (Commerce reconnect) was misreported as "session expired / profile
 * broken". Here each verdict gets an HONEST `CollectorState` + operator-facing detail.
 *
 * Discovery NEVER auto-resolves a non-`LOGGED_IN` verdict — it must never click account /
 * store selection or type credentials. Every verdict but `LOGGED_IN` HALTS (`proceed:
 * false`); only a human clears it via the interactive `--login` flow, then re-probes.
 *
 *   LOGGED_IN                → proceed (continue to export classification)
 *   RECONNECT_REQUIRED       → RECONNECT_REQUIRED            (Commerce reconnect; human click)
 *   ACCOUNT_LOGIN_REQUIRED   → ACCOUNT_LOGIN_REQUIRED        (full NAVER account login)
 *   AUTH_CHALLENGE_REQUIRED  → ACTION_REQUIRED_FOR_2FA_OR_CAPTCHA  (existing action state)
 *   UNKNOWN                  → SESSION_EXPIRED               (conservative — unconfirmed)
 *
 * `SESSION_EXPIRED` is thereby reserved for the genuinely-ambiguous / expired case;
 * `decideState`'s old `LOGGED_OUT → SESSION_EXPIRED` mapping is untouched (back-compat) but
 * no longer the live halt authority.
 *
 * The `detail` strings are static, operator-facing, and contain NO page content, URL, or
 * PII — safe to persist in the status file and surface in the UI.
 */
export interface SessionHaltDecision {
  /** Only `LOGGED_IN` proceeds; every other verdict halts. */
  proceed: boolean;
  /** The externally-visible state to record when halting (ignored when `proceed`). */
  state: CollectorState;
  /** Honest, content-free, operator-facing explanation. */
  detail: string;
}

const LOGGED_IN_DECISION: SessionHaltDecision = {
  proceed: true,
  // Not recorded as a halt — discovery continues to export classification, which decides
  // the final state via the existing `decideState` export/upload legs.
  state: "CONNECTED",
  detail: "session usable; proceeding to export classification",
};

/** Pure and deterministic: verdict → halt decision. See the module doc for the table. */
export function haltForVerdict(verdict: SessionVerdict): SessionHaltDecision {
  switch (verdict) {
    case "LOGGED_IN":
      return LOGGED_IN_DECISION;
    case "RECONNECT_REQUIRED":
      return {
        proceed: false,
        state: "RECONNECT_REQUIRED",
        detail:
          "Commerce reconnect required — complete account/store selection via interactive --login, then re-probe.",
      };
    case "ACCOUNT_LOGIN_REQUIRED":
      return {
        proceed: false,
        state: "ACCOUNT_LOGIN_REQUIRED",
        detail: "NAVER account login required.",
      };
    case "AUTH_CHALLENGE_REQUIRED":
      return {
        proceed: false,
        state: "ACTION_REQUIRED_FOR_2FA_OR_CAPTCHA",
        detail: "Auth challenge (2FA/CAPTCHA) — clear it, then re-probe.",
      };
    case "UNKNOWN":
      return {
        proceed: false,
        state: "SESSION_EXPIRED",
        detail: "Session not confirmed usable — reconnect required.",
      };
    default:
      return assertNever(verdict);
  }
}

/** Compile-time exhaustiveness guard: a new verdict that isn't handled is a type error. */
function assertNever(value: never): never {
  throw new Error(`unhandled SessionVerdict: ${String(value)}`);
}
