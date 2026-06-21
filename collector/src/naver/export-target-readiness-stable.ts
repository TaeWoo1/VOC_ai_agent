/**
 * Read-only EXPORT-TARGET readiness STABILIZATION — bounded polling, browser-free core.
 *
 * Why this exists: the live readiness validation returned `EXPORT_TARGET_EMPTY` on the
 * real surface, but a single-shot `evaluateExportTargetReadiness(html)` taken immediately
 * after `decideCaptureGate` can fire BEFORE the review table/results finish rendering on
 * the NAVER admin SPA — so a still-hydrating page (even with a valid default range and
 * exportable reviews) can read as empty. A user confirmed that in another browser the
 * default state CAN download, so an early "empty" reading is NOT proof there is nothing to
 * export — it only proves the evaluator saw empty too soon. This is NOT a blind fixed
 * sleep: it re-reads read-only on a short cadence and resolves as soon as `READY` appears,
 * within a bounded window.
 *
 * Rules (hardened — no HALT short-circuit):
 *  - `READY` on ANY check → proceed immediately (a rendered result is the answer).
 *  - EVERY halt state (`EXPORT_TARGET_EMPTY` / `EXPORT_TARGET_UNKNOWN` /
 *    `EXPORT_DATE_RANGE_REQUIRED`) keeps polling for the FULL bounded window — there is no
 *    early halt, not even for a repeated empty. A confident empty must survive the whole
 *    window before we believe it. This removes the "two quick empties then halt" race.
 *  - At timeout, halt on the LAST observed halt state and report how long it persisted
 *    (`stableCount`). A transient read/evaluate error is ignored (keep polling, never crash);
 *    if every read failed, halt conservatively as `EXPORT_TARGET_UNKNOWN` (never a blind click).
 *
 * This helper NEVER clicks, navigates, exports, downloads, uploads, or writes status — it
 * only reads. The injected `readHtmlFn` / `evaluateReadinessFn` keep the loop pure and the
 * sanitization contract is inherited from `evaluateExportTargetReadiness` (enums/buckets
 * only). A source-guard test asserts the no-action boundary.
 */
import type { PwPage } from "../profile";
import type { ExportTargetReadiness } from "./export-target-readiness";

/** The two readiness shapes, split for the stable result's discriminated payload. */
export type ReadyReadiness = Extract<ExportTargetReadiness, { decision: "READY" }>;
export type HaltReadiness = Extract<ExportTargetReadiness, { decision: "HALT" }>;

/**
 * The ONLY shape returned: a settled READY (proceed) or a confirmed HALT (don't click).
 * `checks` = poll cycles run; `elapsedMs` = approximate observation window consumed (derived
 * from checks×interval, no wall-clock read); `stableCount` = consecutive run length of the
 * resolved state; `lastReadiness` = the last raw observation (sanitized enum payload).
 */
export type ExportTargetReadinessStable =
  | {
      decision: "READY";
      checks: number;
      elapsedMs: number;
      stableCount: number;
      readiness: ReadyReadiness;
      lastReadiness: ExportTargetReadiness;
    }
  | {
      decision: "HALT";
      checks: number;
      elapsedMs: number;
      stableCount: number;
      readiness: HaltReadiness;
      lastReadiness: ExportTargetReadiness;
    };

export interface ExportTargetReadinessStableDeps {
  timeoutMs: number;
  intervalMs: number;
  /** Read-only page content read (e.g. `(p) => p.content()`). */
  readHtmlFn: (page: PwPage) => Promise<string>;
  /** Pure readiness classifier (the existing `evaluateExportTargetReadiness`). */
  evaluateReadinessFn: (html: string) => ExportTargetReadiness;
  /** Injectable for deterministic, instant tests. */
  sleepFn?: (ms: number) => Promise<void>;
}

/** Conservative fallback when EVERY read failed — never click on a page we couldn't read. */
const FALLBACK_HALT: HaltReadiness = { decision: "HALT", state: "EXPORT_TARGET_UNKNOWN", reason: "ambiguous" };
const realSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Poll the export-target readiness read-only across the full bounded window, returning early
 * ONLY when a rendered `READY` result appears. Any halt state persists to timeout and then
 * halts on the last observed state with its consecutive-run length. Never acts on the page.
 */
export async function waitForExportTargetReadinessStable(
  page: PwPage,
  deps: ExportTargetReadinessStableDeps,
): Promise<ExportTargetReadinessStable> {
  const sleep = deps.sleepFn ?? realSleep;
  const maxChecks = Math.max(1, Math.ceil(deps.timeoutMs / deps.intervalMs));
  let lastHalt: HaltReadiness | null = null;
  let lastObserved: ExportTargetReadiness | null = null;
  let consecutive = 0;

  for (let i = 0; i < maxChecks; i += 1) {
    let readiness: ExportTargetReadiness | null = null;
    try {
      readiness = deps.evaluateReadinessFn(await deps.readHtmlFn(page));
    } catch {
      readiness = null; // transient read/evaluate hiccup → skip this cycle, keep polling
    }

    if (readiness !== null) {
      lastObserved = readiness;
      if (readiness.decision === "READY") {
        // A rendered result is the definitive answer — proceed without waiting out the window.
        return { decision: "READY", checks: i + 1, elapsedMs: i * deps.intervalMs, stableCount: 1, readiness, lastReadiness: readiness };
      }
      // HALT: track the consecutive run of the SAME halt state, but DO NOT short-circuit —
      // a still-rendering SPA must be given the full window to flip to READY.
      consecutive = lastHalt !== null && lastHalt.state === readiness.state ? consecutive + 1 : 1;
      lastHalt = readiness;
    }

    if (i < maxChecks - 1) await sleep(deps.intervalMs);
  }

  // Window expired with no READY — halt on the last observed halt state (or a conservative
  // UNKNOWN if every read failed). Never a blind click.
  const halt = lastHalt ?? FALLBACK_HALT;
  return {
    decision: "HALT",
    checks: maxChecks,
    elapsedMs: (maxChecks - 1) * deps.intervalMs,
    stableCount: consecutive,
    readiness: halt,
    lastReadiness: lastObserved ?? halt,
  };
}
