/**
 * **Action Window Runtime — `REVIEW_LOCATE` engine (ISOLATED, v2).**
 *
 * A pure reducer for ONE press of `[쿠팡에서 보기]`: the seller asks to be shown, on Coupang's own screen, a
 * review SellerOps already stored.
 *
 * **The guarantees this engine exists to make structural:**
 *
 *  1. **It cannot act on the marketplace.** Its whole effect vocabulary is `RESOLVE` / `LOCATE` /
 *     `CLEAR_HIGHLIGHT` / `CLEANUP` / `NONE`. There is no effect that navigates, pages, clicks, types, or
 *     submits, so a future edit that wanted one would have to add it in the open.
 *  2. **It never holds the review.** The engine knows an opaque `locateRef` and a verdict enum. The product,
 *     option, date, rating and body fingerprint that actually match a row live in the SESSION, are resolved
 *     from the backend, and are handed straight to the driver — they never enter this reducer's state, so no
 *     view, event or log it produces can carry them.
 *  3. **Two matches is a refusal, not a choice.** `ambiguous` is a park with its own blocker; there is no
 *     path from it to a highlight. The failure a lenient match produces is not "no ring" — it is a ring
 *     around a different buyer's review, which the seller would read as SellerOps telling them who said what.
 *  4. **Nothing is inferred about the rest of the list.** A page with no match parks on THIS page; the run
 *     never concludes the review is gone, and never goes looking on another page, because turning a page is
 *     the seller's.
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
import type { ReviewLocateVerdict } from "./review-locate";
import {
  REVIEW_LOCATE_RUN_COPY_KEY,
  REVIEW_LOCATE_TOTAL_STEPS,
  isReviewLocatePark,
  isReviewLocateTerminal,
  reviewLocateAllowedCommands,
  reviewLocateStageToRunStatus,
  reviewLocateStageToStepStatus,
  reviewLocateStepMetaAt,
  type ReviewLocateStage,
} from "./review-locate-stages";

/** What the session should do next. Every one is a read, an annotation, or a teardown. */
export type ReviewLocateEffect = "RESOLVE" | "LOCATE" | "CLEAR_HIGHLIGHT" | "CLEANUP" | "NONE";

export type ReviewLocateCommandOutcome =
  | { ok: true; idempotent: boolean; effect: ReviewLocateEffect }
  | { ok: false; reason: string };

export interface ReviewLocateRunConfig {
  runId: string;
  /** Sanitized channel identity (SEMANTIC_CODE) — `coupang`. */
  channelCode: string;
}

export type ReviewLocateClock = () => string;

/** Synthetic monotonic occurrence marker (NOT wall-clock). `occurredAt` is opaque, display-only. */
export function makeReviewLocateClock(start = 1): ReviewLocateClock {
  let n = start;
  return () => `2026-01-01T00:00:00.${String(n++).padStart(6, "0")}Z`;
}

const HEX16 = /^[0-9a-f]{16}$/;

/** What the driver reported, reduced to the two things the engine is allowed to know about a page. */
export interface ReviewLocateAttempt {
  readonly verdict: ReviewLocateVerdict;
  readonly highlighted: boolean;
}

/**
 * Which park each unsuccessful verdict lands in.
 *
 * <p>`INVALID_TARGET` is deliberately NOT here. It means the resolved fields could not match anything on any
 * page — a bad binding, not a bad screen — so it ends the run rather than sending the seller paging through
 * a list looking for a review no target could find. (The backend refuses to mint such a binding, so reaching
 * it is a defect on our side, and it is reported as one.)
 */
const VERDICT_PARK: Readonly<Record<"NOT_ON_PAGE" | "AMBIGUOUS" | "PAGE_UNREADABLE", ReviewLocateStage>> = {
  NOT_ON_PAGE: "not_on_page",
  AMBIGUOUS: "ambiguous",
  PAGE_UNREADABLE: "awaiting_page",
};

