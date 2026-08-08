/**
 * **Coupang WING API-issuance guidance stages & v2 contract mapping (ISOLATED).**
 *
 * The internal state machine for ONE guided Coupang WING open-API issuance walk, and the only place it maps onto
 * the v2 contract's enums. A separate module from the NAVER `../api-issuance/issuance-stages.ts` (same v2
 * `API_ISSUANCE_GUIDANCE` intent, different channel choreography), for the same reason the reply/import/export
 * runtimes are separate: the audited runtimes stay untouched.
 *
 * **What a Coupang issuance run is, and how it differs from NAVER's:**
 *
 *  - **It touches nothing.** The seller logs in to WING, reaches the open-API issuance page, selects 자체개발,
 *    confirms 업체명, sets the 호출 IP, presses 발급 to issue the key themselves, and copies the Access Key /
 *    Secret Key / 업체코드 into SellerOps's own masked form — every real step theirs. The runtime observes a
 *    sanitized PAGE CATEGORY, highlights the one control to press next, watches the seller's own click, and
 *    advances. It never logs in, clicks, types, submits, issues a key, or reads any credential VALUE. So, like
 *    NAVER's, it reaches the ordinary `COMPLETED` terminal — where "completed" means the GUIDANCE finished, not
 *    that a credential was stored.
 *  - **It is LINEAR — no branch.** Unlike NAVER's existing-vs-new-app fork, the Coupang walk is a fixed 7-step
 *    line: reach the open-API page → 자체개발 → 업체명 → 호출 IP → 발급 checkpoint → copy the keys → return.
 *  - **`발급` (issue) is an explicit HUMAN CHECKPOINT.** The runtime highlights the 발급 button and RESTS; the
 *    seller presses it themselves. The runtime never clicks it and the step never auto-advances.
 *
 * ⚠ **THIS PLAN IS CONTRADICTED BY LIVE EVIDENCE (2026-08-08) AND IS NOT SAFE TO RUN.** Two claims above are
 * false against the real WING no-key surface:
 *
 *   1. *"자체개발 / 업체명 / 호출 IP … are SECTIONS on the one page"* — they are not. Read-only candidate sweeps on
 *      the real no-key open-API surface matched **0 for `자체개발` and `호출 IP` in every spelling tried**, and
 *      `업체명` never resolved uniquely (8 / 4 / 0 across structural queries). `발급` and `Access Key` each
 *      matched exactly 1 on the same page. The form fields are on a LATER screen.
 *   2. *"the seller presses 발급 to issue the key"* — on the official Coupang flow 발급 opens the 연동 방식 /
 *      configuration step, and the key is created by a later `확인`. This plan therefore advances from
 *      `checkpoint_before_issue` straight to `guiding_copy_keys`, i.e. past a barrier nobody crossed, and tells
 *      the seller to copy keys that do not exist yet. That is fail-open on the one step that mutates
 *      marketplace state.
 *
 * The plan is deliberately left BYTE-UNCHANGED for now: its 7 stage identifiers are a product requirement the
 * frontend keys tutorial copy off, and the correct ordering cannot be written without observing the Stage-2
 * screen. `COUPANG_WING_ISSUANCE_FORM_REVEAL` (`coupang-wing-reveal-driver.ts`) exists to observe it under its
 * own grant, with 발급 modelled as `REVEAL_WING_ISSUANCE_CONFIGURATION` rather than as key creation. Restructure
 * this plan only from that live evidence — never from the prose above. See
 * `docs/coupang_wing_issuance_form_reveal_v1.md`.
 *  - **Its parks recover by re-probing / re-guiding.** A login gate, a control it cannot find, or a page it did
 *    not expect all PARK recoverably; a `REQUEST_STEP_RECHECK` re-reads the page from the top (or re-guides a
 *    same-page checkpoint in place). None of them is a failure.
 *
 * Pure: no I/O, no browser, no time source.
 */
import type { CommandType, CopyParams, ExecutionMode, RunStatus, StepStatus } from "../../../../contracts/action-window/v2/index";

/**
 * The 14 stages of a guided Coupang WING issuance walk. The names are a hard product requirement — the frontend
 * agent keys tutorial copy off the same identifiers, so they may not be renamed.
 */
