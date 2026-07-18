/**
 * **Action Window Runtime — reply-submission engine (R1, ISOLATED, v2).**
 *
 * A pure reducer for a guided, human-performed reply SUBMISSION. Deliberately separate from the
 * export engine (`../engine.ts`), which is untouched. The differences from export are the whole point:
 *
 *  - **No verifier, no downstream chain.** A reply post has no read-back oracle (no NAVER REVIEW API,
 *    and no proven post-action DOM marker), so the run CANNOT reach `COMPLETED`. Observing the seller's
 *    submit is an audit record, not completion (the same "관찰 ≠ 완료" rule the export engine defends).
 *  - **The terminal is `OPERATOR_REPORTED`**, reached only when the operator REPORTS the outcome, and
 *    the emitted `SUBMISSION_REPORTED` / `RUN_OPERATOR_REPORTED` events carry TWO separate fields —
 *    `operatorOutcome` (what they reported) and `verification` (always `UNVERIFIED`).
 *  - **The Runtime never submits.** There is no click/type path here or in any driver; the engine only
 *    reacts to a reported user action and to an operator report. A reply POST is not idempotent, and
 *    the runtime's guarantee against double-posting is structural: it never posts at all.
 *
 * Everything the engine emits is an already-sanitized v2 contract value. Pure: no I/O, no browser, no
 * wall-clock (`occurredAt` is a synthetic monotonic marker, never `Date`).
 */
import type {
  ActionWindowRunView,
  EventEnvelope,
  EventPayload,
  EventType,
  OperatorOutcome,
  RunStatus,
} from "../../../../contracts/action-window/v2/index";
import {
  REPLY_TERMINAL_STAGES,
  replyAllowedCommands,
  replyPlanFor,
  replyStageToRunStatus,
  replyStageToStepStatus,
  replyStepMetaAt,
  type ReplyPlanKind,
  type ReplyRunMode,
  type ReplyStage,
  type ReplyStepMeta,
} from "./reply-stages";
import type { ReplyTargetHint } from "./reply-surface";

export type ReplyEffect =
  | "PREPARE"
  | "LOCATE_ROW"
  | "HIGHLIGHT_ROW"
  | "OBSERVE_ROW"
  | "LOCATE"
  | "HIGHLIGHT"
  | "OBSERVE"
  | "CLEANUP"
  | "NONE";

/** Surface precondition: ready, or a fail-closed cause (a reserved v2 blocker code). */
export type SurfaceProbeResult = boolean | { ok: false; code: "LOGIN_REQUIRED" | "SESSION_EXPIRED" | "UNSUPPORTED_STATE" };
/** Composer locate: how many candidate composers, and the opaque signature of the one (if exactly one). */
export interface LocateComposerResult {
  count: number;
  sig?: string;
}
/** Review-row locate: how many rows match the target hint, and the opaque signature of the one (if exactly one). */
export type LocateRowResult = LocateComposerResult;

export type ReplyCommandOutcome =
  | { ok: true; idempotent: boolean; effect: ReplyEffect }
  | { ok: false; reason: string };

export interface ReplyRunConfig {
  runId: string;
  channelCode: string;
  /** Opaque 16-hex binding to an approved reply — never the reply text or a review id. */
  submissionRef?: string;
  /**
   * Privacy-safe target metadata for the GUIDED review-row locator. Present → the run follows the 3-step
   * guided plan (locate row → operator opens it → composer); absent → the legacy composer-only 2-step
   * path. Stored PRIVATELY: it selects the plan and feeds the driver, and is NEVER emitted or persisted.
   */
  targetHint?: ReplyTargetHint;
  /**
   * Run mode. `ABORT_REHEARSAL` makes the submitted terminal structurally unreachable and REQUIRES a
   * target hint (guided-only, no legacy fallback). Defaults to `FULL_SUBMIT`.
   */
  mode?: ReplyRunMode;
}

export type ReplyClock = () => string;

/** Synthetic monotonic occurrence marker (NOT wall-clock). occurredAt is opaque, display-only. */
export function makeReplyClock(start = 1): ReplyClock {
  let n = start;
  return () => `2026-01-01T00:00:00.${String(n++).padStart(6, "0")}Z`;
}

const RUN_COPY_KEY = "actionWindow.run.naverReplySubmission";

export class ReplyEngine {
  private readonly runId: string;
  private readonly channelCode: string;
  private readonly clock: ReplyClock;
  private readonly mode: ReplyRunMode;
  private readonly planKind: ReplyPlanKind;
  private readonly plan: readonly ReplyStepMeta[];
  private readonly totalSteps: number;
  private readonly targetHint: ReplyTargetHint | null;

