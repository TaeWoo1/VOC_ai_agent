/**
 * **Action Window Runtime — initial-review-import segment engine (ISOLATED, v2).**
 *
 * A pure reducer for ONE guided monthly segment: the seller is walked through NAVER's own review surface,
 * sets the dates, applies, exports and consents — every click theirs — and the runtime highlights, observes,
 * then detects the resulting download, validates it and ingests it against this run's launch ref.
 *
 * **The three things this engine exists to guarantee:**
 *
 *  1. **It never acts on the marketplace.** There is no effect that clicks, types, exports or consents.
 *     The effects are PREPARE / LOCATE / PREFILLED / HIGHLIGHT / OBSERVE / READ_SCOPE / CLEAR_HIGHLIGHT /
 *     DETECT_DOWNLOAD / VALIDATE / INGEST / CLEANUP — all observation, annotation, or work on a file the
 *     seller produced. The two added on 2026-07-26 are the smallest kind of both: PREFILLED asks a control
 *     what it already contains, and CLEAR_HIGHLIGHT takes an annotation off.
 *  2. **The scope gate is unbypassable.** `EXPORT` is unreachable except through `READ_SCOPE`, and a
 *     `MISMATCH` parks the run at `SCOPE_BLOCKED` instead. A file covering the wrong window ingested as
 *     though it covered this segment is the worst outcome available here — worse than not importing.
 *  3. **Evidence is never upgraded.** The scope evidence recorded is `MACHINE_MATCHED` only when the
 *     runtime read the range back and it agreed. When it could not read it, the seller confirms and the
 *     evidence is `OPERATOR_CONFIRMED` — never relabelled as a machine check.
 *
 * Unlike the reply engine this one CAN reach `COMPLETED`, because an import has a read-back oracle: a file
 * was parsed and the server answered with counts. Pure: no I/O, no browser, no wall-clock.
 */
import type {
  ActionWindowRunView,
  EventEnvelope,
  EventPayload,
  EventType,
  RunStatus,
} from "../../../../contracts/action-window/v2/index";
import type { ScopeMatch } from "../../naver/export-scope-match";
import { gateOnScope, type ImportSurfaceFacts } from "../../naver/import-guidance-plan";
import type { ArtifactValidateResult, DownloadDetectResult, IngestResult, LocateResult, SurfaceProbeResult } from "../engine";
import {
  IMPORT_TERMINAL_STAGES,
  importAllowedCommands,
  importStagePlan,
  importStepMetaAt,
  importStepPlan,
  importStageToRunStatus,
  importStageToStepStatus,
  isImportBarrier,
  type ImportStage,
  type ImportStepMeta,
} from "./import-stages";
import type { ImportTarget, RequiredRange } from "./import-driver";

/** What the session should do next. Every one is observation, annotation, or work on a produced file. */
export type ImportEffect =
  | "PREPARE"
  | "READ_FACTS"
  | { locate: ImportTarget }
  /** Ask whether this date control already holds what the gate will accept (finding 13). */
  | { prefilled: ImportTarget }
  | { highlight: ImportTarget }
  | { observe: ImportTarget }
  | "READ_SCOPE"
  /** Take the annotation off the control the run has stopped pointing at (finding 12). */
  | "CLEAR_HIGHLIGHT"
  | "DETECT_DOWNLOAD"
  | "VALIDATE_ARTIFACT"
  | "INGEST"
  | "CLEANUP"
  | "NONE";

/** The evidence recorded for how this run's scope was established. Stored, never defaulted. */
export type ImportScopeEvidence = "MACHINE_MATCHED" | "OPERATOR_CONFIRMED";

export type ImportBlockerCode =
  | "LOGIN_REQUIRED"
  | "SESSION_EXPIRED"
  | "UNSUPPORTED_STATE"
  | "TARGET_NOT_FOUND"
  | "TARGET_AMBIGUOUS"
  | "SCOPE_MISMATCH"
  | "DOWNLOAD_TIMEOUT"
  | "ARTIFACT_INVALID"
  | "INGEST_FAILED";

