/**
 * **Action Window Runtime — `REVIEW_ACQUISITION` engine (ISOLATED, v2).**
 *
 * A pure reducer for ONE Coupang WING 상품평 read the seller drives page by page from a SellerOps screen or a
 * conversation (product-owner decision, 2026-08-28).
 *
 * **The guarantees this engine exists to make structural:**
 *
 *  1. **It cannot act on the marketplace.** Its effect vocabulary is `RESOLVE` / `READ` / `HANDOFF` /
 *     `CLEANUP` / `NONE`. Nothing navigates, pages, clicks, types, or submits — the seller turns every page,
 *     and a future edit that wanted a page turn would have to add an effect in the open.
 *  2. **It never holds a review.** The engine knows an opaque `acquisitionRef`, a stage, and integers. The
 *     rows a page yielded live in the SESSION's `ReviewAcquisitionSession` and go from there to the handoff
 *     client; they never enter this reducer, so no view, event, or log it produces can carry a customer's
 *     words.
 *  3. **Completion is a reading, not an inference.** `coverageComplete` is true only when the walk's own rule
 *     said the pager showed its last page. A walk the seller ended early, or that stopped on a pager it could
 *     not read, is COMPLETED with `coverageComplete=false` — stored, and not rounded up.
 *  4. **One handoff, at the end.** Nothing is stored page by page; a cancel before the handoff stores nothing.
 *
 * Pure: no I/O, no browser, no wall-clock.
 */
import type {
  ActionWindowRunView,
  BlockerCode,
  EventEnvelope,
  EventPayload,
  EventType,
  RunStatus,
} from "../../../../contracts/action-window/v2/index";
import {
  REVIEW_ACQUISITION_RUN_COPY_KEY,
  REVIEW_ACQUISITION_TOTAL_STEPS,
  isReviewAcquisitionTerminal,
  reviewAcquisitionAllowedCommands,
  reviewAcquisitionStageToRunStatus,
  reviewAcquisitionStageToStepStatus,
  reviewAcquisitionStepMetaAt,
  type ReviewAcquisitionStage,
} from "./review-acquisition-stages";

export type ReviewAcquisitionEffect = "RESOLVE" | "READ" | "HANDOFF" | "CLEANUP" | "NONE";

export type ReviewAcquisitionCommandOutcome =
  | { ok: true; idempotent: boolean; effect: ReviewAcquisitionEffect }
  | { ok: false; reason: string };

export interface ReviewAcquisitionRunConfig {
  runId: string;
  /** Sanitized channel identity (SEMANTIC_CODE) — `coupang`. */
  channelCode: string;
}

export type ReviewAcquisitionClock = () => string;

export function makeReviewAcquisitionClock(start = 1): ReviewAcquisitionClock {
  let n = start;
  return () => `2026-01-01T00:00:00.${String(n++).padStart(6, "0")}Z`;
}

const HEX16 = /^[0-9a-f]{16}$/;

/**
 * What the session learned from one read, reduced to what the engine may know. `readable=false` is "this is
 * not a 상품평 list I can read" — a park, not a page. Everything else is the walk's own verdict on the page.
 */
export interface ReviewAcquisitionPageReport {
  readonly readable: boolean;
  /** The walk took the page (readable, pager resolved, page advanced, within bounds). */
  readonly accepted: boolean;
  /** The walk is still open after this page — another page may follow. */
  readonly open: boolean;
  /** Reviews collected so far across the walk (integer; never the reviews). */
  readonly collected: number;
  /** The pager showed its last page on this read. */
  readonly coverageComplete: boolean;
}

export interface ReviewAcquisitionHandoffReport {
  readonly ok: boolean;
  readonly stored: number;
}

const PARK_BLOCKER_NONE: BlockerCode | null = null;

export class ReviewAcquisitionEngine {
  private readonly runId: string;
  private readonly channelCode: string;
  private readonly clock: ReviewAcquisitionClock;

