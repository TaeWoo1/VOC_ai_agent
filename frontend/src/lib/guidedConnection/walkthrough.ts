// NAVER walkthrough — environment-identity binding (pure, sanitized).
//
// A green /health once got mistaken for a working walkthrough because nothing PROVED the operator's actual
// browser tab was talking to the exact bootstrapped frontend/backend/DB/runtime. This module derives that
// proof from three independently-sourced run ids that must all agree, plus an origin match:
//   • URL       — `?walkthroughRun=<id>` (the tab opened the preflight-issued URL),
//   • frontend  — `VITE_WALKTHROUGH_RUN_ID` (the running dev build was bootstrapped for this run),
//   • backend   — the run id from the read-only /context endpoint (the backend the tab reaches is this run).
// Only when all three match AND the backend's frontend-origin equals this tab's origin is the environment
// bound. Everything here is pure/string-level and carries NO credential, token, or account id.

/** True when the app is running in disposable walkthrough mode (bootstrap sets VITE_WALKTHROUGH_MODE). */
export function isWalkthroughMode(): boolean {
  return import.meta.env.VITE_WALKTHROUGH_MODE === "true";
}

/** The run id the FRONTEND dev build was started for (bootstrap-injected), or null. */
export function frontendRunId(): string | null {
  const v = import.meta.env.VITE_WALKTHROUGH_RUN_ID;
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** The run id carried in the current URL's `walkthroughRun` query param, or null. */
export function readUrlRunId(search: string): string | null {
  try {
    const v = new URLSearchParams(search).get("walkthroughRun");
    return v && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

/**
 * The exact bound wizard URL the preflight issues and the mismatch screen re-opens:
 * `<frontendOrigin>/connect/naver?walkthroughRun=<runId>`. Kept as the ONE tested constructor so the
 * reopen button's query param cannot silently drift from what `readUrlRunId` expects to read back (they
 * are symmetric: this encodes, `readUrlRunId` decodes). Carries no secret — only the opaque run id.
 */
export function expectedWalkthroughUrl(frontendOrigin: string, runId: string): string {
  return `${frontendOrigin}/connect/naver?walkthroughRun=${encodeURIComponent(runId)}`;
}

/**
 * Preserve the walkthrough run id across an INTERNAL SPA navigation. A guided run lives in the URL's
 * `?walkthroughRun=`; a plain internal `navigate("/somewhere")` would drop it, so returning to
 * `/connect/naver` later would fail the env-binding with `MISSING_URL_RUN`. This appends the param to an
 * internal path so the same disposable run is carried along.
 *
 * Fail-safe and idempotent: a null/empty run id (i.e. not in a bound walkthrough) returns the path
 * unchanged, and a path that ALREADY carries `walkthroughRun` is returned as-is (never doubled). It only
 * ever appends the one opaque run id — never a credential, token, or account id. Never guesses a run id.
 */
export function withWalkthroughRun(path: string, runId: string | null): string {
  if (!runId) return path;
  if (/[?&]walkthroughRun=/.test(path)) return path;
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}walkthroughRun=${encodeURIComponent(runId)}`;
}

/** Closed reason vocabulary for a binding mismatch (safe to surface; no value ever attached). */
export type WalkthroughMismatchReason =
  | "MISSING_URL_RUN"
  | "MISSING_FRONTEND_RUN"
  | "MISSING_CONTEXT"
  | "RUN_MISMATCH"
  | "ORIGIN_MISMATCH";

export interface WalkthroughBinding {
  status: "matched" | "mismatch";
  reasons: WalkthroughMismatchReason[];
}

/**
 * The 3-way run-identity check + origin match. `matched` ONLY when the URL, frontend, and backend run ids
 * are all present and identical, and the backend's declared frontend origin equals this tab's origin.
 * Fail-closed: any missing input or any disagreement is a `mismatch` with closed reason codes — never a
 * silent proceed, never an attempt to "recover" by probing another backend.
 */
export function evaluateBinding(params: {
  urlRunId: string | null;
  frontendRunId: string | null;
  contextRunId: string | null;
  contextFrontendOrigin: string | null;
  currentOrigin: string;
}): WalkthroughBinding {
  const reasons: WalkthroughMismatchReason[] = [];
  if (!params.urlRunId) reasons.push("MISSING_URL_RUN");
  if (!params.frontendRunId) reasons.push("MISSING_FRONTEND_RUN");
  if (!params.contextRunId) reasons.push("MISSING_CONTEXT");

  // Only compare equality once all three are present.
  if (params.urlRunId && params.frontendRunId && params.contextRunId) {
    const allEqual = params.urlRunId === params.frontendRunId && params.frontendRunId === params.contextRunId;
    if (!allEqual) reasons.push("RUN_MISMATCH");
  }
  if (params.contextFrontendOrigin && params.contextFrontendOrigin !== params.currentOrigin) {
    reasons.push("ORIGIN_MISMATCH");
  }
  return reasons.length === 0 ? { status: "matched", reasons: [] } : { status: "mismatch", reasons };
}

const TAB_NONCE_KEY = "walkthrough_tab_nonce";

/**
 * A per-tab opaque nonce for the operator-tab handshake. Stored in sessionStorage (per-tab, ephemeral) —
 * it is NOT a credential or an account id. Regenerated if absent; stable within a tab so the handshake and
 * any retry correlate. Falls back to a volatile value if storage/crypto are unavailable.
 */
export function tabNonce(): string {
  const gen = () =>
    (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `n-${Date.now()}-${Math.floor(Math.random() * 1e9)}`);
  if (typeof sessionStorage === "undefined") return gen();
  try {
    let n = sessionStorage.getItem(TAB_NONCE_KEY);
    if (!n) {
      n = gen();
      sessionStorage.setItem(TAB_NONCE_KEY, n);
    }
    return n;
  } catch {
    return gen();
  }
}