export type ImportCommandOutcome =
  | { ok: true; idempotent: boolean; effect: ImportEffect }
  | { ok: false; reason: string };

export interface ImportRunConfig {
  runId: string;
  channelCode: string;
  /** Opaque 16-hex single-use authorization for THIS segment. Never logged, never emitted. */
  importRef: string;
  /** The window this segment must cover, resolved server-side from the launch ref. */
  required: RequiredRange;
}

export type ImportClock = () => string;

/** Synthetic monotonic occurrence marker (NOT wall-clock). `occurredAt` is opaque, display-only. */
export function makeImportClock(start = 1): ImportClock {
  let n = start;
  return () => `2026-01-01T00:00:00.${String(n++).padStart(6, "0")}Z`;
}

const RUN_COPY_KEY = "actionWindow.run.naverInitialReviewImportSegment";

/** Which target each barrier stage is resting on — used to arm and await the right control. */
const BARRIER_TARGET: Readonly<Partial<Record<ImportStage, ImportTarget>>> = {
  WAIT_FOR_START: "start_date",
  WAIT_FOR_END: "end_date",
  WAIT_FOR_APPLY: "apply_range",
  WAIT_FOR_EXPORT: "export",
  WAIT_FOR_CONSENT: "consent",
};

export class ImportSegmentEngine {
  private readonly runId: string;
  private readonly channelCode: string;
  private readonly importRef: string;
  private readonly required: RequiredRange;
  private readonly clock: ImportClock;

  private started = false;
  private stage: ImportStage = "PREPARE_SESSION";
  private revision = 0;
  private seq = 0;
  private activeStepIndex = 1;
  private completedSteps = 0;
  private guidanceEnabled = true;
  /** Fixed by the driver's facts before any step is published; null until then. */
  private facts: ImportSurfaceFacts | null = null;
  private plan: readonly ImportStepMeta[] = [];
  private targetSig: Partial<Record<ImportTarget, string>> = {};
  private scopeEvidence: ImportScopeEvidence | null = null;
  private artifactRef: string | null = null;
  private processed: number | null = null;
  private blockerCode: ImportBlockerCode | null = null;
  private blockerRecoverable = false;
  private readonly log: EventEnvelope[] = [];

  constructor(config: ImportRunConfig, opts?: { clock?: ImportClock }) {
    this.runId = config.runId;
    this.channelCode = config.channelCode;
    this.importRef = config.importRef;
    this.required = config.required;
    this.clock = opts?.clock ?? makeImportClock();
    if (!/^[0-9a-f]{16}$/.test(config.importRef)) {
      // Fail closed at construction: a malformed ref cannot authorize an ingest, and discovering that
      // after the seller has exported a file wastes their export window.
      throw new Error("import-engine: importRef must be 16 lowercase hex characters");
    }
  }

  private isTerminal(): boolean {
    return IMPORT_TERMINAL_STAGES.includes(this.stage);
  }

  /* ── inbound command ─────────────────────────────────────────────────────── */

  command(command: { type: string; expectedRevision: number }): ImportCommandOutcome {
    if (!this.started) {
      if (command.type !== "START_RUN") return { ok: false, reason: "INVALID_FOR_STATE" };
      return { ok: true, idempotent: false, effect: this.start() };
    }
    if (command.type === "START_RUN") return { ok: true, idempotent: true, effect: "NONE" };
    if (command.expectedRevision < this.revision) return { ok: false, reason: "STALE_REVISION" };
    if (!importAllowedCommands(this.stage).includes(command.type as never)) {
      return { ok: false, reason: "INVALID_FOR_STATE" };
    }
    switch (command.type) {
      case "SET_GUIDANCE_ENABLED":
      case "FIND_CURRENT_STEP":
        return { ok: true, idempotent: true, effect: "NONE" };
      case "PAUSE_RUN":
        return { ok: true, idempotent: false, effect: this.pause() };
      case "RESUME_RUN":
        return { ok: true, idempotent: false, effect: this.resume() };
      case "CANCEL_RUN":
        return { ok: true, idempotent: false, effect: this.cancel() };
      case "SWITCH_TO_MANUAL":
        return { ok: true, idempotent: false, effect: this.abandonToManual() };
      case "REQUEST_STEP_RECHECK":
        return { ok: true, idempotent: false, effect: this.recheck() };
      default:
        return { ok: false, reason: "INVALID_FOR_STATE" };
    }
  }