  private started = false;
  private stage: ReviewAcquisitionStage = "opening";
  private revision = 0;
  private seq = 0;
  private activeStepIndex = 1;
  private completedSteps = 0;
  private guidanceEnabled = true;
  private acquisitionRef: string | null = null;
  private blockerCode: BlockerCode | null = null;
  private blockerRecoverable = false;
  private pagesRead = 0;
  private collected = 0;
  private stored = 0;
  private coverageComplete = false;
  private readonly log: EventEnvelope[] = [];

  constructor(config: ReviewAcquisitionRunConfig, opts?: { clock?: ReviewAcquisitionClock }) {
    this.runId = config.runId;
    this.channelCode = config.channelCode;
    this.clock = opts?.clock ?? makeReviewAcquisitionClock();
  }

  /* ── inbound command ─────────────────────────────────────────────────────── */

  command(command: { type: string; expectedRevision: number; payload?: unknown }): ReviewAcquisitionCommandOutcome {
    if (!this.started) {
      if (command.type !== "START_RUN") return { ok: false, reason: "INVALID_FOR_STATE" };
      const ref = readAcquisitionRef(command.payload);
      // **No binding, no run.** A read that started without one would have nowhere to store what it read.
      if (ref === null) return { ok: false, reason: "INVALID_PAYLOAD" };
      this.acquisitionRef = ref;
      return { ok: true, idempotent: false, effect: this.start() };
    }
    if (command.type === "START_RUN") {
      const ref = readAcquisitionRef(command.payload);
      if (ref === null) return { ok: false, reason: "INVALID_PAYLOAD" };
      if (ref === this.acquisitionRef) return { ok: true, idempotent: true, effect: "NONE" };
      // A NEW binding re-arms a settled run — the seller's next read on the same helper. It does NOT interrupt
      // a walk in progress: pages already read under the old binding would be discarded without a word.
      if (!isReviewAcquisitionTerminal(this.stage)) return { ok: false, reason: "INVALID_FOR_STATE" };
      return { ok: true, idempotent: false, effect: this.rearm(ref) };
    }
    if (command.expectedRevision < this.revision) return { ok: false, reason: "STALE_REVISION" };
    if (!reviewAcquisitionAllowedCommands(this.stage).includes(command.type as never)) {
      return { ok: false, reason: "INVALID_FOR_STATE" };
    }
    switch (command.type) {
      case "FIND_CURRENT_STEP":
        return { ok: true, idempotent: true, effect: "NONE" };
      case "CANCEL_RUN":
        return { ok: true, idempotent: false, effect: this.abort() };
      case "REQUEST_STEP_RECHECK":
        // "Read the page I am on now." The seller's press is what lifts the barrier — every time.
        return { ok: true, idempotent: false, effect: this.readPage() };
      case "SWITCH_TO_MANUAL":
        // "End the walk here." What was read is handed over; coverage is not claimed.
        return { ok: true, idempotent: false, effect: this.finishEarly() };
      default:
        return { ok: false, reason: "INVALID_FOR_STATE" };
    }
  }

  private start(): ReviewAcquisitionEffect {
    this.started = true;
    this.stage = "opening";
    this.activeStepIndex = 1;
    this.emit("RUN_STARTED", { status: "PREPARING" });
    return "RESOLVE";
  }

  private rearm(ref: string): ReviewAcquisitionEffect {
    this.acquisitionRef = ref;
    this.completedSteps = 0;
    this.pagesRead = 0;
    this.collected = 0;
    this.stored = 0;
    this.coverageComplete = false;
    this.clearBlocker();
    return this.start();
  }

  private readPage(): ReviewAcquisitionEffect {
    if (this.stage !== "awaiting_page") return "NONE";
    this.clearBlocker();
    this.stage = "reading";
    this.activeStepIndex = 2;
    this.emit("RUN_STATUS_CHANGED", { status: "RUNNING" });
    return "READ";
  }

