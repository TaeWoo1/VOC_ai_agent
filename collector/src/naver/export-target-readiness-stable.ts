/**
 * Read-only EXPORT-TARGET readiness STABILIZATION — bounded polling, browser-free core.
 *
 * Why this exists: the live readiness validation returned `EXPORT_TARGET_EMPTY` on the
 * real surface, but a single-shot `evaluateExportTargetReadiness(html)` taken immediately
 * after `decideCaptureGate` can fire BEFORE the review table/results finish rendering on
 * the NAVER admin SPA — so a still-hydrating page can read as empty when a default range
 * is in fact selected and rows are about to appear. This is NOT a blind fixed sleep: it
 * re-reads the page read-only on a short cadence and resolves as soon as the readiness is
 * stable (or `READY` appears), within a bounded window.
 *
 * Rules:
 *  - `READY` on ANY check → proceed immediately (a rendered result is the answer).
 *  - `EXPORT_TARGET_EMPTY` must be CONFIRMED — it only halts early after it persists for
 *    `STABLE_THRESHOLD` consecutive checks; a single transient empty never halts. This is
 *    the guard against the "table not rendered yet" race.
 *  - `EXPORT_TARGET_UNKNOWN` / `EXPORT_DATE_RANGE_REQUIRED` never short-circuit — they keep
 *    polling for the full window so a late-rendering result has every chance to become
 *    `READY`, then halt honestly on the last observed state at timeout.
 *  - A transient read/evaluate error is ignored (keep polling), never a crash.
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

/** The ONLY shape returned: a settled READY (proceed) or a confirmed HALT (don't click). */
export type ExportTargetReadinessStable =
  | { decision: "READY"; checks: number; readiness: ReadyReadiness }
  | { decision: "HALT"; checks: number; readiness: HaltReadiness; stableCount: number };

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

/** Consecutive confirmed-empty observations required to halt EMPTY before the timeout. */
const STABLE_THRESHOLD = 2;
/** Conservative fallback when EVERY read failed — never click on a page we couldn't read. */
const FALLBACK_HALT: HaltReadiness = { decision: "HALT", state: "EXPORT_TARGET_UNKNOWN", reason: "ambiguous" };
const realSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Poll the export-target readiness read-only until it is stable or READY, within a bounded
 * window. Returns the settled decision plus the number of checks performed; HALT also
 * carries the consecutive same-state run length (`stableCount`). Never acts on the page.
 */
export async function waitForExportTargetReadinessStable(
  page: PwPage,
  deps: ExportTargetReadinessStableDeps,
): Promise<ExportTargetReadinessStable> {
  const sleep = deps.sleepFn ?? realSleep;
  const maxChecks = Math.max(1, Math.ceil(deps.timeoutMs / deps.intervalMs));
  let lastHalt: HaltReadiness | null = null;
  let consecutive = 0;

  for (let i = 0; i < maxChecks; i += 1) {
    let readiness: ExportTargetReadiness | null = null;
    try {
      readiness = deps.evaluateReadinessFn(await deps.readHtmlFn(page));
    } catch {
      readiness = null; // transient read/evaluate hiccup → skip this cycle, keep polling
    }

    if (readiness !== null) {
      if (readiness.decision === "READY") {
        return { decision: "READY", checks: i + 1, readiness };
      }
      // HALT: track the consecutive run of the SAME halt state (a transient null between
      // two identical halts does not reset the run — only a different observed state does).
      consecutive = lastHalt !== null && lastHalt.state === readiness.state ? consecutive + 1 : 1;
      lastHalt = readiness;
      // Only a CONFIRMED empty target short-circuits early; UNKNOWN / DATE_RANGE_REQUIRED
      // keep polling to give a late-rendering result the full window to become READY.
      if (readiness.state === "EXPORT_TARGET_EMPTY" && consecutive >= STABLE_THRESHOLD) {
        return { decision: "HALT", checks: i + 1, readiness, stableCount: consecutive };
      }
    }

    if (i < maxChecks - 1) await sleep(deps.intervalMs);
  }

  // Window expired with no READY and no early-confirmed empty — halt on the last observed
  // halt state (or a conservative UNKNOWN if every read failed). Never a blind click.
  return { decision: "HALT", checks: maxChecks, readiness: lastHalt ?? FALLBACK_HALT, stableCount: consecutive };
}