  /**
   * "I did it, look again."
   *
   * <p>At `SCOPE_BLOCKED` this is the repair: re-read the range the seller has just corrected. At any other
   * barrier it re-arms observation rather than completing the step — the runtime alone decides a step is
   * done, by observing, which is the `REQUEST_STEP_RECHECK` rule the v1 contract established.
   */
  private recheck(): ImportEffect {
    if (this.stage === "SCOPE_BLOCKED") {
      this.blockerCode = null;
      this.blockerRecoverable = false;
      this.stage = "READ_SCOPE";
      this.emit("RUN_STATUS_CHANGED", { status: "RUNNING" });
      return "READ_SCOPE";
    }
    if (this.stage === "WAIT_FOR_RANGE_CONFIRM") {
      // The seller confirming the range IS the evidence here; there is no control to observe.
      return this.onRangeConfirmed();
    }
    const target = BARRIER_TARGET[this.stage];
    return target ? { observe: target } : "NONE";
  }

  /* ── automatic-drive callbacks ────────────────────────────────────────────── */

  private start(): ImportEffect {
    this.started = true;
    this.stage = "PREPARE_SESSION";
    this.activeStepIndex = 1;
    this.emit("RUN_STARTED", { status: "PREPARING" });
    this.emit("RUN_STATUS_CHANGED", { status: "PREPARING" });
    return "PREPARE";
  }

  onSurfaceReady(res: boolean | SurfaceProbeResult): ImportEffect {
    if (this.isTerminal()) return "NONE";
    const ok = res === true || (typeof res === "object" && res.ok);
    if (!ok) {
      const code = typeof res === "object" && res.blockerCode ? res.blockerCode : "UNSUPPORTED_STATE";
      // A login or expired session is something the seller clears on their own screen — recoverable.
      // An unrecognised surface is not, and stays terminal.
      const recoverable = code === "LOGIN_REQUIRED" || code === "SESSION_EXPIRED";
      return recoverable ? this.block(code, true) : this.fail(code);
    }
    return "READ_FACTS";
  }

  /**
   * The surface's facts fix the step plan for the whole run. Called exactly once, before any step is
   * published, so `totalSteps` is stable from the frontend's first view onward.
   */
  onFactsRead(facts: ImportSurfaceFacts): ImportEffect {
    if (this.isTerminal()) return "NONE";
    this.facts = facts;
    this.plan = importStepPlan(facts);
    this.stage = "SHOW_REQUIRED_RANGE";
    this.activeStepIndex = 2;
    // The required window reaches the frontend as sanitized copy params, so the seller can see the target
    // before touching anything. Dates for a segment are not customer data.
    this.emit("STEP_READY", {
      stepId: this.stepId(),
      stepStatus: "PREPARING",
    });
    this.completedSteps = 1;
    this.stage = "LOCATE_START";
    this.activeStepIndex = 3;
    this.completedSteps = 2;
    this.emit("RUN_STATUS_CHANGED", { status: "RUNNING" });
    return { locate: "start_date" };
  }

