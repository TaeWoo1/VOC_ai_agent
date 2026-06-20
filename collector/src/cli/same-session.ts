import type { ExportActionPlan, ExportLayout } from "../naver/export-classify";
import type { SanitizedExportProbeSignals } from "../naver/export-probe";
import { haltForVerdict } from "../naver/session-halt";
import type { SanitizedProbeSignals } from "../naver/session-probe";
import type { SessionVerdict } from "../naver/session-verdict";
import { decideState, type CollectorState, type ExportOutcome } from "../status";

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
 * Opt-in diagnostic flag: emit the sanitized `extractProbeSignals` snapshot at the
 * key same-session points so we can tell WHY a logged-in session still reads
 * LOGGED_OUT (placeholder markers vs. re-navigation resetting the SPA). Off by
 * default — without this flag the flow emits no probe diagnostics.
 */
export const EMIT_SESSION_PROBE_FLAG = "--emit-session-probe";

/** Pure: did the operator opt into same-session probe diagnostics? */
export function emitSessionProbe(args: string[]): boolean {
  return args.includes(EMIT_SESSION_PROBE_FLAG);
}

/**
 * Opt-in diagnostic flag: emit the sanitized `extractExportProbeSignals` snapshot
 * at the export-classification points so a LAYOUT_UNRECOGNIZED verdict can be
 * explained (missing selector vs. hidden/gated export UI vs. iframe/sub-route)
 * without exposing labels, selectors, URLs, or PII. Off by default — without this
 * flag the flow emits no export-probe diagnostics.
 */
export const EMIT_EXPORT_PROBE_FLAG = "--emit-export-probe";

/** Pure: did the operator opt into export-area probe diagnostics? */
export function emitExportProbe(args: string[]): boolean {
  return args.includes(EMIT_EXPORT_PROBE_FLAG);
}

/**
 * Pure: build the metadata-only payload logged for an export-probe phase. The
 * `frameUrlCategories` array is flattened to a comma-joined category string so the
 * metadata-only logger (`safeMeta`, which collapses non-scalars to a type tag)
 * keeps it readable; every joined token is a fixed category enum, never a raw URL.
 */
export function buildExportProbeMeta(
  phase: string,
  signals: SanitizedExportProbeSignals,
): Record<string, unknown> {
  return { phase, ...signals, frameUrlCategories: signals.frameUrlCategories.join(",") };
}

/**
 * Pure: build the metadata-only payload logged for a probe phase. Wraps the
 * already-sanitized signals (booleans/buckets/categories — never raw HTML, text,
 * URL, or PII) with a coarse phase label, so the diagnostic log line can never
 * carry sensitive content.
 */
export function buildSessionProbeMeta(
  phase: string,
  signals: SanitizedProbeSignals,
): Record<string, unknown> {
  return { phase, ...signals };
}

/**
 * Pure: map same-session classify-only signals to a status record, keyed on the
 * five-state `SessionVerdict`.
 *
 * Non-`LOGGED_IN` verdicts halt via `haltForVerdict` — so a Commerce reconnect reads
 * `RECONNECT_REQUIRED`, a full login `ACCOUNT_LOGIN_REQUIRED`, an auth challenge
 * `ACTION_REQUIRED_FOR_2FA_OR_CAPTCHA`, and the ambiguous case `SESSION_EXPIRED` — never
 * the old blanket "session expired" for all four. On `LOGGED_IN` the export-outcome
 * detail is unchanged. There is NO upload leg here, so `uploadOutcome` is never set and
 * `decideState` can never return LAST_SUCCESS (a captured sync export is only COLLECTING).
 * Discovery is not collection.
 */
export function classifyOnlyStatus(
  verdict: SessionVerdict,
  exportOutcome?: ExportOutcome,
): { state: CollectorState; detail: string } {
  if (verdict !== "LOGGED_IN") {
    const halt = haltForVerdict(verdict);
    return { state: halt.state, detail: `classify-only: ${halt.detail}` };
  }
  const state = decideState({ paired: true, session: "LOGGED_IN", exportOutcome });
  const detail =
    exportOutcome === "CAPTURED"
      ? "classify-only: sync export detected; not captured to disk, not uploaded"
      : `classify-only: export outcome ${exportOutcome ?? "NOT_ATTEMPTED"}`;
  return { state, detail };
}

/**
 * Pure: map the layout of a NO-CLICK `planExportAction` plan to the `ExportOutcome`
 * vocabulary. The planner only ever observes structure, so a sync layout becomes
 * `SYNC_DOWNLOAD_DETECTED` (mechanism recognized, NOT triggered) — never `CAPTURED`,
 * which would imply a file stream completed. Exhaustive over `ExportLayout` (no
 * `default`), so a new layout is a compile error.
 */
function exportOutcomeForLayout(layout: ExportLayout): ExportOutcome {
  switch (layout) {
    case "SYNC_DOWNLOAD":
      return "SYNC_DOWNLOAD_DETECTED";
    case "ASYNC_JOB_DETECTED":
      return "ASYNC_JOB_DETECTED";
    case "LAYOUT_UNRECOGNIZED":
      return "LAYOUT_UNRECOGNIZED";
  }
}

/**
 * Pure: map a NO-CLICK export-layout plan to a status record, keyed on the five-state
 * `SessionVerdict`. The no-click sibling of `classifyOnlyStatus`: identical verdict
 * halting, but the export state is derived from the structurally-classified layout
 * (`planExportAction`) rather than a triggered outcome. A recognized sync layout reads
 * `EXPORT_SYNC_DETECTED` — discovery, not capture — so `decideState` can never return
 * COLLECTING/LAST_SUCCESS from this path (there is no captured file and no upload leg).
 */
export function classifyOnlyStatusFromPlan(
  verdict: SessionVerdict,
  plan: ExportActionPlan,
): { state: CollectorState; detail: string } {
  if (verdict !== "LOGGED_IN") {
    const halt = haltForVerdict(verdict);
    return { state: halt.state, detail: `classify-only: ${halt.detail}` };
  }
  const exportOutcome = exportOutcomeForLayout(plan.layout);
  const state = decideState({ paired: true, session: "LOGGED_IN", exportOutcome });
  const detail =
    plan.layout === "SYNC_DOWNLOAD"
      ? "no-click: sync export layout detected; not triggered, not captured, not uploaded"
      : `no-click: export layout ${plan.layout}`;
  return { state, detail };
}