  private started = false;
  private stage: ReplyStage = "PREPARE_SESSION";
  private revision = 0;
  private seq = 0;
  private activeStepIndex = 1;
  private completedSteps = 0;
  private guidanceEnabled = true;
  private targetSig: string | null = null;
  private rowSig: string | null = null;
  private operatorOutcome: OperatorOutcome | null = null;
  private blockerCode: ("LOGIN_REQUIRED" | "SESSION_EXPIRED" | "UNSUPPORTED_STATE" | "TARGET_NOT_FOUND" | "TARGET_AMBIGUOUS") | null = null;
  private blockerRecoverable = false;
  private readonly log: EventEnvelope[] = [];

  constructor(config: ReplyRunConfig, opts?: { clock?: ReplyClock }) {
    this.runId = config.runId;
    this.channelCode = config.channelCode;
    this.clock = opts?.clock ?? makeReplyClock();
    this.mode = config.mode ?? "FULL_SUBMIT";
    this.targetHint = config.targetHint ?? null;
    // ABORT_REHEARSAL is guided-only and bound — a hint is mandatory, with no legacy fallback. Fail
    // closed at construction (the CLI enforces this earlier; this is defense in depth).
    if (this.mode === "ABORT_REHEARSAL" && !this.targetHint) {
      throw new Error("reply-engine: ABORT_REHEARSAL requires a guided target hint");
    }
    this.planKind = this.targetHint ? "GUIDED" : "LEGACY";
    this.plan = replyPlanFor(this.planKind);
    this.totalSteps = this.plan.length;
  }

  private isTerminal(): boolean {
    return REPLY_TERMINAL_STAGES.includes(this.stage);
  }

  /* ── inbound command ─────────────────────────────────────────────────────── */
  command(command: { type: string; expectedRevision: number }): ReplyCommandOutcome {
    if (!this.started) {
      if (command.type !== "START_RUN") return { ok: false, reason: "INVALID_FOR_STATE" };
      return { ok: true, idempotent: false, effect: this.start() };
    }
    if (command.type === "START_RUN") return { ok: true, idempotent: true, effect: "NONE" };
    if (command.expectedRevision < this.revision) return { ok: false, reason: "STALE_REVISION" };
    if (!replyAllowedCommands(this.stage, this.mode).includes(command.type as never)) {
      return { ok: false, reason: "INVALID_FOR_STATE" };
    }
    switch (command.type) {
      case "SET_GUIDANCE_ENABLED":
        // Guidance toggle does not itself change progress; treat as a no-op display change.
        return { ok: true, idempotent: false, effect: "NONE" };
      case "FIND_CURRENT_STEP":
        return { ok: true, idempotent: true, effect: "NONE" };
      case "PAUSE_RUN":
        return { ok: true, idempotent: false, effect: this.pause() };
      case "RESUME_RUN":
        return { ok: true, idempotent: false, effect: this.resume() };
      case "CANCEL_RUN":
        return { ok: true, idempotent: false, effect: this.cancel() };
      // The operator reports the barrier outcome. REQUEST_STEP_RECHECK = "I posted it";
      // SWITCH_TO_MANUAL = "I did not post it through guidance". Both terminate at OPERATOR_REPORTED.
      case "REQUEST_STEP_RECHECK":
        return { ok: true, idempotent: false, effect: this.reportOutcome("OPERATOR_REPORTED_SUBMITTED") };
      case "SWITCH_TO_MANUAL":
        return { ok: true, idempotent: false, effect: this.reportOutcome("SUBMISSION_ABORTED") };
      default:
        return { ok: false, reason: "INVALID_FOR_STATE" };
    }
  }

  /* ── automatic-drive callbacks ────────────────────────────────────────────── */
  private start(): ReplyEffect {
    this.started = true;
    this.stage = "PREPARE_SESSION";
    this.activeStepIndex = 1;
    this.emit("RUN_STARTED", { status: "PREPARING" });
    this.emit("RUN_STATUS_CHANGED", { status: "PREPARING" });
    return "PREPARE";
  }

  onSurfaceReady(res: SurfaceProbeResult): ReplyEffect {
    if (this.isTerminal()) return "NONE"; // an abort may have terminated the run while this was in flight
    const ready = res === true;
    if (!ready) {
      const code = res === false ? "UNSUPPORTED_STATE" : res.code;
      // A session precondition failure is recoverable by the human restoring their session.
      const recoverable = code === "LOGIN_REQUIRED" || code === "SESSION_EXPIRED";
      return recoverable ? this.block(code, true) : this.fail(code);
    }
    // Guided (target hint present): locate the specific review ROW first. Legacy: straight to the composer.
    if (this.targetHint) {
      this.stage = "LOCATE_ROW";
      this.emit("RUN_STATUS_CHANGED", { status: "RUNNING" });
      return "LOCATE_ROW";
    }
    this.stage = "LOCATE_COMPOSER";
    this.emit("RUN_STATUS_CHANGED", { status: "RUNNING" });
    return "LOCATE";
  }

