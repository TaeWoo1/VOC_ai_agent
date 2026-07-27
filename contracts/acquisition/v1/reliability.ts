/**
 * **Guided Acquisition Reliability — the sanitized diagnostic contract (v1).**
 *
 * `./acquisition` answers "how do we acquire this, and may we start?". This module answers the question the
 * first live guided import could not answer: **when a guided run does not reach the seller's hands, where
 * exactly did it stop, and is that recoverable?** It is the pure vocabulary for the reliability seam — the
 * span from "the seller pressed 연동" through backend/bridge self-check, opening the marketplace window, the
 * session probe, `PREPARE`, surface settle, the guidance pack, and the in-page overlay, up to the moment the
 * guidance is actually visible and the seller can act.
 *
 * ## Two enums, one span
 *
 *  - {@link AcquisitionStage} — the ordered pipeline the guided run walks. Instrumentation emits one sanitized
 *    marker per stage boundary, so a run that goes silent leaves a trail whose LAST stage is where it stopped.
 *  - {@link AcquisitionFailureState} — the eight ways a guided run can stall in that span, each anchored to the
 *    stage it belongs to. Every one names a place the old runtime fell *silent*; naming them is what lets the
 *    seller see one recovery action instead of a frozen page, and what lets the adversarial root-cause loop
 *    terminate every run in exactly one classified state.
 *
 * ## Pure, sanitized, no I/O
 *
 * A sibling of `./acquisition` and `../../session-readiness/v1`: no I/O, no logging, no browser, no clock,
 * type-checked under `contracts/tsconfig.json` (no DOM, no Node). It carries only enums. A failure state is a
 * *category*, never a message, a selector, a URL, a filename, an account, or a count — the FE owns every
 * seller-facing sentence (Action Window contract §6), and this module only says *which* category occurred.
 *
 * ## Every state recoverable — fail closed toward "ask the seller", never toward a dead end
 *
 * All eight states are recoverable by construction ({@link isRecoverable} is total-true). The product promise
 * is that the seller never meets a silent or unrecoverable state: a recheck (or, for {@link SURFACE_CLOSED}, an
 * automatic reopen of the same in-memory run) resumes the run. The seller-facing projection reuses the Action
 * Window {@link BlockerCode} vocabulary ({@link failureStateToBlocker}) so the existing blocker → panel → card
 * path renders each one with its own repair.
 */

import { type BlockerCode } from "../../action-window/v2/index";

/**
 * The ordered pipeline a guided acquisition run walks, from the press to visible guidance. Instrumentation
 * emits one sanitized marker per boundary; the LAST marker seen is where a silent run stopped. `SELF_CHECK`
 * runs before any run/`runId` exists (backend/bridge/origin/agent pre-flight); the rest are per-run.
 */
export const ACQUISITION_STAGES = [
  "SELF_CHECK",
  "SURFACE_OPEN",
  "SESSION_PROBE",
  "PREPARE",
  "SURFACE_SETTLE",
  "GUIDANCE_PACK",
  "OVERLAY_MOUNT",
  "OVERLAY_VISIBLE",
  "READY",
] as const;
export type AcquisitionStage = (typeof ACQUISITION_STAGES)[number];

/**
 * The eight ways a guided acquisition run can stall between the press and visible guidance. Each is the
 * terminal classification for a run that did not reach the seller, and each was a *silent* outcome before this
 * slice named it:
 *
 *  - `SURFACE_OPEN_FAILED` — the marketplace window could not be opened or raised (a swallowed `presentSurface`
 *    / `openSurface` failure).
 *  - `SESSION_NOT_READY` — the opened surface carries no usable session (login required / expired). The one
 *    state that maps back to the existing session blockers rather than a new one.
 *  - `PREPARE_NOT_STARTED` — the drive loop never entered `PREPARE`: the run accepted the command but the
 *    surface work never began within its window (the exact "no PREPARE log, idle CPU" shape from the first
 *    live proof).
 *  - `SURFACE_SETTLE_TIMEOUT` — `PREPARE` ran but the export grid / date controls never hydrated within the
 *    bounded settle window.
 *  - `GUIDANCE_PACK_REJECTED` — the FE-authored guidance pack failed shape validation, so no copy could be
 *    shown. Previously logged and dropped in silence.
 *  - `OVERLAY_MOUNT_FAILED` — mounting the in-page overlay threw (a navigating/closed page).
 *  - `OVERLAY_NOT_VISIBLE` — the overlay mount ran but painted nothing the seller can see (target absent /
 *    off-screen / zero-size) — the "logged in, no highlight" shape.
 *  - `SURFACE_CLOSED` — the seller closed the marketplace window mid-run; the run used to park at a human
 *    barrier forever with no signal.
 */