export type CoupangIssuanceStage =
  /** Automatic: the run has just started; the surface is about to be probed. */
  | "opening"
  /** Recoverable park: WING shows a login page. The seller logs in on their own screen. */
  | "waiting_login"
  /** Automatic (RUNNING): momentary work between the probe and the first guided control. */
  | "locating_open_api"
  /**
   * Seller barrier (transition-observe): guided by TEXT, the seller navigates from the WING home to the open-API
   * issuance page. The runtime OBSERVES the `wing_home → open_api_issuance` navigation and verifies the landing —
   * it highlights no specific menu row (that would need page identity). This is step 1's barrier when the seller
   * starts on the WING home; a seller already on the issuance page skips it (step 1 auto-completes).
   */
  | "reaching_open_api"
  /** Seller barrier (checkpoint): they select the 자체개발 (self-developed) option. */
  | "guiding_self_dev"
  /** Seller barrier (checkpoint): they confirm the 업체명 (vendor name / business info). */
  | "guiding_vendor_info"
  /** Seller barrier (checkpoint): they set the 호출 IP (call IP allow-list). */
  | "guiding_call_ip"
  /**
   * Seller CHECKPOINT: the 발급 (issue) button is highlighted and the run RESTS. The seller presses 발급
   * themselves — the runtime never clicks it, and this never auto-advances. An explicit human checkpoint; the
   * seller advances with SellerOps's own "다음".
   *
   * ⚠ **The stage NAME is fine; the old claim that this press "issues the key" was WRONG.** On the official
   * Coupang flow 발급 opens the configuration step and the key is created by a later `확인` — so this stage is
   * genuinely *before* issuance, but the stage that follows it here (`guiding_copy_keys`) does not exist yet at
   * that point. Do not treat reaching this stage as evidence that a key was created; the runtime cannot tell
   * either way (`wingIssuedStateFrom` ⇒ `NO_DISCRIMINATING_SIGNAL`).
   */
  | "checkpoint_before_issue"
  /** Seller barrier (checkpoint): they read + COPY the Access Key / Secret Key / 업체코드 (their highlighted
   * region). The runtime reads no value. */
  | "guiding_copy_keys"
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

export const COUPANG_ISSUANCE_TERMINAL_STAGES: readonly CoupangIssuanceStage[] = ["guidance_complete", "operator_aborted"];

/** The seller-barrier stages — the run rests on the seller until the driver observes their own click / "다음". */
export const COUPANG_ISSUANCE_BARRIER_STAGES: readonly CoupangIssuanceStage[] = [
  "reaching_open_api",
  "guiding_self_dev",
  "guiding_vendor_info",
  "guiding_call_ip",
  "checkpoint_before_issue",
  "guiding_copy_keys",
  "return_to_sellerops",
];

/**
 * The recoverable parks. Each is a place the run stopped resting on the SELLER (log in, get to the page, make
 * the control appear) — never a failure. A `REQUEST_STEP_RECHECK` re-probes / re-guides the surface.
 */
export const COUPANG_ISSUANCE_PARK_STAGES: readonly CoupangIssuanceStage[] = ["waiting_login", "target_not_found", "page_mismatch"];

export function isCoupangIssuanceBarrier(stage: CoupangIssuanceStage): boolean {
  return COUPANG_ISSUANCE_BARRIER_STAGES.includes(stage);
}
export function isCoupangIssuancePark(stage: CoupangIssuanceStage): boolean {
  return COUPANG_ISSUANCE_PARK_STAGES.includes(stage);
}
export function isCoupangIssuanceTerminal(stage: CoupangIssuanceStage): boolean {
  return COUPANG_ISSUANCE_TERMINAL_STAGES.includes(stage);
}

/* ────────────────────────────── the fixed 7-step plan ────────────────────────────── */

export interface CoupangIssuanceStepMeta {
  stepNumber: number;
  stepId: string;
  copyKey: string;
  mode: ExecutionMode;
  copyParams?: CopyParams;
}

export const COUPANG_ISSUANCE_RUN_COPY_KEY = "actionWindow.coupangIssuance.run";

/**
 * The step plan. Exactly SEVEN steps — a fixed line (no branch), so `totalSteps` is stable from the frontend's
 * first view onward. Step 1 (reach the open-API page) is AUTOMATIC_OPERATION and carries no highlighted control
 * (its reach_open_api transition-observe uses text guidance, not a DOM control). Step 5 (issue) is the human
 * checkpoint: the runtime highlights the 발급 button and the seller presses it themselves.
 */
