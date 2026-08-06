/**
 * **Coupang WING API-credential RENEWAL guidance stages & v2 contract mapping (ISOLATED).**
 *
 * The internal state machine for ONE guided Coupang WING open-API **credential renewal** walk, and the only place
 * it maps onto the v2 contract's enums. A sibling of `../coupang-issuance/coupang-issuance-stages.ts` (same v2
 * `API_ISSUANCE_GUIDANCE` intent, a different — shorter — choreography), kept separate for the same reason the
 * issuance runtime is separate from NAVER's: the audited runtime stays untouched.
 *
 * **What a Coupang renewal run is, and how it differs from issuance:**
 *
 *  - **It touches nothing.** The seller logs in to WING, reaches the open-API page, CHECKS the `유효기간`
 *    (validity period) SellerOps highlights, presses `재발급` (re-issue) THEMSELVES at an explicit human
 *    checkpoint, and copies the NEW Access Key / Secret Key / 업체코드 into SellerOps's own masked form — every
 *    real step theirs. The runtime observes a sanitized PAGE CATEGORY, highlights the one section to look at next,
 *    and advances on the operator's own `다음`. It never logs in, clicks, types, submits, re-issues a key, or
 *    reads any credential VALUE (the new Secret Key is highlighted, never read).
 *  - **It is LINEAR — no branch.** A fixed 5-step line: reach the open-API page → check `유효기간` → `재발급`
 *    checkpoint → copy the new keys → return. (Issuance is 7: it also sets 자체개발 / 업체명 / 호출 IP.)
 *  - **`재발급` (re-issue) is an explicit HUMAN CHECKPOINT.** The runtime highlights the `재발급` button and RESTS;
 *    the seller presses it themselves. The runtime never clicks it and the step never auto-advances — mirroring
 *    the issuance `발급` checkpoint exactly.
 *  - **Its parks recover by re-probing / re-guiding**, identically to issuance.
 *
 * Pure: no I/O, no browser, no time source.
 */
import type { CommandType, CopyParams, ExecutionMode, RunStatus, StepStatus } from "../../../../contracts/action-window/v2/index";

/**
 * The 12 stages of a guided Coupang WING renewal walk. The names are keyed by the frontend for tutorial copy, so
 * they may not be renamed. Structurally identical to issuance minus the three issuance-only form checkpoints, plus
 * a `guiding_check_expiry` (highlight `유효기간`) and a `checkpoint_before_reissue` (the `재발급` human checkpoint).
 */
export type CoupangRenewalStage =
  /** Automatic: the run has just started; the surface is about to be probed. */
  | "opening"
  /** Recoverable park: WING shows a login page. The seller logs in on their own screen. */
  | "waiting_login"
  /** Automatic (RUNNING): momentary work between the probe and the first guided control. */
  | "locating_open_api"
  /**
   * Seller barrier (transition-observe): guided by TEXT, the seller navigates from the WING home to the open-API
   * page. The runtime OBSERVES the `wing_home → open_api_issuance` navigation and verifies the landing. A seller
   * already on the open-API page skips it (step 1 auto-completes).
   */
  | "reaching_open_api"
  /** Seller barrier (checkpoint): they read the highlighted `유효기간` (validity period). SellerOps reads no value here. */
  | "guiding_check_expiry"
  /**
   * Seller CHECKPOINT: the `재발급` (re-issue) button is highlighted and the run RESTS. The seller presses `재발급`
   * themselves — the runtime never clicks it, and this never auto-advances. An explicit human checkpoint; the
   * seller advances with SellerOps's own `다음`.
   */
  | "checkpoint_before_reissue"
  /** Seller barrier (checkpoint): they read + COPY the NEW Access Key / Secret Key / 업체코드 (their highlighted
   * region). The runtime reads no value. */
  | "guiding_copy_keys"
  /** Seller barrier: they return to SellerOps to paste the renewed credential into the masked form. */
  | "return_to_sellerops"
  /** Terminal: the guidance walk finished (NOT that a credential was stored or replaced). */
  | "guidance_complete"
  /** Recoverable park: the control the tutorial must highlight could not be found. */
  | "target_not_found"
  /** Recoverable park: the seller is on a page the tutorial did not expect. */
  | "page_mismatch"
  /** Terminal: the operator cancelled or left for the manual path. */
  | "operator_aborted";

export const COUPANG_RENEWAL_TERMINAL_STAGES: readonly CoupangRenewalStage[] = ["guidance_complete", "operator_aborted"];

/** The seller-barrier stages — the run rests on the seller until the driver observes their own click / `다음`. */
export const COUPANG_RENEWAL_BARRIER_STAGES: readonly CoupangRenewalStage[] = [
  "reaching_open_api",
  "guiding_check_expiry",
  "checkpoint_before_reissue",
  "guiding_copy_keys",
  "return_to_sellerops",
];

/** The recoverable parks. Each is a place the run stopped resting on the SELLER — never a failure. */
export const COUPANG_RENEWAL_PARK_STAGES: readonly CoupangRenewalStage[] = ["waiting_login", "target_not_found", "page_mismatch"];

export function isCoupangRenewalBarrier(stage: CoupangRenewalStage): boolean {
  return COUPANG_RENEWAL_BARRIER_STAGES.includes(stage);
}
export function isCoupangRenewalPark(stage: CoupangRenewalStage): boolean {
  return COUPANG_RENEWAL_PARK_STAGES.includes(stage);
}
export function isCoupangRenewalTerminal(stage: CoupangRenewalStage): boolean {
  return COUPANG_RENEWAL_TERMINAL_STAGES.includes(stage);
}

