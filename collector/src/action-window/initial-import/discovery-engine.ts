/**
 * **Action Window Runtime — range-discovery engine (ISOLATED, v2).**
 *
 * A pure reducer for the run that precedes the plan. It establishes the historical range NAVER currently
 * lets this seller reach and reports it, which creates the monthly plan server-side.
 *
 * **The three things this engine exists to guarantee** — the same three the segment engine guarantees, in the
 * terms of a different job:
 *
 *  1. **It never acts on the marketplace.** Its effects are PREPARE / READ_BOUNDS / LOCATE / HIGHLIGHT /
 *     OBSERVE / READ_SELECTED / REPORT_RANGE / CLEANUP. Nothing clicks, types or submits; when the bounds are
 *     unreadable the SELLER picks the dates and the runtime watches.
 *  2. **Evidence is never upgraded.** `MACHINE_DISCOVERED` is recorded only when the controls themselves
 *     declared the bounds. A range the seller selected is `OPERATOR_CONFIRMED` — and stays that, forever.
 *     The backend refuses to default this field precisely so the choice has to be made here, once, honestly.
 *  3. **A range is reported only when it was actually established.** An unreadable read-back after the
 *     seller's own selection fails the run closed; it never falls back to a plausible depth. A guessed start
 *     date would be indistinguishable, downstream, from a measured one — and would silently claim months of
 *     history that were never reachable.
 *
 * Pure: no I/O, no browser, no wall-clock.
 */
import type {
  ActionWindowRunView,
  EventEnvelope,
  EventPayload,
  EventType,
  RunStatus,
} from "../../../../contracts/action-window/v2/index";
import type { AvailableRangeVerdict } from "../../naver/available-range-discovery";
import type { LocateResult, SurfaceProbeResult } from "../engine";
import {
  DISCOVERY_TERMINAL_STAGES,
  DISCOVERY_TOTAL_STEPS,
  discoveryAllowedCommands,
  discoveryStageToRunStatus,
  discoveryStageToStepStatus,
  discoveryStepMetaAt,
  isDiscoveryBarrier,
  type DiscoveryStage,
} from "./discovery-stages";
import type { DiscoveredRange, ImportTarget } from "./import-driver";

/** What the session should do next. Every one is observation, annotation, or a report to our own server. */
export type DiscoveryEffect =
  | "PREPARE"
  | "READ_BOUNDS"
  | { locate: ImportTarget }
  | { highlight: ImportTarget }
  | { observe: ImportTarget }
  | "READ_SELECTED"
  | "REPORT_RANGE"
  | "CLEANUP"
  | "NONE";

/** How the reported range was established. Mirrors the backend's `RangeDiscoveryEvidence`. */
export type DiscoveryEvidence = "MACHINE_DISCOVERED" | "OPERATOR_CONFIRMED";

export type DiscoveryBlockerCode =
  | "LOGIN_REQUIRED"
  | "SESSION_EXPIRED"
  | "UNSUPPORTED_STATE"
  | "TARGET_NOT_FOUND"
  | "TARGET_AMBIGUOUS"
  /**
   * The server would not record the range.
   *
   * Reused rather than given a new code: the failure class is exactly the one `INGEST_FAILED` already names —
   * the runtime did its part and the server did not accept the result — and the frontend's existing copy for
   * it ("저장 중 문제가 생겼어요") is scope-neutral, so it reads correctly here. A new blocker code would be a
   * contract change that bought a synonym.
   */
  | "INGEST_FAILED";

export type DiscoveryCommandOutcome =
  | { ok: true; idempotent: boolean; effect: DiscoveryEffect }
  | { ok: false; reason: string };

export interface DiscoveryRunConfig {
  runId: string;
  channelCode: string;
  /** Opaque 16-hex single-use authorization for THIS discovery. Never logged, never emitted. */
  discoveryRef: string;
}

export type DiscoveryClock = () => string;

/** Synthetic monotonic occurrence marker (NOT wall-clock). `occurredAt` is opaque, display-only. */
export function makeDiscoveryClock(start = 1): DiscoveryClock {
  let n = start;
  return () => `2026-01-01T00:00:00.${String(n++).padStart(6, "0")}Z`;
}

const RUN_COPY_KEY = "actionWindow.run.naverInitialReviewImportDiscovery";

/** Which target each barrier stage rests on — used to arm and await the right control. */
const BARRIER_TARGET: Readonly<Partial<Record<DiscoveryStage, ImportTarget>>> = {
  WAIT_FOR_EARLIEST: "start_date",
  WAIT_FOR_LATEST: "end_date",
};

