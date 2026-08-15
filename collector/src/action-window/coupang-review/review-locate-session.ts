/**
 * **`REVIEW_LOCATE` session supervisor (ISOLATED, v2).** Connects the frontend (over a v2 transport) to the
 * pure {@link ReviewLocateEngine} and a {@link ReviewLocateProbeDriver}.
 *
 * A locate agent hosts exactly ONE run for its lifetime, like the issuance carriers next door: one press of
 * `[쿠팡에서 보기]`, one run, and the seller pressing it again is a new one.
 *
 * ## The two things this module owns that the engine deliberately does not
 *
 * **1. The target.** The engine is pure and never holds what identifies the review; this session resolves the
 * opaque `locateRef` into a target over the agent's OWN authenticated backend session and keeps it in a
 * private field for the run's lifetime. It is handed to the driver and to nothing else — no log line, no
 * event, no view. That is why `record` below logs the verdict and the counts and never the target.
 *
 * **2. Looking again while the seller turns pages.** A locate parks the moment a page does not hold the
 * review, and the seller's repair is to turn a page in their own window — which is nowhere near the SellerOps
 * tab. Waiting for them to alt-tab back and press 다시 확인 after every page is the exact complaint the
 * issuance walk's `FIND_CURRENT_STEP` note records. So a parked run re-reads the visible page on a bounded
 * poll, and the ring appears when they land on the right page. The button stays: this removes the NEED to
 * press it, never the ability.
 *
 * **What the poll is, precisely, so it is not mistaken for something else.** Each tick READS the page in
 * front of the seller and compares it — the same read the acquisition walk performs at a checkpoint, with the
 * same result: nothing is stored, nothing is uploaded, and the log line is enums and integers. It clicks
 * nothing, turns nothing, and stops the instant the run leaves the park, is cancelled, or the window closes.
 */
import { validateCommandEnvelope } from "../../../../contracts/action-window/v2/index";
import type { AwClientFrame, AwServerTransport } from "../../../../contracts/action-window/v2/transport";
import { log } from "../../log";
import type { ReviewLocateEffect, ReviewLocateEngine } from "./review-locate-engine";
import type { ReviewLocateProbeDriver } from "./review-locate-driver";
import type { ReviewLocateTarget } from "./review-locate";
import { isReviewLocatePark, isReviewLocateTerminal } from "./review-locate-stages";

/** Resolve an opaque binding into what the matcher compares. Returns null on ANY refusal — see the engine. */
export type ReviewLocateTargetResolver = (locateRef: string) => Promise<ReviewLocateTarget | null>;

export interface ReviewLocateSessionOptions {
  /** Fires after every published transition — the persistence hook. */
  onStatePublished?: () => void;
  /** How often a parked run re-reads the visible page while the seller navigates. Tests set 0. */
  retryPollMs?: number;
  /** How long it keeps looking. The seated-operator window — never unbounded. */
  retryTimeoutMs?: number;
}

export class ReviewLocateSession {
  private readonly engine: ReviewLocateEngine;
  private readonly driver: ReviewLocateProbeDriver;
  private readonly transport: AwServerTransport;
  private readonly resolveTarget: ReviewLocateTargetResolver;
  private readonly runId: string;
  private readonly onStatePublished: (() => void) | undefined;
  private readonly retryPollMs: number;
  private readonly retryTimeoutMs: number;

  /** The resolved target. Private, never published, never logged. Null until the binding is spent. */
  private target: ReviewLocateTarget | null = null;
  /**
   * WHICH binding that target belongs to.
   *
   * <p>Holding the target without holding whose it is was the hole under three separate races: a read that
   * came back after the seller pressed on another review looked "current" because the target object had not
   * been swapped yet. Every async step now compares this, not the object.
   */
  private targetRef: string | null = null;

  private started = false;
  private publishedSeq = 0;
  /** Refcount of automatic drives in flight (test-facing determinism hook). */
  private busyCount = 0;
  /** At most ONE retry loop at a time — several would each read the page and each advance the run. */
  private retrying = false;
  /**
   * The seller closed the window. Latched so no TIMER can re-read it, and cleared by their next command —
   * the one re-open that was ever theirs to ask for.
   */
  private surfaceClosed = false;
  private surfaceCloseToken = 0;
  private unsubscribe: (() => void) | null = null;