  onTargetLocated(target: ImportTarget, res: LocateResult): ImportEffect {
    if (this.isTerminal()) return "NONE";
    if (res.count > 1) return this.fail("TARGET_AMBIGUOUS");
    if (res.count === 0 || !res.sig) return this.fail("TARGET_NOT_FOUND");
    this.targetSig[target] = res.sig;
    // A date control is asked one question before anything is annotated: does it already hold the value this
    // segment needs? Asked BEFORE the highlight rather than after, so a step the seller does not have to
    // perform never flashes an annotation at them (finding 13).
    if (target === "start_date" || target === "end_date") {
      this.stage = this.highlightStageFor(target);
      return { prefilled: target };
    }
    this.stage = this.highlightStageFor(target);
    return { highlight: target };
  }

  /**
   * The date control's current value, as a verdict.
   *
   * `true` completes the step as `SKIPPED` — the seller has nothing to do, and asking them to change a
   * correct date so a change listener fires is the defect this closes, not a workaround for it. The step keeps
   * its slot in the plan and its number, exactly as `CONFIRM_RANGE` does, so `totalSteps` never moves under
   * the frontend. The scope gate still runs afterwards and is still the only thing that can reach the export
   * control: a skipped step is a step nobody needed, not a check nobody made.
   */
  onTargetPrefilled(target: ImportTarget, satisfied: boolean): ImportEffect {
    if (this.isTerminal()) return "NONE";
    if (this.stage !== this.highlightStageFor(target)) return "NONE";
    if (!satisfied) return { highlight: target };
    this.completedSteps = this.activeStepIndex;
    this.emit("STEP_COMPLETED", { stepId: this.stepId(), stepStatus: "SKIPPED" });
    return this.advanceAfterBarrier(target);
  }

  /**
   * The driver re-validated while annotating. A changed unique match between locate and highlight means
   * the surface moved under us, so fail closed rather than highlight the wrong control — the anti-drift
   * rule the reply runtime established.
   */
  onTargetHighlighted(target: ImportTarget, res: LocateResult): ImportEffect {
    if (this.isTerminal()) return "NONE";
    if (res.count > 1) return this.fail("TARGET_AMBIGUOUS");
    if (res.count === 0 || !res.sig || res.sig !== this.targetSig[target]) {
      return this.fail("TARGET_NOT_FOUND");
    }
    this.stage = this.barrierStageFor(target);
    this.emit("STEP_READY", { stepId: this.stepId(), stepStatus: "READY" });
    this.emit("HUMAN_ACTION_REQUIRED", { stepId: this.stepId() });
    this.emit("TARGET_HIGHLIGHTED", { stepId: this.stepId(), targetRef: res.sig });
    this.emit("RUN_STATUS_CHANGED", { status: "WAITING_FOR_HUMAN" });
    return { observe: target };
  }

  /**
   * The seller acted on the control. An OBSERVATION — it advances only a still-open barrier for that same
   * target, so a late or duplicated observation cannot skip a step.
   */
  onTargetActionObserved(target: ImportTarget): ImportEffect {
    if (BARRIER_TARGET[this.stage] !== target) return "NONE";
    this.emit("USER_ACTION_OBSERVED", { stepId: this.stepId(), observed: true });
    this.completedSteps = this.activeStepIndex;
    this.emit("STEP_COMPLETED", { stepId: this.stepId(), stepStatus: "COMPLETED" });
    return this.advanceAfterBarrier(target);
  }

  /** Where the run goes once a barrier's control has been acted on. */
  private advanceAfterBarrier(target: ImportTarget): ImportEffect {
    switch (target) {
      case "start_date":
        this.activeStepIndex += 1;
        this.stage = "LOCATE_END";
        return { locate: "end_date" };
      case "end_date":
        // Apply first when the surface has one — the range is not in effect until it is pressed, so
        // reading the scope before that would read the PREVIOUS window and could pass a stale match.
        if (this.facts?.requiresApply) {
          this.activeStepIndex += 1;
          this.stage = "LOCATE_APPLY";
          return { locate: "apply_range" };
        }
        this.stage = "READ_SCOPE";
        this.emit("RUN_STATUS_CHANGED", { status: "RUNNING" });
        return "READ_SCOPE";
      case "apply_range":
        this.stage = "READ_SCOPE";
        this.emit("RUN_STATUS_CHANGED", { status: "RUNNING" });
        return "READ_SCOPE";
      case "export":
        this.activeStepIndex += 1;
        this.stage = "LOCATE_CONSENT";
        return { locate: "consent" };
      case "consent":
        this.activeStepIndex += 1;
        this.stage = "DETECT_DOWNLOAD";
        this.emit("RUN_STATUS_CHANGED", { status: "PROCESSING" });
        return "DETECT_DOWNLOAD";
    }
  }

