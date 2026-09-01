/**
 * **Guided Acquisition Reliability — sanitized stage instrumentation.**
 *
 * The first live guided import went silent and left no trail: no `PREPARE` log, idle CPU, and no way to tell
 * whether the run had stalled opening the window, probing the session, settling the surface, or mounting the
 * overlay. This module is the trail. Every boundary in the guided span
 * (`SELF_CHECK → SURFACE_OPEN → SESSION_PROBE → PREPARE → SURFACE_SETTLE → GUIDANCE_PACK → OVERLAY_MOUNT →
 * OVERLAY_VISIBLE → READY`) calls {@link recordStage} as it is entered, and any stall calls
 * {@link recordFailure}. A run that goes quiet now ends on a marker that says exactly where.
 *
 * ## Sanitized by construction
 *
 * Both markers carry ONLY the sanitized enums from `contracts/acquisition/v1/reliability` — a stage, a failure
 * state, the projected blocker, and a boolean. No account, no ref, no URL, no filename, no page text, no count,
 * no timing. The failure state is a *category*; the FE owns every seller-facing sentence (Action Window §6).
 *
 * ## Terminal outcome is derived, never stored
 *
 * {@link outcomeFromLog} folds a run's emitted markers into the single {@link AcquisitionOutcome} the
 * adversarial root-cause loop requires: the last failure recorded, or `OK` once `READY` is reached with no
 * later failure, or `null` when the run emitted nothing terminal (an un-attributable run the loop discards).
 * It is pure — it reads a marker list, holds no state — so the loop and the offline tests classify a run the
 * same way the live sink would.
 */

import {
  ACQUISITION_STAGES,
  failureStateToBlocker,
  isRecoverable,
  stageForFailure,
  type AcquisitionFailureState,
  type AcquisitionOutcome,
  type AcquisitionStage,
} from "../../../../contracts/acquisition/v1/index";
import { log, type LogEntry } from "../../log";

/** The log event names. Kept as exported constants so the reader (`outcomeFromLog`) and tests never drift. */
export const STAGE_EVENT = "aw_acquisition_stage";
export const FAILURE_EVENT = "aw_acquisition_failure";
/**
 * A run that ENDED, and why — deliberately a different event from {@link FAILURE_EVENT}.
 *
 * The eight {@link AcquisitionFailureState}s are recoverable by construction ({@code isRecoverable} is
 * total-true), and a terminal engine failure is not one of them: `TARGET_NOT_FOUND` at `LOCATE_EXPORT`,
 * `DOWNLOAD_TIMEOUT`, `ARTIFACT_INVALID`, `INGEST_FAILED`, `RUNTIME_FAULT` all kill the run. Widening the
 * park enum to hold them would make that invariant a lie, so they get their own marker instead.
 *
 * <p>It exists because of the 2026-09-01 live sitting: the run reached the range-confirm barrier, the seller
 * confirmed, the engine advanced to `LOCATE_EXPORT`, failed to find the export control and ended — and the
 * helper log recorded NOTHING. Two sittings ended that way and neither could be attributed from the trail.
 * The seller UI was not the gap (both the card and the in-page panel carry `blocker.code` and its copy); the
 * log was.
 */
export const TERMINAL_EVENT = "aw_acquisition_terminal";

/** A sanitized log sink — `log` by default; injectable so a caller (or the adversarial loop) can capture. */
export type StageEmit = (event: string, meta: Record<string, unknown>) => void;

/** Record entry into a pipeline stage. Sanitized: the stage enum only. */
export function recordStage(stage: AcquisitionStage, emit: StageEmit = log): void {
  emit(STAGE_EVENT, { stage });
}

/**
 * Record a guided-run stall as one of the eight failure states. Derives the stage it belongs to and the
 * seller-facing blocker it projects to, so the marker alone tells an operator where it stopped and what the
 * seller will be shown — without any un-sanitized detail. `recoverable` is always true by contract; it is
 * emitted explicitly so a transcript never has to infer it.
 */
export function recordFailure(state: AcquisitionFailureState, emit: StageEmit = log): void {
  emit(FAILURE_EVENT, {
    state,
    stage: stageForFailure(state),
    blocker: failureStateToBlocker(state),
    recoverable: isRecoverable(state),
  });
}

/**
 * Record a run ending on a terminal engine failure: the blocker code, and the stage it was in when it died.
 *
 * <p>Sanitized the same way as the other two markers — two enums and a boolean. `stage` is the load-bearing
 * half: `TARGET_NOT_FOUND` says a control was not found, and only the stage says WHICH control, which is the
 * difference between "the seller is on the wrong page" and "our export locator is wrong".
 */
export function recordTerminalFailure(code: string, stage: string, emit: StageEmit = log): void {
  emit(TERMINAL_EVENT, { code, stage, recoverable: false });
}

/**
 * The furthest stage a run reached, from its markers — the "how far did it get" for a run that never failed
 * explicitly. Returns `SELF_CHECK` (the first stage) when no stage marker was emitted at all.
 */
export function furthestStage(entries: readonly LogEntry[]): AcquisitionStage {
  let furthest: AcquisitionStage = ACQUISITION_STAGES[0];
  let furthestIndex = 0;
  for (const e of entries) {
    if (e.event !== STAGE_EVENT) continue;
    const stage = e.meta.stage;
    const idx = ACQUISITION_STAGES.indexOf(stage as AcquisitionStage);
    if (idx > furthestIndex) {
      furthestIndex = idx;
      furthest = ACQUISITION_STAGES[idx] as AcquisitionStage;
    }
  }
  return furthest;
}

/**
 * Fold a run's markers into its terminal {@link AcquisitionOutcome}. Pure and order-sensitive:
 *
 *  - the LAST `aw_acquisition_failure` wins (a run can recover past an earlier failure and stall again later);
 *  - `OK` if the run reached `READY` and recorded no failure after it;
 *  - `null` when nothing terminal was emitted — an un-attributable run. The adversarial loop treats `null` as
 *    "discard, do not record as evidence", never as a pass.
 */
export function outcomeFromLog(entries: readonly LogEntry[]): AcquisitionOutcome | null {
  let outcome: AcquisitionOutcome | null = null;
  for (const e of entries) {
    if (e.event === FAILURE_EVENT) {
      const state = e.meta.state as AcquisitionFailureState;
      outcome = state;
    } else if (e.event === STAGE_EVENT && e.meta.stage === "READY") {
      outcome = "OK";
    }
  }
  return outcome;
}
