import { decideState, type CollectorState, type ExportOutcome, type SessionState } from "../status";

/**
 * Pure helpers for the same-session classify-only discovery flow.
 *
 * Why this flow exists: NAVER Commerce / SmartStore Center admin access is NOT
 * re-entered automatically when Chrome restarts — the NAVER-ID login persists
 * (the "logged-in account" card shows) but the commerce-admin session is not, so
 * a fresh launch on the review route redirects to login. The separate
 * `--login` → quit → later `--discover` flow therefore always lands logged-out.
 * The fix is to keep ONE persistent-context lifetime: the human completes the
 * NAVER-ID / commerce-ID / SmartStore Center flow, confirms in the terminal, and
 * the SAME context continues to the session check + classify-only discovery — no
 * browser restart, so no commerce-session loss.
 */

/** Shown to the operator after the browser opens, before we wait for Enter. */
export const SAME_SESSION_CONFIRM_PROMPT = [
  "",
  "A browser window is open on NAVER. In that SAME window:",
  "  1) Complete the NAVER-ID login (and any 2FA/CAPTCHA) yourself.",
  "  2) Click the logged-in NAVER account / commerce-ID card and enter the",
  "     actual SmartStore Center admin screen (not the public landing page).",
  "  3) Leave the browser OPEN and return here.",
  "",
  "Then press Enter to continue — the collector will re-check the session and",
  "classify the export mechanism in this same window (no upload, no file saved).",
  "Do NOT close the browser. (Ctrl-C to abort.)",
  "",
].join("\n");

export type ConfirmationResult = "confirmed" | "timeout";

/** Pure: proceed to discovery only on an explicit confirmation, never on timeout. */
export function proceedAfterConfirmation(result: ConfirmationResult): boolean {
  return result === "confirmed";
}

/**
 * Pure: map same-session classify-only signals to a status record. There is NO
 * upload leg in this flow, so `uploadOutcome` is never set — `decideState` can
 * therefore never return LAST_SUCCESS (a captured sync export is only
 * COLLECTING). Discovery is not collection.
 */
export function classifyOnlyStatus(
  session: SessionState,
  exportOutcome?: ExportOutcome,
): { state: CollectorState; detail: string } {
  const state = decideState({ paired: true, session, exportOutcome });
  let detail: string;
  if (session !== "LOGGED_IN") {
    detail = "classify-only: session not usable after confirmation; reconnect required";
  } else if (exportOutcome === "CAPTURED") {
    detail = "classify-only: sync export detected; not captured to disk, not uploaded";
  } else {
    detail = `classify-only: export outcome ${exportOutcome ?? "NOT_ATTEMPTED"}`;
  }
  return { state, detail };
}