  /**
   * The gate. Three answers, three obligations — and only one of them reaches the export control.
   *
   * `UNREADABLE` proceeds but inserts the seller's confirmation and records THEIR evidence.
   * `MISMATCH` parks recoverably: nothing highlights export until the selected window agrees.
   */
  onScopeRead(match: ScopeMatch): ImportEffect {
    if (this.isTerminal()) return "NONE";
    const decision = gateOnScope(match);
    if (!decision.proceed) {
      this.blockerCode = "SCOPE_MISMATCH";
      this.blockerRecoverable = true;
      this.stage = "SCOPE_BLOCKED";
      this.emit("RUN_BLOCKED", { code: "SCOPE_MISMATCH", recoverable: true });
      this.emit("RUN_STATUS_CHANGED", { status: "WAITING_FOR_HUMAN" });
      // FIXED (proof record, finding 12). This used to return `NONE`, which left the page exactly as it was —
      // so the previous step's highlight sat on the date field the seller had just left, reading as "still
      // waiting for this" on a run that had stopped 30 seconds earlier, and the operator kept changing a date
      // no barrier was watching. The annotation comes off, and the session then renders the stop — cause, fix
      // and the recheck control — in the marketplace page where the seller actually is.
      return "CLEAR_HIGHLIGHT";
    }
    // Advance past the CONFIRM_RANGE slot. It always exists in the plan; when the runtime read the range
    // itself the slot is reported SKIPPED rather than removed, so totalSteps never moves.
    this.activeStepIndex += 1;
    if (decision.insertConfirmStage) {
      this.scopeEvidence = "OPERATOR_CONFIRMED";
      this.stage = "WAIT_FOR_RANGE_CONFIRM";
      this.emit("STEP_READY", { stepId: this.stepId(), stepStatus: "READY" });
      this.emit("HUMAN_ACTION_REQUIRED", { stepId: this.stepId() });
      this.emit("RUN_STATUS_CHANGED", { status: "WAITING_FOR_HUMAN" });
      return "NONE";
    }
    this.scopeEvidence = "MACHINE_MATCHED";
    this.completedSteps = this.activeStepIndex;
    this.emit("STEP_COMPLETED", { stepId: this.stepId(), stepStatus: "SKIPPED" });
    this.activeStepIndex += 1;
    this.stage = "LOCATE_EXPORT";
    return { locate: "export" };
  }

  /** The seller confirmed the dates. Their confirmation is the evidence — already recorded as such. */
  private onRangeConfirmed(): ImportEffect {
    if (this.stage !== "WAIT_FOR_RANGE_CONFIRM") return "NONE";
    this.completedSteps = this.activeStepIndex;
    this.emit("STEP_COMPLETED", { stepId: this.stepId(), stepStatus: "COMPLETED" });
    this.activeStepIndex += 1;
    this.stage = "LOCATE_EXPORT";
    this.emit("RUN_STATUS_CHANGED", { status: "RUNNING" });
    return { locate: "export" };
  }

  onDownloadDetected(res: DownloadDetectResult): ImportEffect {
    if (this.isTerminal()) return "NONE";
    if (!res.detected || !res.artifactRef) return this.fail("DOWNLOAD_TIMEOUT");
    this.artifactRef = res.artifactRef;
    this.emit("DOWNLOAD_DETECTED", { stepId: this.stepId(), artifactRef: res.artifactRef });
    this.stage = "VALIDATE_ARTIFACT";
    return "VALIDATE_ARTIFACT";
  }

