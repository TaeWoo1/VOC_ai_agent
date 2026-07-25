/**
 * **Initial-review-import stages & v2 contract mapping (ISOLATED).**
 *
 * The internal state machine for ONE guided monthly segment, and the only place it maps onto the v2
 * contract's enums. A separate module from `../stages.ts` (v1 export) and `../reply-submission/reply-stages.ts`
 * (v2 reply) for the same reason those are separate from each other: the audited runtimes are left untouched.
 *
 * **How an import run differs from the other two, and why each difference matters:**
 *
 *  - **It can reach `COMPLETED`.** Unlike a reply post, an import has a read-back oracle — a file was
 *    downloaded, parsed and ingested, and the server answers with row counts. So the terminal is a real
 *    completion, not an operator report.
 *  - **It has SIX seller barriers, not one.** Start date, end date, apply, (confirm), export, consent. The
 *    seller performs every one of those clicks on NAVER; the runtime highlights and observes.
 *  - **There is a gate in the middle.** After the dates are applied the runtime reads back what is selected
 *    and compares it to the segment. A mismatch STOPS the run before the export control is ever
 *    highlighted — see {@link ImportStage} `SCOPE_BLOCKED`.
 *  - **`CONFIRM_RANGE` is always a step, sometimes skipped.** Whether the seller must confirm the dates is
 *    only known once the read-back has happened, mid-run. Making the step conditional would change
 *    `totalSteps` under the frontend's feet, so the slot always exists and is marked `SKIPPED` when the
 *    runtime could read the range itself. `SKIPPED` is in the contract's `STEP_STATUSES` for exactly this.
 *
 * Pure: no I/O, no browser, no time source.
 */
import type {
  CommandType,
  CopyParams,
  ExecutionMode,
  RunStatus,
  StepStatus,
} from "../../../../contracts/action-window/v2/index";
import {
  IMPORT_GUIDANCE_COPY_KEYS,
  planSegmentGuidance,
  type ImportGuidanceStage,
  type ImportSurfaceFacts,
} from "../../naver/import-guidance-plan";

export type ImportStage =
  /** Automatic: confirm the seller is on the review-management surface. Never navigated for them. */
  | "PREPARE_SESSION"
  /** Display-only: show the required window before anything is touched, so the target is known. */
  | "SHOW_REQUIRED_RANGE"
  | "LOCATE_START"
  | "HIGHLIGHT_START"
  /** Seller barrier: they set the start date. */
  | "WAIT_FOR_START"
  | "LOCATE_END"
  | "HIGHLIGHT_END"
  /** Seller barrier: they set the end date. */
  | "WAIT_FOR_END"
  | "LOCATE_APPLY"
  | "HIGHLIGHT_APPLY"
  /** Seller barrier: they press the surface's own search/apply control. */
  | "WAIT_FOR_APPLY"
  /** Automatic: read back what is selected and put it through the gate. */
  | "READ_SCOPE"
  /**
   * Recoverable stop. The selected window disagrees with the segment, so nothing highlights the export
   * control. The seller fixes the dates and asks for a re-check, which returns to `READ_SCOPE`.
   */
  | "SCOPE_BLOCKED"
  /** Seller barrier, reached ONLY when the runtime could not read the range back. */
  | "WAIT_FOR_RANGE_CONFIRM"
  | "LOCATE_EXPORT"
  | "HIGHLIGHT_EXPORT"
  /** Seller barrier: they click NAVER's export control. */
  | "WAIT_FOR_EXPORT"
  | "LOCATE_CONSENT"
  | "HIGHLIGHT_CONSENT"
  /** Seller barrier: they click NAVER's own consent/confirm control. */
  | "WAIT_FOR_CONSENT"
  /** Automatic downstream: detect the download the seller's clicks produced. */
  | "DETECT_DOWNLOAD"
  | "VALIDATE_ARTIFACT"
  | "INGEST"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "PAUSED";

export const IMPORT_TERMINAL_STAGES: readonly ImportStage[] = ["COMPLETED", "FAILED", "CANCELLED"];

/** Stages where the run is resting on the seller. Nothing advances until the driver observes them. */
export const IMPORT_BARRIER_STAGES: readonly ImportStage[] = [
  "WAIT_FOR_START",
  "WAIT_FOR_END",
  "WAIT_FOR_APPLY",
  "WAIT_FOR_RANGE_CONFIRM",
  "WAIT_FOR_EXPORT",
  "WAIT_FOR_CONSENT",
];

