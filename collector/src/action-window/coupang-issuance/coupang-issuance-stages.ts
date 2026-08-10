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
 *  - **It touches nothing.** The seller logs in to WING and performs every real step themselves: 발급, the
 *    purpose option, 확인, the two consent boxes, the key-creating button, and copying the credential into
 *    SellerOps's own masked form. The runtime observes a sanitized PAGE CATEGORY, highlights the one control to
 *    press next, watches the seller's own click, and advances. It never logs in, clicks, types, submits, issues
 *    a key, or reads any credential VALUE. It reaches the ordinary `COMPLETED` terminal — where "completed"
 *    means the GUIDANCE finished, not that a credential was stored.
 *  - **It is LINEAR — no branch.** A fixed 8-step line.
 *
 * **THE FLOW, MEASURED (2026-08-10, five granted READ_ONLY runs). This replaces a plan that was wrong in three
 * places and fail-open in one.** See `docs/coupang_wing_openapi_issuance_flow_discovery_v1.md`.
 *
 * ```
 * open-API page  →  발급  →  PURPOSE screen  →  확인  →  TERMS screen  →  약관 동의 및 Key 발급받기  →  keys
 *                            OPEN API (default)          2 consent boxes        ↑ THIS creates the key
 * ```
 *
 * What the old plan got wrong, each corrected from a measurement rather than from prose:
 *
 *   1. **`자체개발` is not on the screen.** The purpose screen offers `OPEN API` and `플레이오토 웹 솔루션`, both
 *      measured by exact accessible-name match, and `OPEN API` is the DEFAULT selection. The stage is renamed
 *      `guiding_purpose_option`, because a stage called `self_dev` for a screen with no 자체개발 on it is the
 *      name-versus-meaning drift this workstream keeps having to unpick.
 *   2. **`업체명` / `호출 IP` have no screen in this flow.** Their labels match hidden nodes only, on every
 *      reading of every screen across five runs — they exist in the DOM and are never shown. `guiding_vendor_info`
 *      and `guiding_call_ip` are REMOVED: a stage that parks the seller in front of fields that do not exist
 *      cannot be completed, and the tutorial would deadlock there.
 *   3. **발급 does not create the key, and neither does 확인.** 발급 opens the purpose screen; 확인 opens the
 *      terms screen (measured cleanly: two readings with nothing pressed stayed on PURPOSE, and one 확인 press
 *      moved to TERMS). The key is created by `약관 동의 및 Key 발급받기` on the terms screen — a control the old
 *      plan had no stage for at all, which is how it advanced from `checkpoint_before_issue` straight to
 *      `guiding_copy_keys` and told the seller to copy keys that did not exist yet.
 *
 * **`checkpoint_before_issue` keeps its name and finally means it.** It is the barrier in front of
 * `약관 동의 및 Key 발급받기` — {@link WING_KEY_CREATION_CONTROL_ID} — the one control in this flow that mutates
 * marketplace state. The runtime highlights it and RESTS; the seller presses it; nothing auto-advances.
 *
 * **Two consents, never bundled.** The terms screen's checkboxes carry NO accessible name — `nameSource: NONE`,
 * no `label[for]`, no wrapping label — and neither consent sentence is unique on the page. Their pairing with
 * the two sentences is a MEASURED structural one (each box's immediate parent holds exactly one sentence and
 * exactly one box), not an accessible association. The tutorial may point at each block; it may not claim the
 * label is wired to the input, and it never ticks, reads, evaluates, or agrees to anything on the seller's
 * behalf.
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
  /**
   * Seller CHECKPOINT: the `API Key 발급 받기` control is highlighted and the run RESTS. The seller presses it
   * themselves. MEASURED: this press opens the purpose screen. It does NOT create a key — the old plan's
   * central error — and reaching this stage is not evidence that one exists.
   */
  | "checkpoint_reveal_issuance_form"
  /**
   * Seller barrier (checkpoint): the purpose screen. MEASURED: two radios, `OPEN API` and `플레이오토 웹 솔루션`,
   * and `OPEN API` is already the DEFAULT — so for the SellerOps flow this step usually needs no click at all
   * and the tutorial says so. Renamed from `guiding_self_dev`: 자체개발 is not on this screen.
   */
  | "guiding_purpose_option"
  /**
   * Seller CHECKPOINT: they press `확인`. MEASURED 2026-08-10 in isolation — two readings with nothing pressed
   * stayed on the purpose screen, and one 확인 press moved to the terms screen. It creates no key.
   */
  | "checkpoint_confirm_purpose"
  /**
   * Seller barrier (checkpoint): the TERMS screen's two consent boxes. The seller reads the terms and decides;
   * SellerOps does not read, evaluate, agree to, or advise on them, and never ticks a box or reads `checked`.
   */
  | "guiding_terms_consent"
  /**
   * **Seller CHECKPOINT — THE KEY-CREATION BOUNDARY.** `약관 동의 및 Key 발급받기` is highlighted and the run
   * RESTS. The seller presses it themselves; the runtime never clicks it and this never auto-advances.
   *
   * The stage kept its name through two corrections and now finally means it: this is the barrier in front of
   * the one control in the flow that mutates marketplace state. MEASURED: that control is unique among painting
   * elements under a `button,a` query, while sharing its exact text with the screen's heading — so it cannot be
   * located by text alone, and the tutorial must not try.
   *
   * Passing it is still not proof a key was created: the runtime reads no credential value and
   * `wingIssuedStateFrom` remains `NO_DISCRIMINATING_SIGNAL` on this surface.
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
  "checkpoint_reveal_issuance_form",
  "guiding_purpose_option",
  "checkpoint_confirm_purpose",
  "guiding_terms_consent",
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
 * The step plan. Exactly EIGHT steps — a fixed line (no branch), so `totalSteps` is stable from the frontend's
 * first view onward. Step 1 is AUTOMATIC_OPERATION and carries no highlighted control (its transition-observe
 * uses text guidance, not a DOM control). Every other step is a control the SELLER operates.
 *
 * **The order is the measured order**, which the previous seven-step plan was not: it put 발급 fifth, after two
 * steps for fields this flow never shows, and had no step at all for the control that creates the key.
 *
 * **Step 6 is the key-creation boundary.** It is the last step SellerOps can guide without a credential
 * existing, and the runtime rests there.
 */
