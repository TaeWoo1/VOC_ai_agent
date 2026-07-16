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
/**
 * Read-only download detection result. The Runtime never triggers the download — it only observes
 * whether the user's action produced one. `artifactRef` is an opaque 16-hex reference (e.g. a hash
 * of sanitized metadata) — NEVER a filename or path.
 */
export interface DownloadDetectResult {
  detected: boolean;
  artifactRef?: string;
}
export interface ArtifactValidateResult {
  /** The detected artifact passed validation (e.g. extension + magic sniff). Partial/corrupt → false. */
  valid: boolean;
}
export interface IngestResult {
  /** The validated artifact was handed to the existing ingestion path (dedup-safe, idempotent). */
  ok: boolean;
  /** Sanitized count of processed items (0 is a legitimate all-duplicates outcome, not a failure). */
  processed: number;
}
/** The already-reserved contract codes a failed surface probe may carry. Never a new code. */
export type SurfaceBlockerCode = Extract<BlockerCode, "SESSION_EXPIRED" | "LOGIN_REQUIRED" | "UNSUPPORTED_STATE">;
/**
 * Rich surface-probe result (R4 channel adapters). Lets a driver report the SEMANTIC fail-closed
 * cause of a failed surface preparation using an already-reserved contract code — e.g. a reconnect
 * interstitial → `SESSION_EXPIRED`, a login form / auth challenge → `LOGIN_REQUIRED`. A bare
 * boolean stays accepted (existing drivers) and a failure without a code maps to
 * `UNSUPPORTED_STATE`, so this is purely additive.
 */
export interface SurfaceProbeResult {
  ok: boolean;
  blockerCode?: SurfaceBlockerCode;
}

/** What the harness should do next after a transition. Unit tests may ignore it. */
export type Effect =
  | "PREPARE"
  | "LOCATE"
  | "HIGHLIGHT"
  | "OBSERVE"
  | "VERIFY"
  | "DETECT_DOWNLOAD"
  | "VALIDATE_ARTIFACT"
  | "INGEST"
  | "CLEANUP"
  | "NONE";

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
function makeDefaultClock(startTick = 0): Clock {
  let tick = startTick;
  return () => `2026-01-01T00:00:00.${tick++}Z`;
}

/**
 * The COMPLETE serializable engine state (R3). Unlike the read-only `EngineSnapshot` view projection,
 * this carries everything needed to reconstruct the engine after a process restart: the command
 * ledger (`appliedCommandIds` — idempotency survives persistence), the ordered event log (the audit
 * trail), and the internal probe bookkeeping. Every value is already sanitized: enums, booleans,
 * counts, dotted copy keys, and the opaque 16-hex `targetSig` — no selector/URL/path/credential/page
 * content exists anywhere in engine state, so none can be persisted.
 */
export interface PersistedEngineState {
  runId: string;
  channelCode: string;
  runCopyKey: string;
  runCopyParams?: CopyParams;
  guidanceEnabled: boolean;
  started: boolean;
  stage: Stage;
  resumeStage: Stage | null;
  activeStepIndex: number;
  revision: number;
  /** Opaque 16-hex signature of the highlighted target (contract-sanctioned sanitized ref). */
  targetSig: string | null;
  observed: boolean;
  blocker: { code: BlockerCode; recoverable: boolean } | null;
  completedSteps: number;
  seq: number;
  /** The command idempotency ledger — a replayed commandId stays a no-op across restarts. */
  appliedCommandIds: readonly string[];
  /** The ordered sanitized event log (sequence-gapless) — the run's audit history. */
  events: readonly EventEnvelope[];
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

  /* ── persistence (R3) ── */