export function isImportBarrier(stage: ImportStage): boolean {
  return IMPORT_BARRIER_STAGES.includes(stage);
}

/* ────────────────────────────── the step plan ────────────────────────────── */

export interface ImportStepMeta {
  stepNumber: number;
  stepId: string;
  copyKey: string;
  mode: ExecutionMode;
  copyParams?: CopyParams;
}

/**
 * Guidance stage → step identity. `copyParams.targetKind` tells the frontend WHICH control is
 * highlighted without ever sending a selector.
 */
const STEP_IDENTITY: Readonly<Record<ImportGuidanceStage, { stepId: string; mode: ExecutionMode; targetKind?: string }>> = {
  OPEN_REVIEW_SURFACE: { stepId: "aw.import_open_review_surface", mode: "AUTOMATIC_OPERATION" },
  SHOW_REQUIRED_RANGE: { stepId: "aw.import_show_required_range", mode: "AUTOMATIC_OPERATION" },
  SET_START_DATE: { stepId: "aw.import_set_start_date", mode: "ACTION_WINDOW", targetKind: "start_date" },
  SET_END_DATE: { stepId: "aw.import_set_end_date", mode: "ACTION_WINDOW", targetKind: "end_date" },
  APPLY_RANGE: { stepId: "aw.import_apply_range", mode: "ACTION_WINDOW", targetKind: "apply_range" },
  CONFIRM_RANGE: { stepId: "aw.import_confirm_range", mode: "ACTION_WINDOW", targetKind: "range_confirm" },
  EXPORT: { stepId: "aw.import_export", mode: "ACTION_WINDOW", targetKind: "export" },
  CONSENT: { stepId: "aw.import_consent", mode: "ACTION_WINDOW", targetKind: "consent" },
  INGEST: { stepId: "aw.import_ingest", mode: "AUTOMATIC_OPERATION" },
};

/**
 * The run's stage sequence, fixed once the surface facts are known and never changed again.
 *
 * `CONFIRM_RANGE` is always present even though most runs skip it. The alternative — inserting it when
 * the gate asks for confirmation — would grow `totalSteps` mid-run, so a frontend showing "4단계 중 3"
 * would suddenly be showing "5단계 중 4" for the same work. `APPLY_RANGE` is different: whether the
 * surface has an apply control is known from the driver's facts BEFORE any step is published, so it is
 * genuinely absent rather than skipped, and a tutorial never points at a control that is not there.
 */
export function importStagePlan(facts: ImportSurfaceFacts): ImportGuidanceStage[] {
  const sequence = planSegmentGuidance(facts);
  const exportAt = sequence.indexOf("EXPORT");
  const withConfirm = [...sequence];
  withConfirm.splice(exportAt, 0, "CONFIRM_RANGE");
  return withConfirm;
}

export function importStepPlan(facts: ImportSurfaceFacts): readonly ImportStepMeta[] {
  return importStagePlan(facts).map((stage, index) => {
    const identity = STEP_IDENTITY[stage];
    return {
      stepNumber: index + 1,
      stepId: identity.stepId,
      copyKey: IMPORT_GUIDANCE_COPY_KEYS[stage],
      mode: identity.mode,
      ...(identity.targetKind ? { copyParams: { targetKind: identity.targetKind } } : {}),
    };
  });
}

/** Step metadata at a 1-based index, clamped so a terminal view never reads past the plan. */
export function importStepMetaAt(plan: readonly ImportStepMeta[], stepNumber: number): ImportStepMeta {
  const index = Math.min(Math.max(stepNumber, 1), plan.length) - 1;
  const meta = plan[index];
  if (!meta) throw new Error("import-stages: empty step plan");
  return meta;
}

/** Which guidance stage a step number corresponds to, for driving the stage machine off the plan. */
export function importGuidanceStageAt(
  facts: ImportSurfaceFacts,
  stepNumber: number,
): ImportGuidanceStage {
  const plan = importStagePlan(facts);
  const index = Math.min(Math.max(stepNumber, 1), plan.length) - 1;
  const stage = plan[index];
  if (!stage) throw new Error("import-stages: empty stage plan");
  return stage;
}

/* ────────────────────────────── v2 enum mapping ────────────────────────────── */