const PARK_BLOCKER: Readonly<Partial<Record<ReviewLocateStage, BlockerCode>>> = {
  not_on_page: "TARGET_NOT_FOUND",
  ambiguous: "TARGET_AMBIGUOUS",
  // "What is on your screen is not a 상품평 목록 I can read." Not UI_DRIFT, which claims Coupang changed the
  // page, when by far the likeliest truth is that the seller is on a different WING screen.
  awaiting_page: "UNSUPPORTED_STATE",
};

export class ReviewLocateEngine {
  private readonly runId: string;
  private readonly channelCode: string;
  private readonly clock: ReviewLocateClock;

  private started = false;
  private stage: ReviewLocateStage = "opening";
  private revision = 0;
  private seq = 0;
  private activeStepIndex = 1;
  private completedSteps = 0;
  private guidanceEnabled = true;
  /**
   * The opaque binding this run was started with. Held so a resolve can be RETRIED after a transport blip
   * without the frontend re-pressing — and held as the only review-shaped thing in this class, which it is
   * not: it is a random token that means nothing without the backend.
   */
  private locateRef: string | null = null;
  private blockerCode: BlockerCode | null = null;
  private blockerRecoverable = false;
  private readonly log: EventEnvelope[] = [];

  constructor(config: ReviewLocateRunConfig, opts?: { clock?: ReviewLocateClock }) {
    this.runId = config.runId;
    this.channelCode = config.channelCode;
    this.clock = opts?.clock ?? makeReviewLocateClock();
  }

  /* ── inbound command ─────────────────────────────────────────────────────── */

  command(command: { type: string; expectedRevision: number; payload?: unknown }): ReviewLocateCommandOutcome {
    if (!this.started) {
      if (command.type !== "START_RUN") return { ok: false, reason: "INVALID_FOR_STATE" };
      const ref = readLocateRef(command.payload);
      // **No binding, no run.** A START_RUN without a clean opaque ref is refused before anything opens: a
      // locate that started without one would have to either look for nothing or ask the page what is on it,
      // and the second is a read of a seller's screen nobody bound to a purpose.
      if (ref === null) return { ok: false, reason: "INVALID_PAYLOAD" };
      this.locateRef = ref;
      return { ok: true, idempotent: false, effect: this.start() };
    }
    if (command.type === "START_RUN") {
      // **A second press is a second look, at whatever review they pressed on.**
      //
      // The agent hosts one run identity for its lifetime, and the seller presses `[쿠팡에서 보기]` as often
      // as they like — on the review that is already rung, or on another one. Every press mints its OWN
      // binding, so a DIFFERENT ref is unambiguously a new request and re-arms the run; an identical ref can
      // only be the same command delivered twice, and stays idempotent.
      const ref = readLocateRef(command.payload);
      if (ref === null) return { ok: false, reason: "INVALID_PAYLOAD" };
      if (ref === this.locateRef) return { ok: true, idempotent: true, effect: "NONE" };
      return { ok: true, idempotent: false, effect: this.rearm(ref) };
    }
    if (command.expectedRevision < this.revision) return { ok: false, reason: "STALE_REVISION" };
    if (!reviewLocateAllowedCommands(this.stage).includes(command.type as never)) {
      return { ok: false, reason: "INVALID_FOR_STATE" };
    }
    switch (command.type) {
      case "FIND_CURRENT_STEP":
        // Handled by the session as "put the marketplace window back in front of me". No state change.
        return { ok: true, idempotent: true, effect: "NONE" };
      case "CANCEL_RUN":
        return { ok: true, idempotent: false, effect: this.abort() };
      case "REQUEST_STEP_RECHECK":
        return { ok: true, idempotent: false, effect: this.recheck() };
      default:
        return { ok: false, reason: "INVALID_FOR_STATE" };
    }
  }

  private start(): ReviewLocateEffect {
    this.started = true;
    this.stage = "opening";
    this.activeStepIndex = 1;
    this.emit("RUN_STARTED", { status: "PREPARING" });
    return "RESOLVE";
  }

  /**
   * Point the run at a different review, from wherever it was.
   *
   * <p>It re-arms from ANY stage, terminal or parked, because the seller pressing the button on another
   * review has said what they want and there is nothing in flight worth defending — a locate holds no
   * artifact, no draft, and no marketplace state. The step counters go back to the start, so the frontend
   * shows a fresh look rather than a completed one with a new blocker hung off it.
   */
  private rearm(ref: string): ReviewLocateEffect {
    this.locateRef = ref;
    this.completedSteps = 0;
    this.clearBlocker();
    return this.start();
  }