  private finishEarly(): ReviewAcquisitionEffect {
    if (this.stage !== "awaiting_page") return "NONE";
    this.clearBlocker();
    return this.endWalk();
  }

  private abort(): ReviewAcquisitionEffect {
    this.clearBlocker();
    this.stage = "operator_aborted";
    this.emit("RUN_STATUS_CHANGED", { status: "CANCELLED" });
    return "CLEANUP";
  }

  /* ── driver / session reports ───────────────────────────────────────────── */

  /** The session resolved (or failed to resolve) the binding into the account this walk collects for. */
  onTargetResolved(ok: boolean): ReviewAcquisitionEffect {
    if (isReviewAcquisitionTerminal(this.stage)) return "NONE";
    if (!ok) {
      this.stage = "binding_unresolved";
      this.blockerCode = "ACQUISITION_TARGET_UNRESOLVED";
      this.blockerRecoverable = false;
      this.emit("RUN_FAILED", { code: "ACQUISITION_TARGET_UNRESOLVED", recoverable: false });
      return "CLEANUP";
    }
    this.completedSteps = 1;
    return this.park(PARK_BLOCKER_NONE);
  }

  /** What one read of the page in front of the seller came to. */
  onPageRead(report: ReviewAcquisitionPageReport): ReviewAcquisitionEffect {
    if (this.stage !== "reading") return "NONE";
    if (!report.readable) {
      // Not a 상품평 list: the seller is on another WING page, or the page was mid-navigation. Park with the
      // one repair — bring the list up and press again. Nothing about the walk changes.
      return this.park("UNSUPPORTED_STATE");
    }
    this.collected = report.collected;
    if (report.accepted) {
      this.pagesRead += 1;
      this.coverageComplete = report.coverageComplete;
      this.emit("USER_ACTION_OBSERVED", { stepId: this.stepId(), observed: true });
    }
    if (report.open) return this.park(PARK_BLOCKER_NONE);
    return this.endWalk();
  }

  /** The ONE handoff came back. */
  onHandoff(report: ReviewAcquisitionHandoffReport): ReviewAcquisitionEffect {
    if (this.stage !== "handing_off") return "NONE";
    if (!report.ok) {
      this.stage = "handoff_rejected";
      this.blockerCode = "HANDOFF_REJECTED";
      this.blockerRecoverable = false;
      this.emit("RUN_BLOCKED", { code: "HANDOFF_REJECTED", recoverable: false });
      this.emit("RUN_FAILED", { code: "HANDOFF_REJECTED" });
      return "CLEANUP";
    }
    this.stored = report.stored;
    return this.complete();
  }

  /** A drive threw — most often the seller's own page moving under an in-page read. Park; a press re-reads. */
  onDriveFault(): ReviewAcquisitionEffect {
    if (isReviewAcquisitionTerminal(this.stage) || this.stage === "handing_off") return "NONE";
    return this.park("UNSUPPORTED_STATE");
  }

  /** The seller closed the window the run was reading. Park; only they may open one again. */
  onSurfaceClosed(): ReviewAcquisitionEffect {
    if (isReviewAcquisitionTerminal(this.stage) || this.stage === "handing_off") return "NONE";
    return this.park("SURFACE_CLOSED");
  }

  /* ── transitions ─────────────────────────────────────────────────────────── */

  private endWalk(): ReviewAcquisitionEffect {
    this.emit("STEP_COMPLETED", { stepId: reviewAcquisitionStepMetaAt(2).stepId });
    this.completedSteps = 2;
    this.activeStepIndex = 3;
    if (this.collected === 0) {
      // Pages read and nothing to store is not a handoff — the backend refuses an empty batch outright, and
      // the seller would be told their read FAILED when what happened is that there was nothing to collect.
      this.stored = 0;
      return this.complete();
    }
    this.stage = "handing_off";
    this.emit("RUN_STATUS_CHANGED", { status: "PROCESSING" });
    return "HANDOFF";
  }