export const ACQUISITION_FAILURE_STATES = [
  "SURFACE_OPEN_FAILED",
  "SESSION_NOT_READY",
  "PREPARE_NOT_STARTED",
  "SURFACE_SETTLE_TIMEOUT",
  "GUIDANCE_PACK_REJECTED",
  "OVERLAY_MOUNT_FAILED",
  "OVERLAY_NOT_VISIBLE",
  "SURFACE_CLOSED",
] as const;
export type AcquisitionFailureState = (typeof ACQUISITION_FAILURE_STATES)[number];

/**
 * The terminal classification of one guided acquisition run: either it reached the seller (`OK`) or it stalled
 * in exactly one {@link AcquisitionFailureState}. The adversarial root-cause loop requires every run to end in
 * one of these — there is no "unknown" outcome, because an un-attributable run is discarded, not recorded.
 */
export type AcquisitionOutcome = "OK" | AcquisitionFailureState;

/**
 * The stage a failure state belongs to — total and deterministic. `SURFACE_CLOSED` can happen at any point
 * after the window opens; it is anchored to `SURFACE_OPEN` because reopening the window is its repair.
 */
export function stageForFailure(state: AcquisitionFailureState): AcquisitionStage {
  switch (state) {
    case "SURFACE_OPEN_FAILED":
      return "SURFACE_OPEN";
    case "SESSION_NOT_READY":
      return "SESSION_PROBE";
    case "PREPARE_NOT_STARTED":
      return "PREPARE";
    case "SURFACE_SETTLE_TIMEOUT":
      return "SURFACE_SETTLE";
    case "GUIDANCE_PACK_REJECTED":
      return "GUIDANCE_PACK";
    case "OVERLAY_MOUNT_FAILED":
      return "OVERLAY_MOUNT";
    case "OVERLAY_NOT_VISIBLE":
      return "OVERLAY_VISIBLE";
    case "SURFACE_CLOSED":
      return "SURFACE_OPEN";
    default: {
      // Exhaustiveness: a new failure state that isn't anchored is a compile error, not a silent fall-through.
      const _exhaustive: never = state;
      void _exhaustive;
      return "SELF_CHECK";
    }
  }
}

/**
 * The seller-facing {@link BlockerCode} a failure state projects to, so the existing blocker → panel → card
 * path renders it with a repair. Six map to their own same-named codes; `SESSION_NOT_READY` deliberately maps
 * to the existing `SESSION_EXPIRED` (a login/expired session already has a repair, and the precise
 * `LOGIN_REQUIRED` vs `SESSION_EXPIRED` split is decided at the emit site — this is the generic representative).
 */
export function failureStateToBlocker(state: AcquisitionFailureState): BlockerCode {
  switch (state) {
    case "SESSION_NOT_READY":
      return "SESSION_EXPIRED";
    case "SURFACE_OPEN_FAILED":
      return "SURFACE_OPEN_FAILED";
    case "PREPARE_NOT_STARTED":
      return "PREPARE_NOT_STARTED";
    case "SURFACE_SETTLE_TIMEOUT":
      return "SURFACE_SETTLE_TIMEOUT";
    case "GUIDANCE_PACK_REJECTED":
      return "GUIDANCE_PACK_REJECTED";
    case "OVERLAY_MOUNT_FAILED":
      return "OVERLAY_MOUNT_FAILED";
    case "OVERLAY_NOT_VISIBLE":
      return "OVERLAY_NOT_VISIBLE";
    case "SURFACE_CLOSED":
      return "SURFACE_CLOSED";
    default: {
      const _exhaustive: never = state;
      void _exhaustive;
      return "UNSUPPORTED_STATE";
    }
  }
}

/**
 * Every reliability failure is recoverable — the product guarantee that the seller never meets a dead end. A
 * total-true function rather than a bare `true` so the contract states the invariant explicitly and a future
 * non-recoverable state would have to change this deliberately.
 */
export function isRecoverable(state: AcquisitionFailureState): boolean {
  return ACQUISITION_FAILURE_STATES.includes(state);
}

/**
 * The single variable an adversarial root-cause run is allowed to change from the frozen baseline. The loop's
 * discipline: hold account / profile / guidance pack / entry point fixed, vary exactly ONE of these per run, so
 * any difference in the terminal {@link AcquisitionOutcome} attributes to that one axis. A run whose difference
 * cannot be attributed to a single axis is discarded, never recorded as evidence.
 */
export const ADVERSARIAL_VARIABLES = [
  "TIMING",
  "SESSION_FRESHNESS",
  "OVERLAY_TIMING",
  "NAVIGATION",
  "RECHECK",
] as const;
export type AdversarialVariable = (typeof ADVERSARIAL_VARIABLES)[number];