  /**
   * "I moved to another page — look again." The one repair every park has, and the same one each time: read
   * whatever is on the screen NOW.
   */
  private recheck(): ReviewLocateEffect {
    if (!isReviewLocatePark(this.stage)) return "NONE";
    this.clearBlocker();
    this.stage = "searching";
    this.activeStepIndex = 1;
    this.emit("RUN_STATUS_CHANGED", { status: "RUNNING" });
    return "LOCATE";
  }

  private abort(): ReviewLocateEffect {
    this.clearBlocker();
    this.stage = "operator_aborted";
    this.emit("RUN_STATUS_CHANGED", { status: "CANCELLED" });
    return "CLEAR_HIGHLIGHT";
  }

  /* ── driver reports ──────────────────────────────────────────────────────── */

  /**
   * The session resolved (or failed to resolve) the binding into something to look for.
   *
   * <p>A failure is TERMINAL, and deliberately so. The binding is single-use and short-lived, so there is
   * nothing a recheck could do differently; the honest thing is to end the run and let the seller press the
   * button again, which mints a fresh one.
   */
  onTargetResolved(ok: boolean): ReviewLocateEffect {
    if (isReviewLocateTerminal(this.stage)) return "NONE";
    if (!ok) {
      this.stage = "binding_unresolved";
      this.blockerCode = "LOCATE_TARGET_UNRESOLVED";
      this.blockerRecoverable = false;
      this.emit("RUN_FAILED", { code: "LOCATE_TARGET_UNRESOLVED", recoverable: false });
      return "CLEANUP";
    }
    this.stage = "searching";
    this.emit("RUN_STATUS_CHANGED", { status: "RUNNING" });
    return "LOCATE";
  }

  /**
   * What the driver found on the page the seller had up.
   *
   * <p>`LOCATED` is only accepted as a completion when the ring actually landed. A match whose row had gone
   * by the time the annotation ran is reported as `NOT_ON_PAGE` — the page moved, and a run that claimed
   * "highlighted" over a screen with no ring on it would send the seller looking for a mark that is not there.
   */
  onLocateAttempt(attempt: ReviewLocateAttempt): ReviewLocateEffect {
    if (isReviewLocateTerminal(this.stage)) return "NONE";
    if (attempt.verdict === "INVALID_TARGET") return this.onTargetResolved(false);
    if (attempt.verdict === "LOCATED" && attempt.highlighted) {
      this.completedSteps = REVIEW_LOCATE_TOTAL_STEPS;
      this.activeStepIndex = 2;
      this.clearBlocker();
      this.stage = "highlighted";
      this.emit("TARGET_HIGHLIGHTED", { stepId: this.stepId(), targetRef: this.targetRef() });
      this.emit("STEP_COMPLETED", { stepId: this.stepId(), stepStatus: "COMPLETED" });
      this.emit("RUN_COMPLETED", { status: "COMPLETED" });
      return "NONE";
    }
    // A `LOCATED` that did not land the ring means the page moved between the read and the annotation. It is
    // reported as NOT_ON_PAGE rather than as a completion: a run claiming "highlighted" over a screen with no
    // ring on it would send the seller looking for a mark that is not there.
    const verdict = attempt.verdict === "LOCATED" ? "NOT_ON_PAGE" : attempt.verdict;
    return this.park(VERDICT_PARK[verdict]);
  }

  /**
   * A drive threw — most often a navigation race, the seller's own page moving under an in-page read. Park
   * recoverably rather than failing: nothing is wrong except the timing, and a recheck re-reads.
   */
  onDriveFault(): ReviewLocateEffect {
    if (isReviewLocateTerminal(this.stage)) return "NONE";
    return this.park("awaiting_page");
  }

  /** The seller closed the window the run was reading. Park; only they may open one again. */
  onSurfaceClosed(): ReviewLocateEffect {
    if (isReviewLocateTerminal(this.stage)) return "NONE";
    return this.park("awaiting_page", "SURFACE_CLOSED");
  }