export class ImportDiscoveryEngine {
  private readonly runId: string;
  private readonly channelCode: string;
  private readonly discoveryRef: string;
  private readonly clock: DiscoveryClock;

  private started = false;
  private stage: DiscoveryStage = "PREPARE_SESSION";
  private revision = 0;
  private seq = 0;
  private activeStepIndex = 1;
  private completedSteps = 0;
  private guidanceEnabled = true;
  private targetSig: Partial<Record<ImportTarget, string>> = {};
  private evidence: DiscoveryEvidence | null = null;
  private range: DiscoveredRange | null = null;
  private blockerCode: DiscoveryBlockerCode | null = null;
  private blockerRecoverable = false;
  private readonly log: EventEnvelope[] = [];

  constructor(config: DiscoveryRunConfig, opts?: { clock?: DiscoveryClock }) {
    this.runId = config.runId;
    this.channelCode = config.channelCode;
    this.discoveryRef = config.discoveryRef;
    this.clock = opts?.clock ?? makeDiscoveryClock();
    if (!/^[0-9a-f]{16}$/.test(config.discoveryRef)) {
      // Fail closed at construction, as the segment engine does: a malformed ref cannot authorize the plan
      // creation this run ends in, and discovering that after the seller has picked their dates wastes their
      // time on a run that could never have finished.
      throw new Error("discovery-engine: discoveryRef must be 16 lowercase hex characters");
    }
  }

  private isTerminal(): boolean {
    return DISCOVERY_TERMINAL_STAGES.includes(this.stage);
  }

  /* ── inbound command ─────────────────────────────────────────────────────── */

