/**
 * **NAVER API-issuance guidance stages & v2 contract mapping (ISOLATED).**
 *
 * The internal state machine for ONE guided API-center onboarding walk, and the only place it maps onto
 * the v2 contract's enums. A separate module from `../stages.ts` (v1 export),
 * `../reply-submission/reply-stages.ts` (v2 reply), and `../initial-import/import-stages.ts` (v2 import),
 * for the same reason those are separate from each other: the audited runtimes stay untouched.
 *
 * **What an issuance run is, and how it differs from the other three:**
 *
 *  - **It touches nothing.** The seller logs in, opens or creates their Commerce API application, adds the
 *    API group, and copies the Application ID / Secret into SellerOps's own masked form — every real step is
 *    theirs. The runtime observes a sanitized PAGE CATEGORY, highlights the one control to press next, and
 *    watches the seller's own click. It never logs in, clicks, submits, auto-creates an application, selects
 *    an API group, or reads a credential VALUE. So, like an import, it reaches the ordinary `COMPLETED`
 *    terminal — where "completed" means the GUIDANCE finished, not that a credential was stored.
 *  - **It has a one-time branch at step 2.** A seller with an existing application OPENS it; a seller with
 *    none CREATES one. The branch changes only step 2's (and step 3's) copy, never the step count —
 *    `totalSteps` is a fixed 7 either way, exactly like import's always-present `CONFIRM_RANGE` slot, so a
 *    frontend showing "7단계 중 2" never sees the total shift under it. (The credential section is two steps —
 *    Application ID, then Application Secret — and step 3 is a text-only usage-state advisory present on both
 *    branches with branch-appropriate copy, so the total is 7 and still branch-invariant.)
 *  - **Its parks recover by re-probing.** A login gate, a control it cannot find, or a page it did not expect
 *    all PARK recoverably; a `REQUEST_STEP_RECHECK` re-reads the page category from the top (mirroring import's
 *    `SESSION_BLOCKED → PREPARE`). None of them is a failure.
 *
 * Pure: no I/O, no browser, no time source.
 */
import type { CommandType, CopyParams, ExecutionMode, RunStatus, StepStatus } from "../../../../contracts/action-window/v2/index";

/**
 * The 15 stages of a guided issuance walk. The names are a hard product requirement — the frontend agent
 * keys tutorial copy off the same identifiers, so they may not be renamed.
 */
export type IssuanceStage =
  /** Automatic: the run has just started; the surface is about to be probed. */
  | "opening"
  /** Recoverable park: the API center shows a login page. The seller logs in on their own screen. */
  | "waiting_login"
  /** Automatic: on the applications list, reading whether an application already exists. */
  | "locating_applications"
  /** Automatic (READY): an application exists — step 2 will guide OPENING it. */
  | "existing_app"
  /** Automatic (READY): no application exists — step 2 will guide CREATING one. */
  | "empty_state"
  /** Seller barrier: they press the "create application" control (empty branch). */
  | "guiding_create"
  /** Seller barrier: they press the API-group control on the application detail page. */
  | "guiding_api_group"
  /** Seller barrier: they read + COPY the Application ID (its highlighted row). The runtime reads no value. */
  | "guiding_application_id"
  /** Seller barrier: they view + COPY the Application Secret (its highlighted view/copy controls). No value read. */
  | "guiding_application_secret"
  /**
   * Seller barrier (existing branch): guided by TEXT ("open your app yourself"), they open their existing
   * application to reach its detail page. The runtime observes the `app_list → app_detail` navigation and
   * verifies the landing page — it highlights no specific app row (that would need the app's identity).
   */
  | "guiding_app_detail"
  /**
   * Seller barrier (text-only advisory): before touching the API group, the seller CONFIRMS their application
   * is usable. If NAVER shows a "다시사용" (reactivate) control they press it themselves; if it does not,
   * SellerOps still does NOT assert the app is active (absence ≠ active). This barrier highlights nothing,
   * locates nothing, and observes no NAVER action — it rests on a SellerOps "다음". Present on BOTH branches
   * (an existing app may be suspended; a just-created app is confirmed) with branch-appropriate copy.
   */
  | "guiding_app_usage_check"
  /** Seller barrier: they return to SellerOps to paste the credential into the masked form. */
  | "return_to_sellerops"
  /** Terminal: the guidance walk finished (NOT that a credential was stored or a connection made). */
  | "guidance_complete"
  /** Recoverable park: the control the tutorial must highlight could not be found. */
  | "target_not_found"
  /** Recoverable park: the seller is on a page the tutorial did not expect. */
  | "page_mismatch"
  /** Terminal: the operator cancelled or left for the manual path. */
  | "operator_aborted";