export function coupangIssuanceStepPlan(): readonly CoupangIssuanceStepMeta[] {
  return [
    { stepNumber: 1, stepId: "aw.coupang_issuance_reach_open_api", copyKey: "actionWindow.coupangIssuance.reachOpenApi", mode: "AUTOMATIC_OPERATION" },
    { stepNumber: 2, stepId: "aw.coupang_issuance_reveal_form", copyKey: "actionWindow.coupangIssuance.revealForm", mode: "ACTION_WINDOW", copyParams: { targetKind: "issue" } },
    { stepNumber: 3, stepId: "aw.coupang_issuance_purpose_option", copyKey: "actionWindow.coupangIssuance.purposeOption", mode: "ACTION_WINDOW", copyParams: { targetKind: "purpose_option" } },
    { stepNumber: 4, stepId: "aw.coupang_issuance_confirm_purpose", copyKey: "actionWindow.coupangIssuance.confirmPurpose", mode: "ACTION_WINDOW", copyParams: { targetKind: "confirm_purpose" } },
    { stepNumber: 5, stepId: "aw.coupang_issuance_terms_consent", copyKey: "actionWindow.coupangIssuance.termsConsent", mode: "ACTION_WINDOW", copyParams: { targetKind: "terms_consent" } },
    { stepNumber: 6, stepId: "aw.coupang_issuance_issue_checkpoint", copyKey: "actionWindow.coupangIssuance.issueCheckpoint", mode: "ACTION_WINDOW", copyParams: { targetKind: "issue_final" } },
    { stepNumber: 7, stepId: "aw.coupang_issuance_copy_keys", copyKey: "actionWindow.coupangIssuance.copyKeys", mode: "ACTION_WINDOW", copyParams: { targetKind: "credentials" } },
    { stepNumber: 8, stepId: "aw.coupang_issuance_return", copyKey: "actionWindow.coupangIssuance.return", mode: "ACTION_WINDOW", copyParams: { targetKind: "return" } },
  ];
}

/** The fixed total — eight. */
export const COUPANG_ISSUANCE_TOTAL_STEPS = coupangIssuanceStepPlan().length;

/**
 * **The step at which the seller creates the key**, named once so no layer has to count.
 *
 * Everything before it is reversible: the seller can cancel out of the purpose or terms screen and nothing has
 * happened. From this step on, a credential may exist on the marketplace. Any future automation, retry, or
 * "resume from step N" has to treat this number as a wall.
 */
export const COUPANG_ISSUANCE_KEY_CREATION_STEP = 6;

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
    case "checkpoint_reveal_issuance_form":
    case "guiding_purpose_option":
    case "checkpoint_confirm_purpose":
    case "guiding_terms_consent":
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
    case "checkpoint_reveal_issuance_form":
    case "guiding_purpose_option":
    case "checkpoint_confirm_purpose":
    case "guiding_terms_consent":
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