  /** Full-fidelity serializable state — the input to {@link ActionWindowEngine.restore}. */
  runState(): PersistedEngineState {
    return {
      runId: this.runId,
      channelCode: this.channelCode,
      runCopyKey: this.runCopyKey,
      ...(this.runCopyParams ? { runCopyParams: this.runCopyParams } : {}),
      guidanceEnabled: this.guidanceEnabled,
      started: this.started,
      stage: this.stage,
      resumeStage: this.resumeStage,
      activeStepIndex: this.activeStepIndex,
      revision: this.revision,
      targetSig: this.targetSig,
      observed: this.observed,
      blocker: this.blocker ? { ...this.blocker } : null,
      completedSteps: this.completedSteps,
      seq: this.seq,
      appliedCommandIds: [...this.appliedCommandIds],
      events: this.sink.all().map((e) => ({ ...e })),
    };
  }

  /**
   * Reconstruct an engine EXACTLY as persisted (no transition, no event, no revision change).
   * Restore policy — e.g. re-entering an interrupted run through the PAUSED barrier — is the caller's
   * concern (see `operation-run.ts` `planRestore` + {@link pauseForRestore}); this method never
   * invents semantic progress. The default clock resumes strictly after the persisted markers so
   * `occurredAt` stays a monotonic opaque marker across restarts (ordering authority remains
   * `sequence`, never the timestamp).
   */
  static restore(state: PersistedEngineState, opts?: { clock?: Clock }): ActionWindowEngine {
    const sink = new InMemoryEventSink();
    for (const e of state.events) sink.push({ ...e });
    const engine = new ActionWindowEngine(
      {
        runId: state.runId,
        channelCode: state.channelCode,
        runCopyKey: state.runCopyKey,
        runCopyParams: state.runCopyParams,
        guidanceEnabled: state.guidanceEnabled,
      },
      { clock: opts?.clock ?? makeDefaultClock((state.seq + 1) * 1000), sink },
    );
    engine.started = state.started;
    engine.stage = state.stage;
    engine.resumeStage = state.resumeStage;
    engine.activeStepIndex = state.activeStepIndex;
    engine.revision = state.revision;
    engine.targetSig = state.targetSig;
    engine.observed = state.observed;
    engine.blocker = state.blocker ? { ...state.blocker } : null;
    engine.completedSteps = state.completedSteps;
    engine.seq = state.seq;
    for (const id of state.appliedCommandIds) engine.appliedCommandIds.add(id);
    return engine;
  }

  /**
   * R3 restart-recovery barrier: park a restored, resumable run at PAUSED with the given SAFE resume
   * stage, so nothing runs until an explicit `RESUME_RUN` command (auditable, FE-visible intent — a
   * restart alone never re-drives anything). Emits a normal `RUN_STATUS_CHANGED` so the pause is part
   * of the ordered audit history. Clears the blocker: resuming a failed run re-enters the loop through
   * the same fail-closed probes, which simply fail closed again if the cause persists (zero clicks).
   * Rejected on terminal-progress states it must never resurrect (COMPLETE/CANCELLED).
   */
  pauseForRestore(safeStage: Stage): void {
    if (this.stage === "COMPLETE" || this.stage === "CANCELLED") {
      throw new Error(`action-window engine: pauseForRestore is invalid for terminal stage ${this.stage}`);
    }
    this.revision += 1;
    this.resumeStage = safeStage;
    this.stage = "PAUSED";
    this.blocker = null;
    this.emit("RUN_STATUS_CHANGED", { status: "PAUSED" });
  }