export const ISSUANCE_TERMINAL_STAGES: readonly IssuanceStage[] = ["guidance_complete", "operator_aborted"];

/** The seller-barrier stages — the run rests on the seller until the driver observes their own click. */
export const ISSUANCE_BARRIER_STAGES: readonly IssuanceStage[] = [
  "guiding_create",
  "guiding_app_detail",
  "guiding_app_usage_check",
  "guiding_api_group",
  "guiding_application_id",
  "guiding_application_secret",
  "return_to_sellerops",
];

/**
 * The recoverable parks. Each is a place the run stopped resting on the SELLER (log in, get to the page,
 * make the control appear) — never a failure. A `REQUEST_STEP_RECHECK` re-probes the surface from the top.
 */
export const ISSUANCE_PARK_STAGES: readonly IssuanceStage[] = ["waiting_login", "target_not_found", "page_mismatch"];

export function isIssuanceBarrier(stage: IssuanceStage): boolean {
  return ISSUANCE_BARRIER_STAGES.includes(stage);
}
export function isIssuancePark(stage: IssuanceStage): boolean {
  return ISSUANCE_PARK_STAGES.includes(stage);
}
export function isIssuanceTerminal(stage: IssuanceStage): boolean {
  return ISSUANCE_TERMINAL_STAGES.includes(stage);
}

/* ────────────────────────────── the fixed 7-step plan ────────────────────────────── */

export interface IssuanceStepMeta {
  stepNumber: number;
  stepId: string;
  copyKey: string;
  mode: ExecutionMode;
  copyParams?: CopyParams;
}

export const ISSUANCE_RUN_COPY_KEY = "actionWindow.issuance.run";

/**
 * The step plan. Exactly SEVEN steps, always — the existing-vs-empty branch reuses the step-2 and step-3 slots
 * rather than adding or removing one, so `totalSteps` is stable from the frontend's first view onward.
 *
 * Step 2 branches the APP: an existing application is OPENED (`open_app`), an absent one is CREATED
 * (`create_app`). Same `stepId`, same slot — different copy key and highlighted control. Step 3 is the text-only
 * USAGE-STATE advisory: it has NO `copyParams.targetKind` (nothing to highlight), and its copy branches too — an
 * existing app may be suspended (guide the seller to `다시사용`), a just-created app is confirmed active. Steps 5
 * and 6 are the credential section split in two: copy the Application ID (step 5), then view + copy the Secret
 * (step 6).
 */
export function issuanceStepPlan(hasExistingApp: boolean): readonly IssuanceStepMeta[] {
  return [
    { stepNumber: 1, stepId: "aw.issuance_reach_applications", copyKey: "actionWindow.issuance.reachApplications", mode: "AUTOMATIC_OPERATION" },
    hasExistingApp
      ? { stepNumber: 2, stepId: "aw.issuance_open_or_create_app", copyKey: "actionWindow.issuance.openApp", mode: "ACTION_WINDOW", copyParams: { targetKind: "open_app" } }
      : { stepNumber: 2, stepId: "aw.issuance_open_or_create_app", copyKey: "actionWindow.issuance.createApp", mode: "ACTION_WINDOW", copyParams: { targetKind: "create_app" } },
    // Step 3: text-only usage-state advisory (no targetKind → the runtime highlights/locates nothing). Branch-aware
    // copy: an existing app may be suspended (guide the seller to `다시사용`); a just-created app is confirmed.
    hasExistingApp
      ? { stepNumber: 3, stepId: "aw.issuance_app_usage_check", copyKey: "actionWindow.issuance.appUsageCheck", mode: "ACTION_WINDOW" }
      : { stepNumber: 3, stepId: "aw.issuance_app_usage_check", copyKey: "actionWindow.issuance.appUsageCheckNew", mode: "ACTION_WINDOW" },
    { stepNumber: 4, stepId: "aw.issuance_api_group", copyKey: "actionWindow.issuance.apiGroup", mode: "ACTION_WINDOW", copyParams: { targetKind: "api_group" } },
    // The credential section is TWO steps: copy the Application ID, then view+copy the Application Secret.
    { stepNumber: 5, stepId: "aw.issuance_application_id", copyKey: "actionWindow.issuance.applicationId", mode: "ACTION_WINDOW", copyParams: { targetKind: "application_id" } },
    { stepNumber: 6, stepId: "aw.issuance_application_secret", copyKey: "actionWindow.issuance.applicationSecret", mode: "ACTION_WINDOW", copyParams: { targetKind: "application_secret" } },
    { stepNumber: 7, stepId: "aw.issuance_return", copyKey: "actionWindow.issuance.return", mode: "ACTION_WINDOW", copyParams: { targetKind: "return" } },
  ];
}