export function coupangIssuanceStepPlan(): readonly CoupangIssuanceStepMeta[] {
  return [
    { stepNumber: 1, stepId: "aw.coupang_issuance_reach_open_api", copyKey: "actionWindow.coupangIssuance.reachOpenApi", mode: "AUTOMATIC_OPERATION" },
    { stepNumber: 2, stepId: "aw.coupang_issuance_self_dev", copyKey: "actionWindow.coupangIssuance.selfDev", mode: "ACTION_WINDOW", copyParams: { targetKind: "self_dev" } },
    { stepNumber: 3, stepId: "aw.coupang_issuance_vendor_info", copyKey: "actionWindow.coupangIssuance.vendorInfo", mode: "ACTION_WINDOW", copyParams: { targetKind: "vendor_info" } },
    { stepNumber: 4, stepId: "aw.coupang_issuance_call_ip", copyKey: "actionWindow.coupangIssuance.callIp", mode: "ACTION_WINDOW", copyParams: { targetKind: "call_ip" } },
    { stepNumber: 5, stepId: "aw.coupang_issuance_issue_checkpoint", copyKey: "actionWindow.coupangIssuance.issueCheckpoint", mode: "ACTION_WINDOW", copyParams: { targetKind: "issue" } },
    { stepNumber: 6, stepId: "aw.coupang_issuance_copy_keys", copyKey: "actionWindow.coupangIssuance.copyKeys", mode: "ACTION_WINDOW", copyParams: { targetKind: "credentials" } },
    { stepNumber: 7, stepId: "aw.coupang_issuance_return", copyKey: "actionWindow.coupangIssuance.return", mode: "ACTION_WINDOW", copyParams: { targetKind: "return" } },
  ];
}

/** The fixed total — seven. */
export const COUPANG_ISSUANCE_TOTAL_STEPS = coupangIssuanceStepPlan().length;

/** Step metadata at a 1-based index, clamped so a park/terminal view never reads past the plan. */
export function coupangIssuanceStepMetaAt(plan: readonly CoupangIssuanceStepMeta[], stepNumber: number): CoupangIssuanceStepMeta {
  const index = Math.min(Math.max(stepNumber, 1), plan.length) - 1;
  const meta = plan[index];
  if (!meta) throw new Error("coupang-issuance-stages: empty step plan");
  return meta;
}

/* ────────────────────────────── v2 enum mapping ────────────────────────────── */

export function coupangIssuanceStageToRunStatus(stage: CoupangIssuanceStage): RunStatus {
  switch (stage) {
    case "opening":
      return "PREPARING";
    case "locating_open_api":
      return "RUNNING";
    case "waiting_login":
    case "reaching_open_api":
    case "guiding_self_dev":
    case "guiding_vendor_info":
    case "guiding_call_ip":
    case "checkpoint_before_issue":
    case "guiding_copy_keys":
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

export function coupangIssuanceStageToStepStatus(stage: CoupangIssuanceStage): StepStatus {
  switch (stage) {
    case "opening":
      return "PREPARING";
    case "locating_open_api":
      return "OBSERVING";
    case "waiting_login":
    case "reaching_open_api":
    case "guiding_self_dev":
    case "guiding_vendor_info":
    case "guiding_call_ip":
    case "checkpoint_before_issue":
    case "guiding_copy_keys":
    case "return_to_sellerops":
    case "target_not_found":
    case "page_mismatch":
      return "AWAITING_USER";
    case "guidance_complete":
      return "COMPLETED";
    case "operator_aborted":
      // A cancelled run has no meaningful step status; PENDING is the safe, contract-valid value.
      return "PENDING";
  }
}

/**
 * Which commands the frontend may render, per stage.
 *
 * <p>`REQUEST_STEP_RECHECK` means "I did the thing, look again" and is offered at every seller barrier and every
 * recoverable park — at a park it is the repair (re-probe / re-guide). It NEVER completes a step on the client;
 * the runtime alone decides, by observing.
 *
 * <p>There is deliberately no command that logs in, clicks, submits, issues a key, or reads a credential. The
 * seller does all of that in their own window.
 *
 * <p>`PAUSE_RUN` is offered at the seller barriers but NOT at the parks (a park recovers only by re-probing).
 */
export function coupangIssuanceAllowedCommands(stage: CoupangIssuanceStage): readonly CommandType[] {
  if (isCoupangIssuanceTerminal(stage)) return [];
  if (isCoupangIssuancePark(stage)) {
    return ["REQUEST_STEP_RECHECK", "CANCEL_RUN", "SWITCH_TO_MANUAL", "SET_GUIDANCE_ENABLED", "FIND_CURRENT_STEP"];
  }
  if (isCoupangIssuanceBarrier(stage)) {
    return ["REQUEST_STEP_RECHECK", "PAUSE_RUN", "CANCEL_RUN", "SWITCH_TO_MANUAL", "SET_GUIDANCE_ENABLED", "FIND_CURRENT_STEP"];
  }
  // Automatic, non-terminal stages (opening / locating_open_api): momentary automatic work. The seller can
  // always cancel or leave for the manual path.
  return ["CANCEL_RUN", "SWITCH_TO_MANUAL", "SET_GUIDANCE_ENABLED", "FIND_CURRENT_STEP"];
}

/** The commands offered while the run is PAUSED (overlay on a barrier). */
export const COUPANG_ISSUANCE_PAUSED_COMMANDS: readonly CommandType[] = ["RESUME_RUN", "CANCEL_RUN"];
