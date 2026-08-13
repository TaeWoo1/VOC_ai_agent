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
 * open-API page → 발급 → PURPOSE → 확인 → TERMS → 약관 동의 및 Key 발급받기 → VENDOR METHOD → 확인 → keys
 *                    OPEN API (default)   2 consents                        자체개발(직접입력)   ↑ ISSUES THE KEY
 *                                                                                             (operator-reported)
 *                                                                          업체명 · URL · IP
 * ```
 *
 * **The `???` is real, and it is where the key is actually issued.** Until 2026-08-12 this diagram ended
 * `약관 동의 및 Key 발급받기 → keys` with "↑ THIS creates the key". It does not: the control was pressed on a
 * live walk and no key was issued. An integration-method screen follows it (`업체 입력 방식` / `연동업체 선택`
 * / `자체개발(직접입력)` / `업체명` / `취소` `확인`), and the operator reports the key is issued by THAT screen's
 * `확인`. See `WING_KEY_CREATION_CONTROL_REFUTATION`. No apparatus has read that screen, so it is not modelled
 * here and the plan below deliberately stops short of it.
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
  /**
   * Observed wait: WING shows a login page. The seller logs in on their own screen and the runtime notices by
   * itself — it no longer needs a command from the SellerOps tab to look again.
   */
  | "waiting_login"
  /**
   * Observed wait: no WING surface the tutorial recognizes is on screen YET.
   *
   * The dedicated window opens on a blank tab, so this is where every run begins. It used to be
   * `page_mismatch`, which told a seller who had not logged in that the screen had changed unexpectedly and
   * then waited for a command that could only be sent from the tab they had just left. Not being there yet is
   * the expected state, so it carries no blocker and clears itself.
   */
  | "awaiting_wing_surface"
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
  /**
   * Seller barrier (checkpoint): the VENDOR-METHOD screen's input-method choice. The runtime rings
   * `자체개발(직접입력)` — the product owner's decision, taken with the measurement in front of them — and rests.
   * The seller selects it themselves; SellerOps selects nothing and reads no `checked`.
   *
   * MEASURED 2026-08-12: two radios in one group, both named by `label[for]`, both resolving to exactly one
   * painting `LABEL`. Selecting one revealed 업체명 · URL · IP 주소 — the last part of the product owner's
   * original flow description, and the first time any apparatus had seen those fields paint.
   */
  | "guiding_vendor_method"
  /**
   * **Seller CHECKPOINT — THE KEY-CREATION BOUNDARY, and this time the name is measured.** The vendor screen's
   * `확인` is highlighted and the run RESTS. The seller presses it themselves; the runtime never clicks it.
   *
   * This is where a real marketplace credential comes into existence. `checkpoint_before_issue`
   * held this name for two corrections while the control it guarded turned out not to create anything; the
   * boundary is here.
   *
   * It DOES advance itself — on WING then showing the credentials, which is an observation of the RESULT and
   * never of the press. Nothing about that observation causes the issuance.
   */
  | "checkpoint_issue_key"
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
  "checkpoint_confirm_purpose",
  "guiding_terms_consent",
  "checkpoint_before_issue",
  "guiding_vendor_method",
  "checkpoint_issue_key",
  "guiding_copy_keys",
  "return_to_sellerops",
];

/**
 * The recoverable parks. Each is a place the run stopped resting on the SELLER (log in, get to the page, make
 * the control appear) — never a failure. A `REQUEST_STEP_RECHECK` re-probes / re-guides the surface.
 */
export const COUPANG_ISSUANCE_PARK_STAGES: readonly CoupangIssuanceStage[] = ["waiting_login", "target_not_found", "page_mismatch"];

/**
 * **The OBSERVED WAITS — the runtime is watching WING, and the seller is not blocked on anything.**
 *
 * They carry no blocker and clear themselves, so they are deliberately NOT parks. But "clears itself" is only
 * true while something is still watching: the wait is bounded by a seated-operator window, and when that window
 * expires the run has to stay recoverable. It did not — `awaiting_wing_surface` fell through to the
 * automatic-stage command list, which omits `REQUEST_STEP_RECHECK`, so a seller who needed longer than the
 * window (2FA, a password reset) was left in a run reporting RUNNING with no blocker and no way to ask again.
 * The park this stage replaced was recoverable; this list is what makes the wait recoverable too.
 *
 * `waiting_login` is an observed wait as well, but it is listed among the PARKS (it carries a `LOGIN_REQUIRED`
 * blocker), and the two branches offer the same commands, so it is not repeated here.
 */
export const COUPANG_ISSUANCE_OBSERVED_WAIT_STAGES: readonly CoupangIssuanceStage[] = ["awaiting_wing_surface"];

export function isCoupangIssuanceBarrier(stage: CoupangIssuanceStage): boolean {
  return COUPANG_ISSUANCE_BARRIER_STAGES.includes(stage);
}
export function isCoupangIssuancePark(stage: CoupangIssuanceStage): boolean {
  return COUPANG_ISSUANCE_PARK_STAGES.includes(stage);
}
export function isCoupangIssuanceObservedWait(stage: CoupangIssuanceStage): boolean {
  return COUPANG_ISSUANCE_OBSERVED_WAIT_STAGES.includes(stage);
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
 * first view onward. Step 1 is AUTOMATIC_OPERATION and carries no highlighted control (its transition-observe
 * uses text guidance, not a DOM control). Every other step is a control the SELLER operates.
 *
 * **The order is the measured order**, which the previous seven-step plan was not: it put 발급 fifth, after two
 * steps for fields this flow never shows, and had no step at all for the control that creates the key.
 *
 * **Step 5 is the key-creation boundary.** It is the last step SellerOps can guide without a credential
 * existing, and the runtime rests there.
 */
export function coupangIssuanceStepPlan(): readonly CoupangIssuanceStepMeta[] {
  return [
    { stepNumber: 1, stepId: "aw.coupang_issuance_reach_open_api", copyKey: "actionWindow.coupangIssuance.reachOpenApi", mode: "AUTOMATIC_OPERATION" },
    { stepNumber: 2, stepId: "aw.coupang_issuance_reveal_form", copyKey: "actionWindow.coupangIssuance.revealForm", mode: "ACTION_WINDOW", copyParams: { targetKind: "issue" } },
    { stepNumber: 3, stepId: "aw.coupang_issuance_confirm_purpose", copyKey: "actionWindow.coupangIssuance.confirmPurpose", mode: "ACTION_WINDOW", copyParams: { targetKind: "confirm_purpose" } },
    { stepNumber: 4, stepId: "aw.coupang_issuance_terms_consent", copyKey: "actionWindow.coupangIssuance.termsConsent", mode: "ACTION_WINDOW", copyParams: { targetKind: "terms_consent" } },
    { stepNumber: 5, stepId: "aw.coupang_issuance_issue_checkpoint", copyKey: "actionWindow.coupangIssuance.issueCheckpoint", mode: "ACTION_WINDOW", copyParams: { targetKind: "issue_final" } },
    { stepNumber: 6, stepId: "aw.coupang_issuance_vendor_method", copyKey: "actionWindow.coupangIssuance.vendorMethod", mode: "ACTION_WINDOW", copyParams: { targetKind: "vendor_method" } },
    { stepNumber: 7, stepId: "aw.coupang_issuance_vendor_confirm", copyKey: "actionWindow.coupangIssuance.vendorConfirm", mode: "ACTION_WINDOW", copyParams: { targetKind: "vendor_confirm" } },
    // The LAST step. Its ids keep the `copy_keys` spelling: they are a stable FE contract, and renaming a
    // copyKey silently drops the panel's text if any consumer lags. What the step SAYS changed completely —
    // it no longer asks the seller to copy anything — and its CTA performs the return that step 9 used to.
    { stepNumber: 8, stepId: "aw.coupang_issuance_copy_keys", copyKey: "actionWindow.coupangIssuance.copyKeys", mode: "ACTION_WINDOW", copyParams: { targetKind: "credentials" } },
  ];
}

/** The fixed total — eight. */
export const COUPANG_ISSUANCE_TOTAL_STEPS = coupangIssuanceStepPlan().length;

/**
 * **The step at which a real API key comes into existence.** Step 7 — the vendor-method screen's `확인`.
 *
 * **It said 5 until 2026-08-12, and 5 was never right.** That step is the checkpoint in front of
 * `약관 동의 및 Key 발급받기`, a control asserted from its label to create the key and never observed doing it.
 * It was pressed on two live walks and issued none; the screen it opens was then measured
 * (`WING_VENDOR_METHOD_SCREEN_EVIDENCE`), and the key is created by that screen's `확인`.
 *
 * The constant kept its name through the correction rather than being renamed to something hedged. **What is
 * measured is the SCREEN, not the consequence**: two checkpoints established that this screen exists, what it
 * is made of, and that its `확인` resolves to exactly one painting BUTTON. That its press creates the key is the
 * operator's report, and the apparatus cannot corroborate it — an issued surface and a no-key one are measurably
 * indistinguishable to every signal it captures (`WING_KEY_ABSENCE_ATTRIBUTION`). The live WRITE run is what
 * settles it.
 *
 * So the value is where the evidence points and the name finally matches the value; neither is a measurement of
 * the consequence, and treating this step as "a key may now exist" is the safer error either way.
 *
 * **What a consumer may rely on:** everything BEFORE this step is reversible — the seller can cancel out of the
 * purpose, terms or vendor screen and nothing has happened. Everything from this step on may have produced a
 * credential. The walk still reads no credential VALUE, so `wingIssuedStateFrom` stays
 * `NO_DISCRIMINATING_SIGNAL` on the issuance surface; "a key may exist" is a fact about the STEP, never a
 * reading of one.
 */
export const COUPANG_ISSUANCE_KEY_CREATION_STEP = 7;

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
    // An observed wait is WORK the runtime is doing (watching WING), not the seller being blocked — so it reads
    // as RUNNING. Reporting WAITING_FOR_HUMAN here would put a "do something" prompt in front of a seller whose
    // only remaining task is to keep going in the window they are already in.
    case "awaiting_wing_surface":
      return "RUNNING";
    case "waiting_login":
    case "reaching_open_api":
    case "checkpoint_reveal_issuance_form":
    case "checkpoint_confirm_purpose":
    case "guiding_terms_consent":
    case "checkpoint_before_issue":
    case "guiding_vendor_method":
    case "checkpoint_issue_key":
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
    case "awaiting_wing_surface":
      return "OBSERVING";
    case "waiting_login":
    case "reaching_open_api":
    case "checkpoint_reveal_issuance_form":
    case "checkpoint_confirm_purpose":
    case "guiding_terms_consent":
    case "checkpoint_before_issue":
    case "guiding_vendor_method":
    case "checkpoint_issue_key":
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
 *
 * <p>An OBSERVED WAIT gets the park's list for the same reason: the runtime is looking by itself, so the button
 * is never NEEDED — but the seller must always be able to say "look again", or a wait whose window has elapsed
 * is a dead end.
 */
export function coupangIssuanceAllowedCommands(stage: CoupangIssuanceStage): readonly CommandType[] {
  // TERMINAL keeps exactly one command, and only this one: `FIND_CURRENT_STEP` — "show me where I am".
  //
  // It was the empty list, which is right about every command that DOES something and wrong about this one. The
  // walk ends with the seller's Access Key on a WING window SellerOps opened; losing that window behind the
  // others is the same problem at the end as in the middle, and it is worse there, because the keys are shown
  // once. A completed run that cannot bring its own window back tells the seller to go and find it themselves.
  //
  // Safe by construction rather than by intent: the command performs no step, completes nothing, and cannot
  // open anything — `LazyCoupangIssuanceDriver.focusSurface` refuses unless a window is ALREADY open, so a run
  // whose window the seller closed answers `false` instead of launching a marketplace window at the end of it.
  if (isCoupangIssuanceTerminal(stage)) return ["FIND_CURRENT_STEP"];
  if (isCoupangIssuancePark(stage) || isCoupangIssuanceObservedWait(stage)) {
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