  command(command: { type: string; expectedRevision: number }): DiscoveryCommandOutcome {
    if (!this.started) {
      if (command.type !== "START_RUN") return { ok: false, reason: "INVALID_FOR_STATE" };
      return { ok: true, idempotent: false, effect: this.start() };
    }
    if (command.type === "START_RUN") return { ok: true, idempotent: true, effect: "NONE" };
    if (command.expectedRevision < this.revision) return { ok: false, reason: "STALE_REVISION" };
    if (!discoveryAllowedCommands(this.stage).includes(command.type as never)) {
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

  /** "I picked it, look again." Re-arms observation; it never completes the step on the client's word. */
  private recheck(): DiscoveryEffect {
    const target = BARRIER_TARGET[this.stage];
    return target ? { observe: target } : "NONE";
  }

  /* ── automatic-drive callbacks ────────────────────────────────────────────── */

  private start(): DiscoveryEffect {
    this.started = true;
    this.stage = "PREPARE_SESSION";
    this.activeStepIndex = 1;
    this.emit("RUN_STARTED", { status: "PREPARING" });
    this.emit("RUN_STATUS_CHANGED", { status: "PREPARING" });
    return "PREPARE";
  }

  onSurfaceReady(res: boolean | SurfaceProbeResult): DiscoveryEffect {
    if (this.isTerminal()) return "NONE";
    const ok = res === true || (typeof res === "object" && res.ok);
    if (!ok) {
      const code = typeof res === "object" && res.blockerCode ? res.blockerCode : "UNSUPPORTED_STATE";
      // Same split as the segment run: a login or an expired session is something the seller clears on
      // their own screen; an unrecognised surface is not.
      const recoverable = code === "LOGIN_REQUIRED" || code === "SESSION_EXPIRED";
      return recoverable ? this.block(code, true) : this.fail(code);
    }
    this.completedSteps = 1;
    this.activeStepIndex = 2;
    this.stage = "READ_BOUNDS";
    this.emit("STEP_READY", { stepId: this.stepId(), stepStatus: "OBSERVING" });
    return "READ_BOUNDS";
  }

  /**
   * The bounds answer decides which shape this run has — and it is the ONLY moment either shape is chosen.
   *
   * A machine-read range skips both seller barriers, reporting them `SKIPPED` rather than removing them, so
   * `totalSteps` never moves. An unreadable one guides the seller through the same two date controls a
   * segment run uses.
   */
  onBoundsRead(verdict: AvailableRangeVerdict): DiscoveryEffect {
    if (this.isTerminal()) return "NONE";
    this.completedSteps = 2;
    if (verdict.evidence === "MACHINE_DISCOVERED" && verdict.availableStart && verdict.availableEnd) {
      this.evidence = "MACHINE_DISCOVERED";
      this.range = { start: verdict.availableStart, end: verdict.availableEnd };
      // Both barrier slots are spent at once: neither is performed, and both keep their place in the plan.
      this.activeStepIndex = 3;
      this.emit("STEP_COMPLETED", { stepId: this.stepId(), stepStatus: "SKIPPED" });
      this.activeStepIndex = 4;
      this.emit("STEP_COMPLETED", { stepId: this.stepId(), stepStatus: "SKIPPED" });
      this.completedSteps = 4;
      this.activeStepIndex = 5;
      this.stage = "REPORT_RANGE";
      this.emit("RUN_STATUS_CHANGED", { status: "PROCESSING" });
      return "REPORT_RANGE";
    }
    this.activeStepIndex = 3;
    this.stage = "LOCATE_EARLIEST";
    this.emit("RUN_STATUS_CHANGED", { status: "RUNNING" });
    return { locate: "start_date" };
  }

  onTargetLocated(target: ImportTarget, res: LocateResult): DiscoveryEffect {
    if (this.isTerminal()) return "NONE";
    if (res.count > 1) return this.fail("TARGET_AMBIGUOUS");
    if (res.count === 0 || !res.sig) return this.fail("TARGET_NOT_FOUND");
    this.targetSig[target] = res.sig;
    this.stage = target === "start_date" ? "HIGHLIGHT_EARLIEST" : "HIGHLIGHT_LATEST";
    return { highlight: target };
  }

  /** The anti-drift check: a unique match that changed between locate and highlight fails the run closed. */
  onTargetHighlighted(target: ImportTarget, res: LocateResult): DiscoveryEffect {
    if (this.isTerminal()) return "NONE";
    if (res.count > 1) return this.fail("TARGET_AMBIGUOUS");
    if (res.count === 0 || !res.sig || res.sig !== this.targetSig[target]) {
      return this.fail("TARGET_NOT_FOUND");
    }
    this.stage = target === "start_date" ? "WAIT_FOR_EARLIEST" : "WAIT_FOR_LATEST";
    this.emit("STEP_READY", { stepId: this.stepId(), stepStatus: "READY" });
    this.emit("HUMAN_ACTION_REQUIRED", { stepId: this.stepId() });
    this.emit("TARGET_HIGHLIGHTED", { stepId: this.stepId(), targetRef: res.sig });
    this.emit("RUN_STATUS_CHANGED", { status: "WAITING_FOR_HUMAN" });
    return { observe: target };
  }

  /** An OBSERVATION — it advances only a still-open barrier for that same target. */
  onTargetActionObserved(target: ImportTarget): DiscoveryEffect {
    if (BARRIER_TARGET[this.stage] !== target) return "NONE";
    this.emit("USER_ACTION_OBSERVED", { stepId: this.stepId(), observed: true });
    this.completedSteps = this.activeStepIndex;
    this.emit("STEP_COMPLETED", { stepId: this.stepId(), stepStatus: "COMPLETED" });
    if (target === "start_date") {
      this.activeStepIndex = 4;
      this.stage = "LOCATE_LATEST";
      return { locate: "end_date" };
    }
    this.activeStepIndex = 5;
    this.stage = "READ_SELECTED";
    this.emit("RUN_STATUS_CHANGED", { status: "RUNNING" });
    return "READ_SELECTED";
  }

  /**
   * The seller's own selection, read back.
   *
   * Unreadable fails the run — it does NOT fall back to a guessed depth, and it does not report the range as
   * operator-confirmed on the strength of two clicks nobody could read. `UNSUPPORTED_STATE` is the honest
   * code: we cannot read this surface's dates, and the seller's route forward is the manual period entry.
   */
  onSelectedRangeRead(range: DiscoveredRange | null): DiscoveryEffect {
    if (this.isTerminal()) return "NONE";
    if (!range || range.start > range.end) return this.fail("UNSUPPORTED_STATE");
    this.evidence = "OPERATOR_CONFIRMED";
    this.range = range;
    this.stage = "REPORT_RANGE";
    this.emit("RUN_STATUS_CHANGED", { status: "PROCESSING" });
    return "REPORT_RANGE";
  }

  /** The server accepted the range and the plan exists. This is the only path to `COMPLETED`. */
  onRangeReported(ok: boolean): DiscoveryEffect {
    if (this.isTerminal()) return "NONE";
    if (!ok) return this.fail("INGEST_FAILED");
    this.completedSteps = DISCOVERY_TOTAL_STEPS;
    this.activeStepIndex = DISCOVERY_TOTAL_STEPS;
    this.stage = "COMPLETED";
    this.emit("STEP_COMPLETED", { stepId: this.stepId(), stepStatus: "COMPLETED" });
    // Deliberately NO dates on the wire. The frontend reads the plan it just created from the backend,
    // which is authoritative anyway; an event payload has no field for a date and must not grow one.
    this.emit("RUN_COMPLETED", { status: "COMPLETED" });
    return "CLEANUP";
  }

  /* ── operator-driven transitions ──────────────────────────────────────────── */

  private pause(): DiscoveryEffect {
    this.stage = "PAUSED";
    this.emit("RUN_STATUS_CHANGED", { status: "PAUSED" });
    return "NONE";
  }

  /** Resume re-enters the barrier. Nothing here is a marketplace action, so there is no double-action risk. */
  private resume(): DiscoveryEffect {
    const target = BARRIER_TARGET[this.stage];
    if (!target) {
      this.stage = "READ_BOUNDS";
      this.emit("RUN_STATUS_CHANGED", { status: "PREPARING" });
      return "READ_BOUNDS";
    }
    this.emit("RUN_STATUS_CHANGED", { status: "WAITING_FOR_HUMAN" });
    return { observe: target };
  }

  private cancel(): DiscoveryEffect {
    this.stage = "CANCELLED";
    this.emit("RUN_STATUS_CHANGED", { status: "CANCELLED" });
    return "CLEANUP";
  }

  /**
   * The seller chose to set the period themselves. Not a failure and not a completion: guidance stops,
   * annotations come off, and no plan is claimed to exist.
   */
  private abandonToManual(): DiscoveryEffect {
    this.stage = "CANCELLED";
    this.emit("RUN_STATUS_CHANGED", { status: "CANCELLED" });
    return "CLEANUP";
  }

  private block(code: "LOGIN_REQUIRED" | "SESSION_EXPIRED", recoverable: boolean): DiscoveryEffect {
    this.blockerCode = code;
    this.blockerRecoverable = recoverable;
    this.stage = "FAILED";
    this.emit("RUN_BLOCKED", { code, recoverable });
    this.emit("RUN_FAILED", { code });
    return "CLEANUP";
  }

  private fail(code: DiscoveryBlockerCode): DiscoveryEffect {
    this.blockerCode = code;
    this.blockerRecoverable = false;
    this.stage = "FAILED";
    this.emit("RUN_BLOCKED", { code, recoverable: false });
    this.emit("RUN_FAILED", { code });
    return "CLEANUP";
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
    return discoveryStepMetaAt(this.activeStepIndex).stepId;
  }

  view(): ActionWindowRunView {
    const meta = discoveryStepMetaAt(this.activeStepIndex);
    const status: RunStatus = discoveryStageToRunStatus(this.stage);
    const view: ActionWindowRunView = {
      protocolVersion: 2,
      runId: this.runId,
      revision: this.revision,
      channelCode: this.channelCode,
      runCopyKey: RUN_COPY_KEY,
      status,
      executionMode: "ACTION_WINDOW",
      intent: "INITIAL_REVIEW_IMPORT_DISCOVERY",
      currentStep: {
        stepId: meta.stepId,
        stepNumber: meta.stepNumber,
        totalSteps: DISCOVERY_TOTAL_STEPS,
        copyKey: meta.copyKey,
        // No dates here, unlike a segment view: a segment's required window comes from the server and is the
        // target the seller must match, whereas a discovery run has no target — it is finding one out.
        ...(meta.copyParams ? { copyParams: meta.copyParams } : {}),
        status: discoveryStageToStepStatus(this.stage),
      },
      guidanceEnabled: this.guidanceEnabled,
      allowedCommands: [...discoveryAllowedCommands(this.stage)],
      progress: { completedSteps: this.completedSteps, totalSteps: DISCOVERY_TOTAL_STEPS },
      updatedAt: this.clock(),
    };
    if (this.blockerCode && this.stage === "FAILED") {
      view.blocker = { code: this.blockerCode as never, recoverable: this.blockerRecoverable };
    }
    return view;
  }

  events(): readonly EventEnvelope[] {
    return this.log;
  }
  currentStage(): DiscoveryStage {
    return this.stage;
  }
  isStarted(): boolean {
    return this.started;
  }
  /** How the range was established. Null until it has been. Never defaulted, never upgraded. */
  recordedEvidence(): DiscoveryEvidence | null {
    return this.evidence;
  }
  /** The established range, for the report effect only. Null until established. */
  establishedRange(): DiscoveredRange | null {
    return this.range;
  }
  /** Whether the run is resting on the seller right now. */
  isAtBarrier(): boolean {
    return isDiscoveryBarrier(this.stage);
  }
  /** The single-use authorization for this run. Exposed to the report wiring ONLY — never emitted. */
  boundDiscoveryRef(): string {
    return this.discoveryRef;
  }
}
