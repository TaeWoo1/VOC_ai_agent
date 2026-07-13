/**
 * Read-only EXPORT-SURFACE SETTLE — wait for the NAVER review-export surface to reach a
 * DECIDED readiness shape before the caller evaluates readiness, so a still-hydrating SPA
 * is never mistaken for an empty export target.
 *
 * Why this exists (§8-11, the read-only row-shape probe): the row-shape-miss hypothesis for
 * the Run-1 false-positive-empty was REFUTED — the settled live surface DID carry semantic
 * rows the readiness gate counts. The remaining cause is TIMING: a single-shot
 * `evaluateExportTargetReadiness(html)` taken the instant the driver reaches the surface can
 * fire BEFORE the client-side review grid renders, reading empty and failing closed. This
 * helper re-reads read-only on a short cadence and resolves as soon as the surface is
 * DECIDED, within a bounded window.
 *
 * DECIDED vs PENDING (the crux — do NOT trust a bare empty container):
 *  - READY (`ready`): readiness is `READY` (data rows present, or a positive labeled count)
 *    → the grid rendered; proceed now.
 *  - HALT (`halt`): an EXPLICIT empty signal — an empty-state / no-export-target MARKER, or a
 *    positive "select a date range" instruction. These are trustworthy: NAVER rendered a real
 *    "리뷰가 없습니다" / range prompt, not a mid-hydration blank → halt now.
 *  - PENDING (`pending`): a results container that is present but has ZERO rows
 *    (`EXPORT_TARGET_EMPTY / zero_rows`) OR a fully ambiguous surface
 *    (`EXPORT_TARGET_UNKNOWN / ambiguous`). BOTH are the hydration trap — the row grid may
 *    still fill into an already-rendered `<tbody>`/grid shell — so keep polling. Trusting a
 *    bare empty container here is EXACTLY the Run-1 false-positive-empty; we deliberately don't.
 *
 * At timeout with no decision, return the LAST observation (a pending halt) so the caller
 * evaluates it and fails closed honestly — we waited the full window and rows never rendered.
 *
 * BOUNDARY: this helper only READS (via the injected `readHtml`); it NEVER clicks, navigates,
 * exports, downloads, uploads, or writes status. Its `html` field is the raw surface content
 * for the caller to re-evaluate — an INTERNAL value (like any `page.content()` read), never a
 * wire/persisted output; the sanitization contract stays with `evaluateExportTargetReadiness`.
 */
import { evaluateExportTargetReadiness, type ExportTargetReadiness } from "./export-target-readiness";

/** What ended (or would end) the wait for a given readiness observation. */
export type ExportSurfaceSettleState = "ready" | "halt" | "pending";

/**
 * Classify a single readiness observation: has the surface DECIDED (`ready`/`halt`), or is it
 * still hydrating (`pending`)? Only an explicit empty MARKER or a range instruction is a trusted
 * halt; a bare empty container / ambiguous surface stays pending (the Run-1 hydration trap).
 */
export function classifyExportSurfaceSettle(readiness: ExportTargetReadiness): ExportSurfaceSettleState {
  if (readiness.decision === "READY") return "ready";
  if (readiness.state === "EXPORT_DATE_RANGE_REQUIRED") return "halt";
  if (readiness.state === "EXPORT_TARGET_EMPTY" && (readiness.reason === "no_export_target" || readiness.reason === "empty_state")) {
    return "halt";
  }
  // EXPORT_TARGET_EMPTY / zero_rows (bare empty container) and EXPORT_TARGET_UNKNOWN / ambiguous
  // are the still-hydrating shapes → keep waiting for rows or an explicit marker.
  return "pending";
}

export interface ExportSurfaceSettleDeps {
  timeoutMs: number;
  intervalMs: number;
  /** Read-only surface HTML read (e.g. `() => frame.content()`). */
  readHtml: () => Promise<string>;
  /** Pure readiness classifier — defaults to `evaluateExportTargetReadiness`. */
  evaluateReadinessFn?: (html: string) => ExportTargetReadiness;
  /** Injectable for deterministic, instant tests. */
  sleepFn?: (ms: number) => Promise<void>;
}

export interface ExportSurfaceSettleResult {
  /** The settled (or, on timeout, last-observed) surface HTML for the caller to evaluate. Internal-only. */
  html: string;
  /** Readiness of `html` (already computed; the caller may re-evaluate identically). */
  readiness: ExportTargetReadiness;
  /** What ended the wait: a decided `ready`/`halt`, or `pending` at timeout. */
  state: ExportSurfaceSettleState;
  /** Poll cycles run. */
  checks: number;
  /** Approx window consumed = (checks-1)×interval; derived, no wall-clock read. */
  elapsedMs: number;
  /** True iff the window expired without a decision (state stays `pending`). */
  timedOut: boolean;
}

/** Conservative fallback when EVERY read failed (or none ran) — never proceed on a page we couldn't read. */
const PENDING_FALLBACK: ExportTargetReadiness = { decision: "HALT", state: "EXPORT_TARGET_UNKNOWN", reason: "ambiguous" };
const realSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Poll the export surface read-only until it DECIDES (rows rendered → `ready`, or an explicit
 * empty/range marker → `halt`), returning that observation immediately. A bare empty container /
 * ambiguous surface stays `pending` and keeps polling across the full bounded window; at timeout
 * the last observation is returned so the caller can fail closed honestly. A transient read error
 * is ignored (skip the cycle, keep polling); if every read failed, the conservative `pending`
 * fallback is returned. Never acts on the page.
 */
export async function settleExportSurface(deps: ExportSurfaceSettleDeps): Promise<ExportSurfaceSettleResult> {
  const evaluate = deps.evaluateReadinessFn ?? evaluateExportTargetReadiness;
  const sleep = deps.sleepFn ?? realSleep;
  const maxChecks = Math.max(1, Math.ceil(deps.timeoutMs / deps.intervalMs));
  let lastHtml = "";
  let lastReadiness: ExportTargetReadiness = PENDING_FALLBACK;

  for (let i = 0; i < maxChecks; i += 1) {
    let html: string | null = null;
    try {
      html = await deps.readHtml();
    } catch {
      html = null; // transient read hiccup → skip this cycle, keep polling, never crash
    }

    if (html !== null) {
      const readiness = evaluate(html);
      const state = classifyExportSurfaceSettle(readiness);
      lastHtml = html;
      lastReadiness = readiness;
      if (state !== "pending") {
        // The surface decided — a rendered grid or an explicit empty/range marker is the answer.
        return { html, readiness, state, checks: i + 1, elapsedMs: i * deps.intervalMs, timedOut: false };
      }
    }

    if (i < maxChecks - 1) await sleep(deps.intervalMs);
  }

  // Window expired with no decision — hand back the last observation (a pending halt) so the caller
  // evaluates it and fails closed. Never a blind proceed.
  return {
    html: lastHtml,
    readiness: lastReadiness,
    state: "pending",
    checks: maxChecks,
    elapsedMs: (maxChecks - 1) * deps.intervalMs,
    timedOut: true,
  };
}