  onArtifactValidated(res: ArtifactValidateResult): ImportEffect {
    if (this.isTerminal()) return "NONE";
    if (!res.valid) return this.fail("ARTIFACT_INVALID");
    this.stage = "INGEST";
    return "INGEST";
  }

  /**
   * The server answered. `processed === 0` is a legitimate all-duplicates or empty-window outcome and
   * completes the run — an empty month is a fact about the seller's history, not a failure.
   */
  onIngested(res: IngestResult): ImportEffect {
    if (this.isTerminal()) return "NONE";
    if (!res.ok) return this.fail("INGEST_FAILED");
    this.processed = res.processed;
    this.completedSteps = this.plan.length;
    this.activeStepIndex = this.plan.length;
    this.stage = "COMPLETED";
    this.emit("STEP_COMPLETED", { stepId: this.stepId(), stepStatus: "COMPLETED" });
    // Deliberately NO row count on the wire. Neither v1 nor v2 `EventPayload` carries one, and roadmap
    // §9 forbids exact row counts in runtime output — the seller's own count comes from the backend's
    // attempt/coverage surface, which is authoritative anyway. The engine keeps it internally for the
    // agent's sanitized log line (a bucket, not a number).
    this.emit("RUN_COMPLETED", { status: "COMPLETED" });
    return "CLEANUP";
  }

  /* ── operator-driven transitions ──────────────────────────────────────────── */

  private pause(): ImportEffect {
    this.stage = "PAUSED";
    this.emit("RUN_STATUS_CHANGED", { status: "PAUSED" });
    return "NONE";
  }

  /**
   * Resume re-enters the barrier rather than re-driving anything. Nothing here is a marketplace action, so
   * there is no double-action hazard — but re-locating from scratch could annotate a control the seller has
   * since moved past, so the barrier is where a resumed run belongs.
   */
  private resume(): ImportEffect {
    const target = BARRIER_TARGET[this.stage];
    this.stage = target ? this.stage : "READ_SCOPE";
    this.emit("RUN_STATUS_CHANGED", { status: target ? "WAITING_FOR_HUMAN" : "RUNNING" });
    return target ? { observe: target } : "READ_SCOPE";
  }

  private cancel(): ImportEffect {
    this.stage = "CANCELLED";
    this.emit("RUN_STATUS_CHANGED", { status: "CANCELLED" });
    return "CLEANUP";
  }

  /**
   * The seller chose to finish on NAVER without guidance. Not a failure and not a completion: guidance
   * stops, annotations come off, and nothing claims a file was imported.
   */
  private abandonToManual(): ImportEffect {
    this.stage = "CANCELLED";
    this.emit("RUN_STATUS_CHANGED", { status: "CANCELLED" });
    return "CLEANUP";
  }

  private block(code: "LOGIN_REQUIRED" | "SESSION_EXPIRED", recoverable: boolean): ImportEffect {
    this.blockerCode = code;
    this.blockerRecoverable = recoverable;
    this.stage = "FAILED";
    this.emit("RUN_BLOCKED", { code, recoverable });
    this.emit("RUN_FAILED", { code });
    return "CLEANUP";
  }

  private fail(code: ImportBlockerCode): ImportEffect {
    this.blockerCode = code;
    this.blockerRecoverable = false;
    this.stage = "FAILED";
    this.emit("RUN_BLOCKED", { code, recoverable: false });
    this.emit("RUN_FAILED", { code });
    return "CLEANUP";
  }

  /* ── stage helpers ────────────────────────────────────────────────────────── */