  /* ── introspection ── */
  currentStage(): Stage {
    return this.stage;
  }
  /** Whether START_RUN was ever accepted (true on an engine restored from a started run). */
  isStarted(): boolean {
    return this.started;
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
  onSurfaceReady(res: boolean | SurfaceProbeResult): Effect {
    this.expect("PREPARE_SESSION");
    this.revision += 1;
    const surface = typeof res === "boolean" ? { ok: res } : res;
    if (!surface.ok) return this.fail(surface.blockerCode ?? "UNSUPPORTED_STATE");
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
    this.stage = "DETECT_DOWNLOAD";
    this.emit("RUN_STATUS_CHANGED", { status: "PROCESSING" });
    return "DETECT_DOWNLOAD";
  }

  /* ── downstream chain (detect → validate → ingest) ─────────────────────── */

  /**
   * Probe result: did the user's verified action produce a download? Detection is read-only — the
   * Runtime never triggers it. No download (timeout) or a non-opaque ref fails closed: the export
   * did not happen, so the user must perform it again (resume re-enters through the checkpoint).
   */
  onDownloadDetected(res: DownloadDetectResult): Effect {
    this.expect("DETECT_DOWNLOAD");
    this.revision += 1;
    if (!res.detected || !res.artifactRef || !/^[0-9a-f]{16}$/.test(res.artifactRef)) {
      return this.fail("DOWNLOAD_TIMEOUT");
    }
    this.emit("DOWNLOAD_DETECTED", { stepId: this.stepId(), artifactRef: res.artifactRef });
    this.stage = "VALIDATE_ARTIFACT";
    return "VALIDATE_ARTIFACT";
  }

  /** Probe result: artifact validation. A partial or unrecognized artifact is never ingested. */
  onArtifactValidated(res: ArtifactValidateResult): Effect {
    this.expect("VALIDATE_ARTIFACT");
    this.revision += 1;
    if (!res.valid) return this.fail("ARTIFACT_INVALID");
    this.stage = "INGEST_HANDOFF";
    return "INGEST";
  }

  /**
   * Probe result: the ingestion handoff outcome. Only a verified-and-validated artifact reaches
   * here, and only success completes the run. A failed handoff fails closed with the generic
   * `UNSUPPORTED_STATE` — the contract reserves no ingest-specific blocker code, and adding one is
   * a governed contract change deferred to the channel-adapter slice.
   */
  onIngested(res: IngestResult): Effect {
    this.expect("INGEST_HANDOFF");
    this.revision += 1;
    if (!res.ok) return this.fail("UNSUPPORTED_STATE");
    this.completedSteps = 3;
    this.emit("STEP_COMPLETED", { stepId: this.stepId() });
    this.stage = "COMPLETE";
    this.blocker = null;
    this.emit("RUN_COMPLETED", { status: "COMPLETED" });
    return "CLEANUP";
  }

  /**
   * The EXECUTOR declined the ingest handoff under a run-scoped policy (the CLI's `--no-ingest`).
   * The engine never decides to decline — this records a decision made above it, exactly like every
   * other `onXxx`.
   *
   * Why CANCELLED, and why no blocker:
   *  - `COMPLETE` is reachable only through a real `onIngested({ ok: true })` — a declined run that
   *    reported success would be the fabricated completion this runtime structurally forbids.
   *  - `FAILED` would require one of the eight reserved blocker codes, and none of them describes a
   *    deliberate stop. Nothing is broken, so **no blocker is set**. Do not add an ingest-specific
   *    code here: that is a governed contract change, deferred (see `onIngested` above).
   *  - `CANCELLED` is the operator's own pre-declared stop — `CANCEL_RUN` is already accepted in this
   *    stage — and it projects step 3 as `SKIPPED`, which is what actually happened. It is also the
   *    only terminal that `resumeStateFor` classifies as TERMINAL, so a declined run can never be
   *    resumed into the ingest it just declined.
   */
  declineIngest(): Effect {
    this.expect("INGEST_HANDOFF");
    return this.cancel();
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
      case "DETECT_DOWNLOAD":
        // Resuming a run interrupted after verification re-runs the automatic downstream chain from
        // detection. Ingestion is dedup-safe and completion is recorded once, so the resume is
        // idempotent. (The restore barrier always parks downstream resumes here — see
        // `operation-run.ts` `safeResumeStageFor`.)
        return "DETECT_DOWNLOAD";
      case "VALIDATE_ARTIFACT":
        return "VALIDATE_ARTIFACT";
      case "INGEST_HANDOFF":
        return "INGEST";
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