/** The fixed total — seven, whichever branch steps 2 and 3 take. */
export const ISSUANCE_TOTAL_STEPS = issuanceStepPlan(false).length;

/** Step metadata at a 1-based index, clamped so a park/terminal view never reads past the plan. */
export function issuanceStepMetaAt(plan: readonly IssuanceStepMeta[], stepNumber: number): IssuanceStepMeta {
  const index = Math.min(Math.max(stepNumber, 1), plan.length) - 1;
  const meta = plan[index];
  if (!meta) throw new Error("issuance-stages: empty step plan");
  return meta;
}

/* ────────────────────────────── v2 enum mapping ────────────────────────────── */

export function issuanceStageToRunStatus(stage: IssuanceStage): RunStatus {
  switch (stage) {
    case "opening":
      return "PREPARING";
    case "locating_applications":
    case "existing_app":
    case "empty_state":
      return "RUNNING";
    case "waiting_login":
    case "guiding_create":
    case "guiding_app_detail":
    case "guiding_app_usage_check":
    case "guiding_api_group":
    case "guiding_application_id":
    case "guiding_application_secret":
    case "return_to_sellerops":
    case "target_not_found":
    case "page_mismatch":
      return "WAITING_FOR_HUMAN";
    case "guidance_complete":
      return "COMPLETED";
    case "operator_aborted":
      return "CANCELLED";
  }
}

export function issuanceStageToStepStatus(stage: IssuanceStage): StepStatus {
  switch (stage) {
    case "opening":
      return "PREPARING";
    case "locating_applications":
      return "OBSERVING";
    case "existing_app":
    case "empty_state":
      return "READY";
    case "waiting_login":
    case "guiding_create":
    case "guiding_app_detail":
    case "guiding_app_usage_check":
    case "guiding_api_group":
    case "guiding_application_id":
    case "guiding_application_secret":
    case "return_to_sellerops":
    case "target_not_found":
    case "page_mismatch":
      return "AWAITING_USER";
    case "guidance_complete":
      return "COMPLETED";
    case "operator_aborted":
      // A cancelled run has no meaningful step status ("—" in the plan table); PENDING is the safe,
      // contract-valid value and never claims progress.
      return "PENDING";
  }
}

/**
 * Which commands the frontend may render, per stage.
 *
 * <p>`REQUEST_STEP_RECHECK` means "I did the thing, look again" and is offered at every seller barrier and
 * every recoverable park — at a park it is the repair (re-probe the surface). It NEVER completes a step on
 * the client; the runtime alone decides, by observing.
 *
 * <p>There is deliberately no command that logs in, clicks, submits, creates an application, or reads a
 * credential. The seller does all of that in their own window.
 *
 * <p>`PAUSE_RUN` is offered at the seller barriers (as import offers it), but NOT at the parks: a park
 * recovers only by re-probing, and a pause there would have no barrier target to resume onto — exactly the
 * `SESSION_BLOCKED` reasoning in import. (The engine represents a pause as an overlay on the current barrier
 * rather than a 16th stage, and swaps `allowedCommands` to `[RESUME_RUN, CANCEL_RUN]` while paused.)
 */
export function issuanceAllowedCommands(stage: IssuanceStage): readonly CommandType[] {
  if (isIssuanceTerminal(stage)) return [];
  if (isIssuancePark(stage)) {
    return ["REQUEST_STEP_RECHECK", "CANCEL_RUN", "SWITCH_TO_MANUAL", "SET_GUIDANCE_ENABLED", "FIND_CURRENT_STEP"];
  }
  if (isIssuanceBarrier(stage)) {
    return ["REQUEST_STEP_RECHECK", "PAUSE_RUN", "CANCEL_RUN", "SWITCH_TO_MANUAL", "SET_GUIDANCE_ENABLED", "FIND_CURRENT_STEP"];
  }
  // Automatic, non-terminal stages (opening / locating_applications / existing_app / empty_state): the run
  // is doing momentary automatic work. The seller can always cancel or leave for the manual path.
  return ["CANCEL_RUN", "SWITCH_TO_MANUAL", "SET_GUIDANCE_ENABLED", "FIND_CURRENT_STEP"];
}

/** The commands offered while the run is PAUSED (overlay on a barrier). Mirrors import's PAUSED set. */
export const ISSUANCE_PAUSED_COMMANDS: readonly CommandType[] = ["RESUME_RUN", "CANCEL_RUN"];