  private highlightStageFor(target: ImportTarget): ImportStage {
    switch (target) {
      case "start_date":
        return "HIGHLIGHT_START";
      case "end_date":
        return "HIGHLIGHT_END";
      case "apply_range":
        return "HIGHLIGHT_APPLY";
      case "export":
        return "HIGHLIGHT_EXPORT";
      case "consent":
        return "HIGHLIGHT_CONSENT";
    }
  }

  private barrierStageFor(target: ImportTarget): ImportStage {
    switch (target) {
      case "start_date":
        return "WAIT_FOR_START";
      case "end_date":
        return "WAIT_FOR_END";
      case "apply_range":
        return "WAIT_FOR_APPLY";
      case "export":
        return "WAIT_FOR_EXPORT";
      case "consent":
        return "WAIT_FOR_CONSENT";
    }
  }

  /* ── outbound state ──────────────────────────────────────────────────────── */

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
    return this.plan.length === 0 ? "aw.import_open_review_surface" : importStepMetaAt(this.plan, this.activeStepIndex).stepId;
  }

  view(): ActionWindowRunView {
    const totalSteps = this.plan.length || importStepPlan({ requiresApply: false, requiresFilters: false }).length;
    const meta =
      this.plan.length === 0
        ? { stepNumber: 1, stepId: this.stepId(), copyKey: "actionWindow.import.openReviewSurface" }
        : importStepMetaAt(this.plan, this.activeStepIndex);
    const status: RunStatus = importStageToRunStatus(this.stage);
    const view: ActionWindowRunView = {
      protocolVersion: 2,
      runId: this.runId,
      revision: this.revision,
      channelCode: this.channelCode,
      runCopyKey: RUN_COPY_KEY,
      status,
      executionMode: "ACTION_WINDOW",
      intent: "INITIAL_REVIEW_IMPORT_SEGMENT",
      currentStep: {
        stepId: meta.stepId,
        stepNumber: meta.stepNumber,
        totalSteps,
        copyKey: meta.copyKey,
        // The required window travels as sanitized primitives so the frontend can show the seller the
        // target dates. A segment's dates are not customer data.
        copyParams: {
          ...("copyParams" in meta && meta.copyParams ? meta.copyParams : {}),
          requiredStart: this.required.start,
          requiredEnd: this.required.end,
        },
        status: importStageToStepStatus(this.stage),
      },
      guidanceEnabled: this.guidanceEnabled,
      allowedCommands: [...importAllowedCommands(this.stage)],
      progress: { completedSteps: this.completedSteps, totalSteps },
      updatedAt: this.clock(),
    };
    // A blocker is exposed while the run is stopped for it — including the recoverable scope park, which
    // is NOT a failure and must not be rendered as one.
    if (this.blockerCode && (this.stage === "FAILED" || this.stage === "SCOPE_BLOCKED")) {
      view.blocker = { code: this.blockerCode as never, recoverable: this.blockerRecoverable };
    }
    return view;
  }

  events(): readonly EventEnvelope[] {
    return this.log;
  }
  currentStage(): ImportStage {
    return this.stage;
  }
  isStarted(): boolean {
    return this.started;
  }
  /** The evidence for how the scope was established. Null until the gate has spoken. */
  recordedScopeEvidence(): ImportScopeEvidence | null {
    return this.scopeEvidence;
  }
  /** Rows the server reported ingesting. Null until the run completed. */
  processedCount(): number | null {
    return this.processed;
  }
  detectedArtifactRef(): string | null {
    return this.artifactRef;
  }
  /** The stage sequence this run follows. Empty until the surface facts are read. */
  stagePlan(): readonly string[] {
    return this.facts ? importStagePlan(this.facts) : [];
  }
  /** Whether the run is resting on the seller right now. */
  isAtBarrier(): boolean {
    return isImportBarrier(this.stage) || this.stage === "SCOPE_BLOCKED";
  }
  /** The single-use authorization for this run. Exposed to the ingest wiring ONLY — never emitted. */
  boundImportRef(): string {
    return this.importRef;
  }
}