  /** Guided: how many review rows match the hint. Same fail-closed logic as composer locate. */
  onRowLocated(res: LocateRowResult): ReplyEffect {
    if (this.isTerminal()) return "NONE";
    if (res.count > 1) return this.fail("TARGET_AMBIGUOUS");
    if (res.count === 0 || !res.sig) return this.fail("TARGET_NOT_FOUND");
    this.rowSig = res.sig;
    this.stage = "HIGHLIGHT_ROW";
    return "HIGHLIGHT_ROW";
  }

  /**
   * Guided: annotate the matched row + its reply control read-only and rest at the row-open barrier.
   * The arg is the driver's RE-VALIDATED locate (anti-drift): if the unique match changed between locate
   * and highlight — count no longer 1, or a different `sig` — fail closed rather than highlight the wrong
   * row.
   */
  onRowHighlighted(res: LocateRowResult): ReplyEffect {
    if (this.isTerminal()) return "NONE";
    if (res.count > 1) return this.fail("TARGET_AMBIGUOUS");
    if (res.count === 0 || !res.sig || res.sig !== this.rowSig) return this.fail("TARGET_NOT_FOUND");
    this.completedSteps = 1; // step 1 (prepare surface + locate row) complete
    this.activeStepIndex = 2; // step 2: the operator opens the review row
    this.stage = "WAIT_FOR_ROW_OPEN";
    this.emit("STEP_READY", { stepId: this.stepId(), stepStatus: "READY" });
    this.emit("HUMAN_ACTION_REQUIRED", { stepId: this.stepId() });
    this.emit("TARGET_HIGHLIGHTED", { stepId: this.stepId(), targetRef: this.rowSig! });
    this.emit("RUN_STATUS_CHANGED", { status: "WAITING_FOR_HUMAN" });
    return "OBSERVE_ROW";
  }

  /**
   * Guided: the operator opened the review's reply control themselves (their own click, observed — never
   * a Runtime click). This lifts the row-open barrier and rejoins the composer chain. Like the submit
   * observation, it is an OBSERVATION and only advances a still-open row barrier.
   */
  onRowOpened(): ReplyEffect {
    if (this.stage !== "WAIT_FOR_ROW_OPEN") return "NONE";
    this.completedSteps = 2; // step 2 (open review row) complete
    this.activeStepIndex = 3; // step 3: the operator pastes + submits the reply
    this.stage = "LOCATE_COMPOSER";
    this.emit("RUN_STATUS_CHANGED", { status: "RUNNING" });
    return "LOCATE";
  }

  onLocated(res: LocateComposerResult): ReplyEffect {
    if (this.isTerminal()) return "NONE"; // an abort may have terminated the run while this was in flight
    // Fail closed on ambiguity — never highlight or observe more than one composer, and never guess.
    // Ambiguity is checked BEFORE the missing-signature check: the locate decision only signs the SINGLE
    // composer case, so a real `count > 1` carries no `sig` and must not be mislabeled TARGET_NOT_FOUND.
    if (res.count > 1) return this.fail("TARGET_AMBIGUOUS");
    if (res.count === 0 || !res.sig) return this.fail("TARGET_NOT_FOUND");
    this.targetSig = res.sig;
    this.stage = "HIGHLIGHT_COMPOSER";
    return "HIGHLIGHT";
  }

  onHighlighted(): ReplyEffect {
    if (this.isTerminal()) return "NONE";
    // The composer submit barrier is the LAST step of whichever plan is active (2 legacy / 3 guided).
    this.completedSteps = this.totalSteps - 1;
    this.activeStepIndex = this.totalSteps;
    this.stage = "WAIT_FOR_SUBMIT";
    this.emit("STEP_READY", { stepId: this.stepId(), stepStatus: "READY" });
    this.emit("HUMAN_ACTION_REQUIRED", { stepId: this.stepId() });
    this.emit("TARGET_HIGHLIGHTED", { stepId: this.stepId(), targetRef: this.targetSig! });
    this.emit("RUN_STATUS_CHANGED", { status: "WAITING_FOR_HUMAN" });
    return "OBSERVE";
  }

  /**
   * The seller acted on the composer (submitted). This is an OBSERVATION, not completion — it does
   * not terminate the run, exactly as the export engine's barrier does not. Completion authority for a
   * reply post does not exist (no verifier); the operator's REPORT terminates it.
   */
  onUserActionObserved(): ReplyEffect {
    if (this.stage !== "WAIT_FOR_SUBMIT") return "NONE";
    this.emit("USER_ACTION_OBSERVED", { stepId: this.stepId(), observed: true });
    return "NONE";
  }