export function importStageToRunStatus(stage: ImportStage): RunStatus {
  switch (stage) {
    case "PREPARE_SESSION":
    case "SHOW_REQUIRED_RANGE":
      return "PREPARING";
    case "LOCATE_START":
    case "HIGHLIGHT_START":
    case "LOCATE_END":
    case "HIGHLIGHT_END":
    case "LOCATE_APPLY":
    case "HIGHLIGHT_APPLY":
    case "READ_SCOPE":
    case "LOCATE_EXPORT":
    case "HIGHLIGHT_EXPORT":
    case "LOCATE_CONSENT":
    case "HIGHLIGHT_CONSENT":
      return "RUNNING";
    case "WAIT_FOR_START":
    case "WAIT_FOR_END":
    case "WAIT_FOR_APPLY":
    case "WAIT_FOR_RANGE_CONFIRM":
    case "WAIT_FOR_EXPORT":
    case "WAIT_FOR_CONSENT":
    // A blocked scope is still waiting on the seller — they change the dates. Reporting it as FAILED
    // would tell them the run is over when the repair is one control away.
    case "SCOPE_BLOCKED":
      return "WAITING_FOR_HUMAN";
    case "DETECT_DOWNLOAD":
    case "VALIDATE_ARTIFACT":
    case "INGEST":
      return "PROCESSING";
    case "COMPLETED":
      return "COMPLETED";
    case "FAILED":
      return "FAILED";
    case "CANCELLED":
      return "CANCELLED";
    case "PAUSED":
      return "PAUSED";
  }
}

export function importStageToStepStatus(stage: ImportStage): StepStatus {
  switch (stage) {
    case "PREPARE_SESSION":
    case "SHOW_REQUIRED_RANGE":
      return "PREPARING";
    case "LOCATE_START":
    case "LOCATE_END":
    case "LOCATE_APPLY":
    case "LOCATE_EXPORT":
    case "LOCATE_CONSENT":
      return "PENDING";
    case "HIGHLIGHT_START":
    case "HIGHLIGHT_END":
    case "HIGHLIGHT_APPLY":
    case "HIGHLIGHT_EXPORT":
    case "HIGHLIGHT_CONSENT":
      return "READY";
    case "WAIT_FOR_START":
    case "WAIT_FOR_END":
    case "WAIT_FOR_APPLY":
    case "WAIT_FOR_RANGE_CONFIRM":
    case "WAIT_FOR_EXPORT":
    case "WAIT_FOR_CONSENT":
    case "SCOPE_BLOCKED":
      return "AWAITING_USER";
    case "READ_SCOPE":
      return "OBSERVING";
    case "DETECT_DOWNLOAD":
    case "VALIDATE_ARTIFACT":
    case "INGEST":
      return "PROCESSING";
    case "COMPLETED":
      return "COMPLETED";
    case "FAILED":
      return "FAILED";
    case "CANCELLED":
    case "PAUSED":
      return "PENDING";
  }
}

/**
 * Which commands the frontend may render, per stage.
 *
 * <p>`REQUEST_STEP_RECHECK` means "I did the thing, look again" and is offered at every seller barrier —
 * including `SCOPE_BLOCKED`, where it is the repair. It NEVER completes a step on the client; the runtime
 * alone decides, by observing.
 *
 * <p>There is deliberately no command that submits, exports, or consents. The seller does those on NAVER.
 */
export function importAllowedCommands(stage: ImportStage): readonly CommandType[] {
  if (IMPORT_TERMINAL_STAGES.includes(stage)) return [];
  if (stage === "PAUSED") return ["RESUME_RUN", "CANCEL_RUN"];
  if (isImportBarrier(stage) || stage === "SCOPE_BLOCKED") {
    return [
      "REQUEST_STEP_RECHECK",
      "PAUSE_RUN",
      "CANCEL_RUN",
      // The seller can always leave guidance and finish on NAVER themselves; the manual path stays
      // available by product rule, not by convenience.
      "SWITCH_TO_MANUAL",
      "SET_GUIDANCE_ENABLED",
      "FIND_CURRENT_STEP",
    ];
  }
  return ["PAUSE_RUN", "CANCEL_RUN", "SWITCH_TO_MANUAL", "SET_GUIDANCE_ENABLED", "FIND_CURRENT_STEP"];
}