/* ────────────────────────────── the fixed 5-step plan ────────────────────────────── */

export interface CoupangRenewalStepMeta {
  stepNumber: number;
  stepId: string;
  copyKey: string;
  mode: ExecutionMode;
  copyParams?: CopyParams;
}

export const COUPANG_RENEWAL_RUN_COPY_KEY = "actionWindow.coupangRenewal.run";

/**
 * The step plan. Exactly FIVE steps — a fixed line (no branch), so `totalSteps` is stable from the frontend's
 * first view. Step 1 (reach the open-API page) is AUTOMATIC_OPERATION and carries no highlighted control. Step 3
 * (re-issue) is the human checkpoint: the runtime highlights `재발급` and the seller presses it themselves. The FE
 * keys its localized copy off `copyKey`, so these strings are a hard contract (report them to the FE).
 */
export function coupangRenewalStepPlan(): readonly CoupangRenewalStepMeta[] {
  return [
    { stepNumber: 1, stepId: "aw.coupang_renewal_reach_open_api", copyKey: "actionWindow.coupangRenewal.reachOpenApi", mode: "AUTOMATIC_OPERATION" },
    { stepNumber: 2, stepId: "aw.coupang_renewal_check_expiry", copyKey: "actionWindow.coupangRenewal.checkExpiry", mode: "ACTION_WINDOW", copyParams: { targetKind: "check_expiry" } },
    { stepNumber: 3, stepId: "aw.coupang_renewal_reissue_checkpoint", copyKey: "actionWindow.coupangRenewal.reissueCheckpoint", mode: "ACTION_WINDOW", copyParams: { targetKind: "reissue" } },
    { stepNumber: 4, stepId: "aw.coupang_renewal_copy_keys", copyKey: "actionWindow.coupangRenewal.copyKeys", mode: "ACTION_WINDOW", copyParams: { targetKind: "credentials" } },
    { stepNumber: 5, stepId: "aw.coupang_renewal_return", copyKey: "actionWindow.coupangRenewal.return", mode: "ACTION_WINDOW", copyParams: { targetKind: "return" } },
  ];
}

/** The fixed total — five. */
export const COUPANG_RENEWAL_TOTAL_STEPS = coupangRenewalStepPlan().length;

/** Step metadata at a 1-based index, clamped so a park/terminal view never reads past the plan. */
export function coupangRenewalStepMetaAt(plan: readonly CoupangRenewalStepMeta[], stepNumber: number): CoupangRenewalStepMeta {
  const index = Math.min(Math.max(stepNumber, 1), plan.length) - 1;
  const meta = plan[index];
  if (!meta) throw new Error("coupang-renewal-stages: empty step plan");
  return meta;
}

/* ────────────────────────────── v2 enum mapping ────────────────────────────── */

export function coupangRenewalStageToRunStatus(stage: CoupangRenewalStage): RunStatus {
  switch (stage) {
    case "opening":
      return "PREPARING";
    case "locating_open_api":
      return "RUNNING";
    case "waiting_login":
    case "reaching_open_api":
    case "guiding_check_expiry":
    case "checkpoint_before_reissue":
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

export function coupangRenewalStageToStepStatus(stage: CoupangRenewalStage): StepStatus {
  switch (stage) {
    case "opening":
      return "PREPARING";
    case "locating_open_api":
      return "OBSERVING";
    case "waiting_login":
    case "reaching_open_api":
    case "guiding_check_expiry":
    case "checkpoint_before_reissue":
    case "guiding_copy_keys":
    case "return_to_sellerops":
    case "target_not_found":
    case "page_mismatch":
      return "AWAITING_USER";
    case "guidance_complete":
      return "COMPLETED";
    case "operator_aborted":
      return "PENDING";
  }
}

/**
 * Which commands the frontend may render, per stage. Identical shape to issuance: `REQUEST_STEP_RECHECK` at every
 * barrier and every park (the repair); NO command that logs in, clicks, submits, re-issues a key, or reads a
 * credential. `PAUSE_RUN` at barriers, not parks.
 */
export function coupangRenewalAllowedCommands(stage: CoupangRenewalStage): readonly CommandType[] {
  if (isCoupangRenewalTerminal(stage)) return [];
  if (isCoupangRenewalPark(stage)) {
    return ["REQUEST_STEP_RECHECK", "CANCEL_RUN", "SWITCH_TO_MANUAL", "SET_GUIDANCE_ENABLED", "FIND_CURRENT_STEP"];
  }
  if (isCoupangRenewalBarrier(stage)) {
    return ["REQUEST_STEP_RECHECK", "PAUSE_RUN", "CANCEL_RUN", "SWITCH_TO_MANUAL", "SET_GUIDANCE_ENABLED", "FIND_CURRENT_STEP"];
  }
  return ["CANCEL_RUN", "SWITCH_TO_MANUAL", "SET_GUIDANCE_ENABLED", "FIND_CURRENT_STEP"];
}

/** The commands offered while the run is PAUSED (overlay on a barrier). */
export const COUPANG_RENEWAL_PAUSED_COMMANDS: readonly CommandType[] = ["RESUME_RUN", "CANCEL_RUN"];