  constructor(
    engine: ReviewLocateEngine,
    driver: ReviewLocateProbeDriver,
    transport: AwServerTransport,
    resolveTarget: ReviewLocateTargetResolver,
    opts?: ReviewLocateSessionOptions,
  ) {
    this.engine = engine;
    this.driver = driver;
    this.transport = transport;
    this.resolveTarget = resolveTarget;
    this.runId = engine.view().runId;
    this.started = engine.isStarted();
    this.onStatePublished = opts?.onStatePublished;
    this.retryPollMs = opts?.retryPollMs ?? 2_000;
    this.retryTimeoutMs = opts?.retryTimeoutMs ?? 10 * 60_000;
  }

  attach(): () => void {
    if (this.unsubscribe) return this.unsubscribe;
    const stopTransport = this.transport.subscribe((frame) => this.handle(frame));
    this.unsubscribe = () => {
      this.surfaceCloseToken += 1;
      stopTransport();
    };
    return this.unsubscribe;
  }

  /** Resolves once no automatic drive is in flight (test-facing determinism hook). */
  async whenSettled(): Promise<void> {
    for (let i = 0; i < 100_000; i++) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (this.busyCount === 0) return;
    }
    throw new Error("review locate session: whenSettled did not converge");
  }

  private handle(frame: AwClientFrame): void {
    if (frame.kind === "aw_guidance_pack") {
      // A locate run has no in-page guidance panel — the ring IS the guidance. Accepted and ignored.
      log("aw_coupang_review_locate_guidance_pack_ignored", { accepted: true });
      return;
    }
    if (frame.kind === "aw_resync") {
      if (frame.runId !== this.runId || !this.started) {
        this.transport.send({ kind: "aw_resync_result", view: null, events: [] });
        return;
      }
      const events = this.engine.events().filter((e) => e.sequence > frame.sinceSequence);
      this.transport.send({ kind: "aw_resync_result", view: this.engine.view(), events });
      return;
    }
    const command = frame.command;
    const valid = validateCommandEnvelope(command);
    if (!valid.ok) {
      this.transport.send({
        kind: "aw_command_result",
        commandId: safeCommandId(command),
        accepted: false,
        reason: "INVALID_ENVELOPE",
      });
      return;
    }
    const outcome = this.engine.command(command);
    // An accepted command is the SELLER asking for something — the one thing that may look at a window they
    // closed. Cleared before the drive, so the chain this command starts is allowed to read again.
    if (outcome.ok) this.surfaceClosed = false;
    this.transport.send({
      kind: "aw_command_result",
      commandId: command.commandId,
      accepted: outcome.ok,
      ...(outcome.ok ? {} : { reason: outcome.reason }),
    });
    this.publishState();
    if (command.type === "START_RUN" && outcome.ok) this.started = true;
    // "현재 단계 다시 찾기" = put the marketplace window back in front of the seller. It raises the surface
    // that already exists; it navigates nothing, opens nothing, and presses nothing.
    if (command.type === "FIND_CURRENT_STEP" && outcome.ok) {
      void this.driver
        .focusSurface?.()
        .then((raised) => log("aw_coupang_review_locate_surface_focus", { raised }))
        .catch(() => log("aw_coupang_review_locate_surface_focus", { raised: false }, "warn"));
    }
    if (outcome.ok && "effect" in outcome && outcome.effect !== "NONE") {
      this.busyCount += 1;
      void this.drive(outcome.effect)
        .catch((e) => this.onDriveError(e))
        .finally(() => {
          this.busyCount -= 1;
        });
    } else if (outcome.ok) {
      this.maybeRetry();
    }
  }

  /**
   * Is `ref` still the binding this run is aimed at?
   *
   * <p>The one question every `await` on this path has to ask when it returns. A press re-arms the run from
   * any stage, so anything in flight belongs to a review the seller may already have moved on from — and
   * applying it would ring one buyer's review while the screen names another's.
   */
  private stillBound(ref: string | null): boolean {
    return ref !== null && this.engine.boundLocateRef() === ref;
  }

  /**
   * A read that came back for a run the seller has moved on from may have DRAWN a ring before we noticed.
   * Take it off: a mark left on the marketplace screen that no run is talking about is the worst of both —
   * the panel describes one review and the page points at another.
   */
  private async retractStrayRing(drawn: boolean): Promise<void> {
    if (!drawn) return;
    await this.driver.clearHighlight().catch(() => 0);
  }

  private async onDriveError(e: unknown): Promise<void> {
    // Most often a NAVIGATION RACE — an in-page read fired while the seller's own page was still moving,
    // destroying the execution context. Do NOT fail closed and leave the run idle: park recoverably so a
    // recheck (or the retry loop) re-reads.
    log("aw_coupang_review_locate_drive_error", { reason: errName(e) }, "warn");
    this.engine.onDriveFault();
    this.publishState();
    this.maybeRetry();
  }

  private async drive(effect: ReviewLocateEffect): Promise<void> {
    switch (effect) {
      case "RESOLVE": {
        // The ONE call that turns an opaque token into something to look for. A refusal of any kind — spent,
        // expired, another tenant's, or a backend that could not be reached — is one `null`, because the run
        // has one honest response to all of them and telling them apart is not its business.
        const ref = this.engine.boundLocateRef();
        // **Take the previous ring off before looking for a different review.** A press re-arms the run from
        // any stage, including a completed one, and nothing else on this path clears. Without this, pressing
        // on B while A is rung leaves BOTH rung when B is on the page — and when B is not, the run says "이
        // 페이지에는 없습니다" while the only ring on screen is around a different buyer's review.
        this.target = null;
        this.targetRef = null;
        await this.driver.clearHighlight().catch(() => 0);
        const resolved = ref === null ? null : await this.resolveTarget(ref).catch(() => null);
        // **The binding this resolve was for must still be the run's.** Two presses mean two resolves racing
        // to install a target, and whichever landed last would win.
        if (!this.stillBound(ref)) return;
        this.target = resolved;
        this.targetRef = ref;
        // Enums and booleans: whether a target was obtained, never any part of it.
        log("aw_coupang_review_locate_binding", { resolved: resolved !== null });
        const next = this.engine.onTargetResolved(resolved !== null);
        this.publishState();
        return this.drive(next);
      }
      case "LOCATE": {
        const ref = this.engine.boundLocateRef();
        const target = this.targetRef !== null && this.targetRef === ref ? this.target : null;
        if (target === null) {
          const next = this.engine.onTargetResolved(false);
          this.publishState();
          return this.drive(next);
        }
        this.watchSurfaceClose();
        const outcome = await this.driver.locate(target);
        // A read of a real page takes hundreds of milliseconds, and a press during it re-aims the run. Its
        // answer is about the review the seller LEFT: applying it would complete the new run on the old
        // one's evidence — `TARGET_HIGHLIGHTED` for review B over a ring drawn around review A.
        if (!this.stillBound(ref)) return this.retractStrayRing(outcome.highlighted);
        // The seller CANCELLED while this read was in flight. The binding is unchanged, so `stillBound`
        // cannot see it — but the run is over, and a ring that lands after "찾기를 멈췄습니다" is a mark on
        // their screen that nothing is talking about. The read that drew it is what takes it off.
        if (isReviewLocateTerminal(this.engine.currentStage())) return this.retractStrayRing(outcome.highlighted);
        log("aw_coupang_review_locate_attempt", {
          verdict: outcome.verdict,
          matches: outcome.matches,
          rows: outcome.rowsConsidered,
          highlighted: outcome.highlighted,
        });
        const next = this.engine.onLocateAttempt({ verdict: outcome.verdict, highlighted: outcome.highlighted });
        this.publishState();
        if (next !== "NONE") return this.drive(next);
        this.maybeRetry();
        return;
      }
      case "CLEAR_HIGHLIGHT": {
        await this.driver.clearHighlight();
        return;
      }
      case "CLEANUP": {
        await this.driver.cleanup();
        return;
      }
      case "NONE":
      default:
        this.maybeRetry();
        return;
    }
  }

  /**
   * Start the look-again loop if the run has settled into a park, and only one loop at a time.
   *
   * <p>Called where a drive chain ENDS, because that is where a park becomes visible: the effect that
   * produced it has been applied and nothing else is going to move the run.
   */
  private maybeRetry(): void {
    if (this.retrying) return;
    // NEVER re-read a window the seller CLOSED. Their next command clears the latch; a timer never does.
    if (this.surfaceClosed) return;
    if (!isReviewLocatePark(this.engine.currentStage())) return;
    this.retrying = true;
    this.busyCount += 1;
    const armedFor = this.engine.boundLocateRef();
    void this.retryLoop()
      .catch(() => undefined)
      .finally(() => {
        this.retrying = false;
        this.busyCount -= 1;
        // **Re-arm when the binding changed under this loop.** `maybeRetry` is otherwise only reached from a
        // command or the end of a drive chain — so a press that re-aimed the run mid-tick found `retrying`
        // true, gave up, and then this loop exited on its stale-binding guard. Nothing restarted it: the new
        // run sat parked under copy promising it was still looking, and no read ever happened again.
        //
        // ONLY on a changed binding. Re-arming on exhaustion would restart the ten-minute watch forever, and
        // re-arming on any early exit would spin when there is nothing to look for yet.
        if (this.engine.boundLocateRef() !== armedFor) this.maybeRetry();
      });
  }

  /**
   * Re-read the visible page while the run is parked, until it is not parked any more.
   *
   * <p>Counted in POLLS, not accumulated milliseconds: a zero-delay cadence (which tests use) would advance
   * an elapsed-time accumulator by zero and loop forever. Bounded by the seated-operator window — a loop that
   * outlived the seller would keep reading a page nobody is looking at.
   */
  private async retryLoop(): Promise<void> {
    const maxPolls = Math.max(1, Math.ceil(this.retryTimeoutMs / Math.max(1, this.retryPollMs)));
    for (let i = 0; i < maxPolls; i++) {
      await new Promise<void>((resolve) => setTimeout(resolve, this.retryPollMs));
      if (this.surfaceClosed) return;
      if (isReviewLocateTerminal(this.engine.currentStage())) return;
      if (!isReviewLocatePark(this.engine.currentStage())) return;
      const ref = this.engine.boundLocateRef();
      const target = this.targetRef !== null && this.targetRef === ref ? this.target : null;
      if (target === null) return;
      let outcome;
      try {
        outcome = await this.driver.locate(target);
      } catch (e) {
        // A read that threw mid-navigation is exactly what this loop exists for. Park again and keep looking.
        log("aw_coupang_review_locate_drive_error", { reason: errName(e) }, "warn");
        this.engine.onDriveFault();
        this.publishState();
        continue;
      }
      // The seller pressed the button on ANOTHER review while this read was in flight. Its answer is about
      // the review they left, and applying it would park (or complete) the new run on the old one's evidence.
      // Compared on the BINDING, not on the target object: a re-arm whose own resolve has not landed yet has
      // not replaced the object, so object identity said "still current" at exactly the wrong moment.
      if (!this.stillBound(ref)) {
        await this.retractStrayRing(outcome.highlighted);
        return;
      }
      // REVISION, not stage. The engine's park is idempotent on stage AND blocker, so a same-stage park with
      // a DIFFERENT blocker (surface-closed → not-a-list) emits events and advances the revision. Gating the
      // publish on the stage alone left those unpublished — and the seller's next command, addressed to the
      // revision they could see, was then refused as STALE_REVISION with no way to find out why.
      const before = this.engine.view().revision;
      const next = this.engine.onLocateAttempt({ verdict: outcome.verdict, highlighted: outcome.highlighted });
      if (this.engine.view().revision !== before) {
        log("aw_coupang_review_locate_attempt", {
          verdict: outcome.verdict,
          matches: outcome.matches,
          rows: outcome.rowsConsidered,
          highlighted: outcome.highlighted,
          retry: true,
        });
        this.publishState();
      }
      if (next !== "NONE") await this.drive(next);
      if (!isReviewLocatePark(this.engine.currentStage())) return;
    }
    log("aw_coupang_review_locate_retry_expired", { polls: maxPolls });
  }

  private watchSurfaceClose(): void {
    const whenClosed = this.driver.whenSurfaceClosed?.bind(this.driver);
    if (!whenClosed) return;
    this.surfaceCloseToken += 1;
    const token = this.surfaceCloseToken;
    void whenClosed().then(() => this.onSurfaceClosed(token));
  }

  private onSurfaceClosed(token: number): void {
    if (token !== this.surfaceCloseToken) return;
    if (isReviewLocateTerminal(this.engine.currentStage())) return;
    // Latched BEFORE the park is published, so the loop that would otherwise start on it does not.
    this.surfaceClosed = true;
    this.engine.onSurfaceClosed();
    this.publishState();
  }

  private publishState(): void {
    for (const e of this.engine.events()) {
      if (e.sequence > this.publishedSeq) {
        this.transport.send({ kind: "aw_event", event: e });
        this.publishedSeq = e.sequence;
      }
    }
    this.transport.send({ kind: "aw_view", view: this.engine.view() });
    this.onStatePublished?.();
  }
}

function safeCommandId(command: unknown): string {
  const id = (command as { commandId?: unknown })?.commandId;
  return typeof id === "string" ? id : "unknown";
}

/** A sanitized label for a caught error — its constructor name only, never its message. */
function errName(e: unknown): string {
  if (e instanceof Error) return e.name || "Error";
  return typeof e;
}