  private complete(): ReviewAcquisitionEffect {
    this.clearBlocker();
    this.stage = "completed";
    this.completedSteps = REVIEW_ACQUISITION_TOTAL_STEPS;
    this.activeStepIndex = 3;
    this.emit("STEP_COMPLETED", { stepId: this.stepId() });
    this.emit("RUN_COMPLETED", { status: "COMPLETED" });
    return "CLEANUP";
  }

  /**
   * Rest on the seller at the per-page barrier. Re-parking the same way is not an event (the revision must
   * not advance without a published view, or the seller's next press is refused as stale).
   */
  private park(code: BlockerCode | null): ReviewAcquisitionEffect {
    const already = this.stage === "awaiting_page" && this.blockerCode === code;
    this.stage = "awaiting_page";
    this.activeStepIndex = 2;
    this.blockerCode = code;
    this.blockerRecoverable = code !== null;
    if (already) return "NONE";
    this.emit("RUN_STATUS_CHANGED", { status: "WAITING_FOR_HUMAN" });
    if (code) this.emit("RUN_BLOCKED", { code, recoverable: true });
    else this.emit("HUMAN_ACTION_REQUIRED", { stepId: this.stepId() });
    return "NONE";
  }

  private clearBlocker(): void {
    this.blockerCode = null;
    this.blockerRecoverable = false;
  }

  /* ── outbound state ──────────────────────────────────────────────────────── */

  isStarted(): boolean {
    return this.started;
  }

  currentStage(): ReviewAcquisitionStage {
    return this.stage;
  }

  boundAcquisitionRef(): string | null {
    return this.acquisitionRef;
  }

  /** Integers only — what the run may say about itself. */
  counts(): { pagesRead: number; collected: number; stored: number; coverageComplete: boolean } {
    return { pagesRead: this.pagesRead, collected: this.collected, stored: this.stored, coverageComplete: this.coverageComplete };
  }

  events(): readonly EventEnvelope[] {
    return this.log;
  }

  view(): ActionWindowRunView {
    const meta = reviewAcquisitionStepMetaAt(this.activeStepIndex);
    const status: RunStatus = reviewAcquisitionStageToRunStatus(this.stage);
    const view: ActionWindowRunView = {
      protocolVersion: 2,
      runId: this.runId,
      revision: this.revision,
      channelCode: this.channelCode,
      runCopyKey: REVIEW_ACQUISITION_RUN_COPY_KEY,
      // Counts only. This is the whole of what the run says about what it read.
      runCopyParams: this.counts(),
      status,
      executionMode: this.stage === "handing_off" ? "AUTOMATIC_OPERATION" : "ACTION_WINDOW",
      intent: "REVIEW_ACQUISITION",
      currentStep: {
        stepId: meta.stepId,
        stepNumber: meta.stepNumber,
        totalSteps: REVIEW_ACQUISITION_TOTAL_STEPS,
        copyKey: meta.copyKey,
        ...(meta.copyParams ? { copyParams: meta.copyParams } : {}),
        status: reviewAcquisitionStageToStepStatus(this.stage),
      },
      guidanceEnabled: this.guidanceEnabled,
      allowedCommands: [...reviewAcquisitionAllowedCommands(this.stage)],
      progress: { completedSteps: this.completedSteps, totalSteps: REVIEW_ACQUISITION_TOTAL_STEPS },
      updatedAt: this.clock(),
    };
    if (this.blockerCode && this.stage !== "completed" && this.stage !== "operator_aborted") {
      view.blocker = { code: this.blockerCode, recoverable: this.blockerRecoverable };
    }
    return view;
  }

  private stepId(): string {
    return reviewAcquisitionStepMetaAt(this.activeStepIndex).stepId;
  }

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
}

/** The `acquisitionRef` on a `START_RUN` payload — a clean opaque token, or null. */
function readAcquisitionRef(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const ref = (payload as { acquisitionRef?: unknown }).acquisitionRef;
  return typeof ref === "string" && HEX16.test(ref) ? ref : null;
}