  /**
   * Rest on the seller.
   *
   * <p><b>Re-parking the same way is not an event.</b> The session re-reads the page while the run is parked,
   * and every one of those reads that finds the same thing lands here. Emitting for each would advance the
   * revision once a tick without publishing a view — so the seller's next command, addressed to the revision
   * they can see, would be refused as stale. The run would silently stop answering its own buttons.
   */
  private park(stage: ReviewLocateStage, code?: BlockerCode): ReviewLocateEffect {
    const blockerCode = code ?? PARK_BLOCKER[stage] ?? null;
    if (this.stage === stage && this.blockerCode === blockerCode) return "NONE";
    this.stage = stage;
    this.activeStepIndex = 1;
    this.completedSteps = 0;
    this.blockerCode = blockerCode;
    this.blockerRecoverable = blockerCode !== null;
    this.emit("RUN_STATUS_CHANGED", { status: "WAITING_FOR_HUMAN" });
    if (blockerCode) this.emit("RUN_BLOCKED", { code: blockerCode, recoverable: true });
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

  currentStage(): ReviewLocateStage {
    return this.stage;
  }

  /** The binding this run holds, for the session's resolve. Null before `START_RUN`. */
  boundLocateRef(): string | null {
    return this.locateRef;
  }

  events(): readonly EventEnvelope[] {
    return this.log;
  }

  view(): ActionWindowRunView {
    const meta = reviewLocateStepMetaAt(this.activeStepIndex);
    const status: RunStatus = reviewLocateStageToRunStatus(this.stage);
    const view: ActionWindowRunView = {
      protocolVersion: 2,
      runId: this.runId,
      revision: this.revision,
      channelCode: this.channelCode,
      runCopyKey: REVIEW_LOCATE_RUN_COPY_KEY,
      status,
      // Always ACTION_WINDOW: the seller's own window is where this happens. It is also what satisfies the
      // contract's WAITING_FOR_HUMAN invariant at every park.
      executionMode: "ACTION_WINDOW",
      intent: "REVIEW_LOCATE",
      currentStep: {
        stepId: meta.stepId,
        stepNumber: meta.stepNumber,
        totalSteps: REVIEW_LOCATE_TOTAL_STEPS,
        copyKey: meta.copyKey,
        ...(meta.copyParams ? { copyParams: meta.copyParams } : {}),
        status: reviewLocateStageToStepStatus(this.stage),
      },
      guidanceEnabled: this.guidanceEnabled,
      allowedCommands: [...reviewLocateAllowedCommands(this.stage)],
      progress: { completedSteps: this.completedSteps, totalSteps: REVIEW_LOCATE_TOTAL_STEPS },
      updatedAt: this.clock(),
    };
    // Exposed while parked for it, and on the one terminal that HAS a cause the seller must be told
    // (`binding_unresolved`). Never on `highlighted` — the contract forbids a blocker on a COMPLETED run,
    // and there is nothing to report about a run that did what it said.
    if (this.blockerCode && (isReviewLocatePark(this.stage) || this.stage === "binding_unresolved")) {
      view.blocker = { code: this.blockerCode, recoverable: this.blockerRecoverable };
    }
    return view;
  }

  private stepId(): string {
    return reviewLocateStepMetaAt(this.activeStepIndex).stepId;
  }

  /**
   * The opaque `targetRef` a `TARGET_HIGHLIGHTED` event carries.
   *
   * <p>It is the run's OWN binding, not a signature of the row that was rung. A signature derived from the
   * matched row would be a value computed from a buyer's review, put on the wire, at the one moment the run
   * has that review in hand — and nothing downstream needs it to be anything but "the thing this run was
   * about", which the binding already is.
   */
  private targetRef(): string {
    const ref = this.locateRef;
    return ref !== null && HEX16.test(ref) ? ref : "0".repeat(16);
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

/** The `locateRef` on a `START_RUN` payload — a clean opaque token, or null. */
function readLocateRef(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const ref = (payload as { locateRef?: unknown }).locateRef;
  return typeof ref === "string" && HEX16.test(ref) ? ref : null;
}