  private reportOutcome(outcome: OperatorOutcome): ReplyEffect {
    this.operatorOutcome = outcome;
    this.completedSteps = this.totalSteps;
    this.stage = "OPERATOR_REPORTED";
    this.emit("SUBMISSION_REPORTED", {
      stepId: this.stepId(),
      operatorOutcome: outcome,
      verification: "UNVERIFIED",
    });
    this.emit("RUN_OPERATOR_REPORTED", {
      status: "OPERATOR_REPORTED",
      operatorOutcome: outcome,
      verification: "UNVERIFIED",
    });
    return "CLEANUP";
  }

  private pause(): ReplyEffect {
    this.stage = "PAUSED";
    this.emit("RUN_STATUS_CHANGED", { status: "PAUSED" });
    return "NONE";
  }

  private resume(): ReplyEffect {
    // Re-enter the human barrier — NEVER auto-re-drive a submit (a reply POST is not idempotent and
    // the runtime never submits anyway). The operator re-reports the outcome.
    this.stage = "WAIT_FOR_SUBMIT";
    this.emit("RUN_STATUS_CHANGED", { status: "WAITING_FOR_HUMAN" });
    return "NONE";
  }

  private cancel(): ReplyEffect {
    this.stage = "CANCELLED";
    this.emit("RUN_STATUS_CHANGED", { status: "CANCELLED" });
    return "CLEANUP";
  }

  private block(code: "LOGIN_REQUIRED" | "SESSION_EXPIRED", recoverable: boolean): ReplyEffect {
    this.blockerCode = code;
    this.blockerRecoverable = recoverable;
    this.stage = "FAILED";
    this.emit("RUN_BLOCKED", { code, recoverable });
    this.emit("RUN_FAILED", { code });
    return "CLEANUP";
  }

  private fail(code: "UNSUPPORTED_STATE" | "TARGET_NOT_FOUND" | "TARGET_AMBIGUOUS"): ReplyEffect {
    this.blockerCode = code;
    this.blockerRecoverable = false;
    this.stage = "FAILED";
    this.emit("RUN_BLOCKED", { code, recoverable: false });
    this.emit("RUN_FAILED", { code });
    return "CLEANUP";
  }

  /* ── outbound state ───────────────────────────────────────────────────────── */
  private emit(type: EventType, payload: EventPayload): void {
    this.seq += 1;
    this.revision += 1;
    this.log.push({
      protocolVersion: 2,
      eventId: `${this.runId}-e${this.seq}`,
      runId: this.runId,
      sequence: this.seq,
      revision: this.revision,
      type,
      occurredAt: this.clock(),
      payload,
    });
  }

  private stepId(): string {
    return replyStepMetaAt(this.plan, this.activeStepIndex).stepId;
  }

  view(): ActionWindowRunView {
    const meta = replyStepMetaAt(this.plan, this.activeStepIndex);
    const status: RunStatus = replyStageToRunStatus(this.stage);
    const view: ActionWindowRunView = {
      protocolVersion: 2,
      runId: this.runId,
      revision: this.revision,
      channelCode: this.channelCode,
      runCopyKey: RUN_COPY_KEY,
      status,
      executionMode: "ACTION_WINDOW",
      intent: "REPLY_SUBMISSION",
      currentStep: {
        stepId: meta.stepId,
        stepNumber: meta.stepNumber,
        totalSteps: this.totalSteps,
        copyKey: meta.copyKey,
        ...(meta.copyParams ? { copyParams: meta.copyParams } : {}),
        status: replyStageToStepStatus(this.stage),
      },
      guidanceEnabled: this.guidanceEnabled,
      allowedCommands: replyAllowedCommands(this.stage, this.mode),
      progress: { completedSteps: this.completedSteps, totalSteps: this.totalSteps },
      updatedAt: this.clock(),
    };
    if (this.blockerCode && this.stage === "FAILED") {
      view.blocker = {
        code: this.blockerCode as never,
        recoverable: this.blockerRecoverable,
      };
    }
    return view;
  }

  events(): readonly EventEnvelope[] {
    return this.log;
  }
  currentStage(): ReplyStage {
    return this.stage;
  }
  isStarted(): boolean {
    return this.started;
  }
  reportedOutcome(): OperatorOutcome | null {
    return this.operatorOutcome;
  }
  /** The run's mode — persisted as non-sensitive identity so recovery can never default it. */
  runMode(): ReplyRunMode {
    return this.mode;
  }
  /** The run's plan kind — persisted alongside `mode` as non-sensitive identity. */
  runPlanKind(): ReplyPlanKind {
    return this.planKind;
  }
}
