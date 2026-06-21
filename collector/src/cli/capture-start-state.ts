import type { SessionVerdict } from "../naver/session-verdict";
import type { PwPage } from "../profile";

/**
 * Read-only auto-read poll for the same-session CAPTURE path's START state.
 *
 * The human still performs login / 2FA / CAPTCHA manually in the open browser; this
 * helper just watches the page until it settles into a state the capture flow can act
 * on — WITHOUT a manual "ready" hand-off. It stops as soon as the verdict is one of the
 * two resolvable starts:
 *   - `LOGGED_IN`         → proceed to export classification, or
 *   - `RECONNECT_REQUIRED`→ hand to `resolveReconnectIfNeeded` (the guarded continue).
 * It keeps WAITING through the transient, human-clearable states
 * (`ACCOUNT_LOGIN_REQUIRED` / `AUTH_CHALLENGE_REQUIRED` / `UNKNOWN`), and returns
 * `TIMEOUT` if none of them ever resolves within the bounded window.
 *
 * Strictly read-only: it settles + reads the verdict via injected functions and never
 * clicks, navigates, exports, downloads, uploads, writes status, or mutates the DB. A
 * mid-navigation read (login redirects re-render the SPA) is caught and treated as
 * "still waiting", never a fatal error, and never surfaces raw error text. The result
 * is sanitized (a verdict enum + a check count) — no URL / HTML / text / cookie / token.
 */

export type CaptureStartKind = "RESOLVABLE" | "TIMEOUT";

export interface CaptureStartState {
  kind: CaptureStartKind;
  /** Last verdict read. On `RESOLVABLE` it is `LOGGED_IN` or `RECONNECT_REQUIRED`. */
  verdict: SessionVerdict;
  /** How many settle+read cycles ran (bounded by the timeout/interval). */
  checks: number;
}

export interface WaitForCaptureStartOptions {
  timeoutMs: number;
  intervalMs: number;
  /** Bounded hydrate/settle of the SPA before each verdict read (e.g. `waitForSpaHydration`). */
  settleFn: (page: PwPage) => Promise<unknown>;
  /** Read-only five-state verdict read (e.g. `checkLiveSessionVerdict`). */
  checkVerdictFn: (page: PwPage) => Promise<SessionVerdict>;
  /** Injectable sleep so tests run without real timers. */
  sleepFn?: (ms: number) => Promise<void>;
}

/** The two start verdicts the capture flow can act on; everything else keeps waiting. */
const RESOLVABLE_START: ReadonlySet<SessionVerdict> = new Set<SessionVerdict>([
  "LOGGED_IN",
  "RECONNECT_REQUIRED",
]);

function defaultSleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Poll until a resolvable start verdict appears or the bounded window elapses. See the
 * module doc for the contract. Never clicks/exports/downloads/uploads/writes status.
 */
export async function waitForCaptureStartState(
  page: PwPage,
  options: WaitForCaptureStartOptions,
): Promise<CaptureStartState> {
  const { timeoutMs, intervalMs, settleFn, checkVerdictFn, sleepFn = defaultSleep } = options;
  const maxChecks = Math.max(1, Math.ceil(timeoutMs / intervalMs));
  let verdict: SessionVerdict = "UNKNOWN";
  for (let i = 0; i < maxChecks; i += 1) {
    try {
      await settleFn(page);
      verdict = await checkVerdictFn(page);
    } catch {
      // Transient mid-navigation read (login redirect re-rendering) — keep waiting.
      verdict = "UNKNOWN";
    }
    if (RESOLVABLE_START.has(verdict)) {
      return { kind: "RESOLVABLE", verdict, checks: i + 1 };
    }
    if (i + 1 < maxChecks) await sleepFn(intervalMs);
  }
  return { kind: "TIMEOUT", verdict, checks: maxChecks };
}
