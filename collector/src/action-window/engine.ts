/**
 * **Action Window Runtime — pure state engine (R1, channel-neutral).**
 *
 * Deterministic, side-effect-free core of the synthetic Action Window loop. It NEVER touches a
 * browser and NEVER clicks a target — it only reacts to (a) FE commands and (b) probe *results*
 * that the harness feeds in after running the (browser-side) locator / observer / verifier. This
 * separation is what lets the whole loop be unit-tested with fakes, and keeps the "Runtime never
 * clicks" invariant structural: there is no click path anywhere in this module.
 *
 * Execution ≠ completion: a user click is only an observation. A step completes solely when the
 * transition verifier confirms the expected post-state.
 */
import {
  ACTION_WINDOW_PROTOCOL_VERSION,
  isActionWindowProtocolCompatible,
  type ActionWindowRunView,
  type BlockerCode,
  type CommandEnvelope,
  type CopyParams,
  type EventEnvelope,
  type EventPayload,
  type EventType,
} from "../../../contracts/action-window/v1/index";
import { InMemoryEventSink } from "./events";
import { projectRunView, type EngineSnapshot } from "./view";
import { type Stage, stageStepIndex, stageToRunStatus, stepMetaByIndex } from "./stages";

export interface RunConfig {
  runId: string;
  /** Sanitized stable channel identity (SEMANTIC_CODE), e.g. `synthetic` — never a user-facing title. */
  channelCode: string;
  /** Dotted semantic copy key for the run headline; FE owns final copy. */
  runCopyKey: string;
  runCopyParams?: CopyParams;
  guidanceEnabled?: boolean;
}

export interface LocateResult {
  count: number;
  /** Opaque 16-hex signature of the single located target (required when count === 1). */
  sig?: string;
}
export interface VerifyResult {
  /** Expected post-action state observed. */
  verified: boolean;
  /** Target signature changed since highlight → UI drift. */
  drift: boolean;
}

/** What the harness should do next after a transition. Unit tests may ignore it. */
export type Effect = "PREPARE" | "LOCATE" | "HIGHLIGHT" | "OBSERVE" | "VERIFY" | "DOWNSTREAM" | "CLEANUP" | "NONE";

export type CommandRejection =
  | "UNSUPPORTED_PROTOCOL_VERSION"
  | "INVALID_FOR_STATE"
  | "STALE_REVISION"
  | "UNSUPPORTED_MANUAL";

export type CommandOutcome =
  | { ok: true; idempotent: boolean; effect: Effect; view: ActionWindowRunView }
  | { ok: false; reason: CommandRejection; view: ActionWindowRunView };

export type Clock = () => string;

/** Default clock: a synthetic monotonic occurrence marker (NOT wall-clock). occurredAt is opaque. */
function makeDefaultClock(): Clock {
  let tick = 0;
  return () => `2026-01-01T00:00:00.${tick++}Z`;
}

export class ActionWindowEngine {
  private readonly runId: string;
  private readonly channelCode: string;
  private readonly runCopyKey: string;
  private readonly runCopyParams?: CopyParams;
  private readonly clock: Clock;
  readonly sink: InMemoryEventSink;

  private started = false;
  private stage: Stage = "PREPARE_SESSION";
  private resumeStage: Stage | null = null;
  private activeStepIndex = 1;
  private revision = 0;
  private guidanceEnabled: boolean;
  private targetSig: string | null = null;
  private observed = false;
  private blocker: { code: BlockerCode; recoverable: boolean } | null = null;
  private completedSteps = 0;
  private seq = 0;
  private readonly appliedCommandIds = new Set<string>();

  constructor(config: RunConfig, opts?: { clock?: Clock; sink?: InMemoryEventSink }) {
    this.runId = config.runId;
    this.channelCode = config.channelCode;
    this.runCopyKey = config.runCopyKey;
    this.runCopyParams = config.runCopyParams;
    this.guidanceEnabled = config.guidanceEnabled ?? true;
    this.clock = opts?.clock ?? makeDefaultClock();
    this.sink = opts?.sink ?? new InMemoryEventSink();
  }

  /* ── introspection ── */
  currentStage(): Stage {
    return this.stage;
  }
  currentRevision(): number {
    return this.revision;
  }
  view(): ActionWindowRunView {
    return projectRunView(this.snapshot());
  }
  events(): readonly EventEnvelope[] {
    return this.sink.all();
  }

  private snapshot(): EngineSnapshot {
    return {
      runId: this.runId,
      channelCode: this.channelCode,
      runCopyKey: this.runCopyKey,
      runCopyParams: this.runCopyParams,
      stage: this.stage,
      resumeStage: this.resumeStage,
      activeStepIndex: this.activeStepIndex,
      revision: this.revision,
      guidanceEnabled: this.guidanceEnabled,
      blocker: this.blocker,
      completedSteps: this.completedSteps,
      updatedAt: this.clock(),
    };
  }

  private emit(type: EventType, payload: EventPayload): void {
    this.seq += 1;
    this.sink.push({
      protocolVersion: ACTION_WINDOW_PROTOCOL_VERSION,
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
    return stepMetaByIndex(this.activeStepIndex).stepId;
  }

  private fail(code: BlockerCode): Effect {
    this.revision += 1;
    this.blocker = { code, recoverable: false };
    this.stage = "FAILED";
    this.emit("RUN_BLOCKED", { code, recoverable: false });
    this.emit("RUN_FAILED", { code });
    return "CLEANUP";
  }

  /* ── FE commands ───────────────────────────────────────────────────────── */
  command(cmd: CommandEnvelope): CommandOutcome {
    if (!isActionWindowProtocolCompatible(cmd.protocolVersion, ACTION_WINDOW_PROTOCOL_VERSION)) {
      return { ok: false, reason: "UNSUPPORTED_PROTOCOL_VERSION", view: this.view() };
    }

    // START_RUN is the only command valid before the run has started.
    if (!this.started) {
      if (cmd.type !== "START_RUN") return { ok: false, reason: "INVALID_FOR_STATE", view: this.view() };
      if (this.appliedCommandIds.has(cmd.commandId)) return { ok: true, idempotent: true, effect: "NONE", view: this.view() };
      if (cmd.expectedRevision !== this.revision) return { ok: false, reason: "STALE_REVISION", view: this.view() };
      this.appliedCommandIds.add(cmd.commandId);
      return { ok: true, idempotent: false, effect: this.start(), view: this.view() };
    }

    // Idempotent replay (checked before state/revision so a duplicate is always a no-op success).
    if (this.appliedCommandIds.has(cmd.commandId)) {
      return { ok: true, idempotent: true, effect: "NONE", view: this.view() };
    }

    // FIND_CURRENT_STEP is read-only; allowed wherever it is listed, no revision/idempotency ledger.
    if (cmd.type === "FIND_CURRENT_STEP") {
      if (!this.isAllowed("FIND_CURRENT_STEP")) return { ok: false, reason: "INVALID_FOR_STATE", view: this.view() };
      return { ok: true, idempotent: false, effect: "NONE", view: this.view() };
    }

    if (!this.isAllowed(cmd.type)) {
      return { ok: false, reason: "INVALID_FOR_STATE", view: this.view() };
    }

    // SWITCH_TO_MANUAL: V1 semantics are not yet defined → sanitized unsupported result (recorded for R2).
    if (cmd.type === "SWITCH_TO_MANUAL") {
      return { ok: false, reason: "UNSUPPORTED_MANUAL", view: this.view() };
    }

    if (cmd.expectedRevision !== this.revision) {
      return { ok: false, reason: "STALE_REVISION", view: this.view() };
    }
    this.appliedCommandIds.add(cmd.commandId);

    let effect: Effect = "NONE";
    switch (cmd.type) {
      case "REQUEST_STEP_RECHECK":
        effect = this.beginVerify();
        break;
      case "SET_GUIDANCE_ENABLED":
        this.revision += 1;
        this.guidanceEnabled = (cmd.payload as { enabled?: boolean } | undefined)?.enabled ?? this.guidanceEnabled;
        break;
      case "PAUSE_RUN":
        this.revision += 1;
        this.resumeStage = this.stage;
        this.stage = "PAUSED";
        this.emit("RUN_STATUS_CHANGED", { status: "PAUSED" });
        break;
      case "RESUME_RUN":
        effect = this.resume();
        break;
      case "CANCEL_RUN":
        effect = this.cancel();
        break;
      default:
        return { ok: false, reason: "INVALID_FOR_STATE", view: this.view() };
    }
    return { ok: true, idempotent: false, effect, view: this.view() };
  }

  private isAllowed(type: CommandEnvelope["type"]): boolean {
    // allowedCommands is stage-derived; re-use the stages helper via a snapshot view.
    return this.view().allowedCommands.includes(type);
  }

  /* ── lifecycle transitions ────────────────────────────────────────────── */
  private start(): Effect {
    this.started = true;
    this.revision += 1;
    this.stage = "PREPARE_SESSION";
    this.activeStepIndex = 1;
    this.emit("RUN_STARTED", { status: "PREPARING" });
    this.emit("RUN_STATUS_CHANGED", { status: "PREPARING" });
    return "PREPARE";
  }

  /** Probe result: is the opened surface the expected seller-center surface? */
  onSurfaceReady(ok: boolean): Effect {
    this.expect("PREPARE_SESSION");
    this.revision += 1;
    if (!ok) return this.fail("UNSUPPORTED_STATE");
    this.completedSteps = 1; // step 1 (prepare) done
    this.activeStepIndex = 2;
    this.stage = "LOCATE_TARGET";
    this.emit("RUN_STATUS_CHANGED", { status: "RUNNING" });
    return "LOCATE";
  }

  onLocated(res: LocateResult): Effect {
    this.expect("LOCATE_TARGET");
    this.revision += 1;
    if (res.count === 0) return this.fail("TARGET_NOT_FOUND");
    if (res.count > 1) return this.fail("TARGET_AMBIGUOUS");
    if (!res.sig) return this.fail("TARGET_NOT_FOUND");
    this.targetSig = res.sig;
    this.stage = "HIGHLIGHT_TARGET";
    this.emit("STEP_READY", { stepId: this.stepId(), stepStatus: "READY" });
    return "HIGHLIGHT";
  }

  onHighlighted(): Effect {
    this.expect("HIGHLIGHT_TARGET");
    this.revision += 1;
    this.stage = "WAIT_FOR_USER_ACTION";
    this.emit("HUMAN_ACTION_REQUIRED", { stepId: this.stepId() });
    this.emit("TARGET_HIGHLIGHTED", { stepId: this.stepId(), targetRef: this.targetSig! });
    this.emit("RUN_STATUS_CHANGED", { status: "WAITING_FOR_HUMAN" });
    return "OBSERVE";
  }

  /** The user (not the Runtime) interacted with the target. This is an observation, not completion. */
  onUserActionObserved(): Effect {
    this.expect("WAIT_FOR_USER_ACTION");
    this.revision += 1;
    this.observed = true;
    this.emit("USER_ACTION_OBSERVED", { stepId: this.stepId(), observed: true });
    return "NONE";
  }

  private beginVerify(): Effect {
    // REQUEST_STEP_RECHECK: move to observation; verification is the sole completion authority.
    this.revision += 1;
    this.stage = "VERIFY_TRANSITION";
    this.emit("RUN_STATUS_CHANGED", { status: "RUNNING" });
    return "VERIFY";
  }

  onVerified(res: VerifyResult): Effect {
    this.expect("VERIFY_TRANSITION");
    this.revision += 1;
    if (res.drift) return this.fail("UI_DRIFT");
    if (!res.verified) {
      // Expected state not reached → NO false completion; return to waiting.
      this.stage = "WAIT_FOR_USER_ACTION";
      this.emit("RUN_STATUS_CHANGED", { status: "WAITING_FOR_HUMAN" });
      return "OBSERVE";
    }
    this.completedSteps = 2; // human step verified
    this.emit("STEP_COMPLETED", { stepId: this.stepId() });
    this.activeStepIndex = 3;
    this.stage = "RUN_DUMMY_DOWNSTREAM";
    this.emit("RUN_STATUS_CHANGED", { status: "PROCESSING" });
    return "DOWNSTREAM";
  }

  /** One deterministic in-memory automatic step. No backend, no upload, no download. */
  runDownstream(): { effect: Effect; result: { processed: number } } {
    this.expect("RUN_DUMMY_DOWNSTREAM");
    this.revision += 1;
    const result = { processed: TOTAL_STEPS_PROCESSED };
    this.completedSteps = 3;
    this.emit("STEP_COMPLETED", { stepId: this.stepId() });
    this.stage = "COMPLETE";
    this.blocker = null;
    this.emit("RUN_COMPLETED", { status: "COMPLETED" });
    return { effect: "CLEANUP", result };
  }

  private resume(): Effect {
    const target = this.resumeStage ?? "PREPARE_SESSION";
    this.revision += 1;
    this.stage = target;
    this.resumeStage = null;
    this.emit("RUN_STATUS_CHANGED", { status: stageToRunStatus(target) });
    switch (target) {
      case "PREPARE_SESSION":
        return "PREPARE";
      case "LOCATE_TARGET":
        return "LOCATE";
      case "HIGHLIGHT_TARGET":
        return "HIGHLIGHT";
      case "WAIT_FOR_USER_ACTION":
        return "OBSERVE";
      default:
        return "NONE";
    }
  }

  private cancel(): Effect {
    this.revision += 1;
    this.stage = "CANCELLED";
    this.emit("RUN_STATUS_CHANGED", { status: "CANCELLED" });
    return "CLEANUP";
  }

  private expect(stage: Stage): void {
    if (this.stage !== stage) {
      throw new Error(`action-window engine: expected stage ${stage}, was ${this.stage}`);
    }
    // Keeps stageStepIndex referenced for coherence checks in tests.
    void stageStepIndex(stage);
  }
}

/** Deterministic dummy-downstream output size (in-memory only). */
const TOTAL_STEPS_PROCESSED = 1;
