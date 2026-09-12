/**
 * **`REVIEW_ACQUISITION` session supervisor (ISOLATED, v2).** Connects the frontend (over a v2 transport) to
 * the pure {@link ReviewAcquisitionEngine}, a {@link ReviewAcquisitionProbeDriver}, and the live-proven
 * {@link ReviewAcquisitionSession} walk rule.
 *
 * ## What this module owns that the engine deliberately does not
 *
 * **1. The reviews.** Every page the driver reads goes into a `ReviewAcquisitionSession` (the same object the
 * seated CLI uses — the coverage rule is not re-implemented here) and from there, once, to the handoff client.
 * The engine sees integers. `record` logs counts and enums, never a row.
 *
 * **2. The account.** The opaque `acquisitionRef` is spent over the agent's OWN backend session and yields the
 * account slot the handoff is keyed on. It is held in a private field and handed to the handoff — never to a
 * log, an event, or a view.
 *
 * **3. The one thing that may end the walk without the seller: the pager.** A page whose pager says "last"
 * ends it; the seller's 「여기까지만」 ends it; a pager that cannot be read ends it (as the CLI does — coverage
 * unclaimed). A page that is NOT a 상품평 list does not end anything: it parks, and the seller brings the list
 * up and presses again.
 *
 * Nothing here turns a page. There is no effect, command, or timer that could.
 */
import { validateCommandEnvelope } from "../../../../contracts/action-window/v2/index";
import type { AwClientFrame, AwServerTransport } from "../../../../contracts/action-window/v2/transport";
import { log } from "../../log";
import type { ReviewAcquisitionEffect, ReviewAcquisitionEngine } from "./review-acquisition-engine";
import type { ReviewAcquisitionProbeDriver } from "./review-acquisition-driver";
import { ReviewAcquisitionSession, type AcquisitionResult } from "./review-acquisition";
import type { ReviewAcquisitionTarget } from "./review-acquisition-target-client";
import type { ReviewHandoffRequest, ReviewHandoffResponse } from "./review-handoff-client";
import { isReviewAcquisitionTerminal } from "./review-acquisition-stages";

export type ReviewAcquisitionTargetResolver = (acquisitionRef: string) => Promise<ReviewAcquisitionTarget | null>;
/** The ONE bounded POST. Injected so the session is testable with no network; throws or refuses ⇒ rejected. */
export type ReviewAcquisitionHandoff = (request: ReviewHandoffRequest) => Promise<ReviewHandoffResponse>;

/**
 * Record that this run ended without storing anything, so the press leaves a row after the window closes.
 *
 * Injected like the handoff and for the same reason. Returns whether the row was written; the session does not
 * act on the answer — a run that already failed does not get a second failure because our bookkeeping did.
 */
export type ReviewAcquisitionFailureReport = (report: {
  accountSlot: string;
  channelCode: string;
  failureCode: string;
}) => Promise<boolean>;

export interface ReviewAcquisitionRunSessionDeps {
  resolveTarget: ReviewAcquisitionTargetResolver;
  handoff: ReviewAcquisitionHandoff;
  /**
   * Where a run that stored nothing gets written down. Optional: a session constructed without it behaves
   * exactly as it did before this existed, which is what keeps the seated CLI and the fixtures untouched.
   */
  reportFailure?: ReviewAcquisitionFailureReport;
  /** Channel the handoff is posted under; the resolved binding must agree or the run ends unresolved. */
  channelCode?: string;
  onStatePublished?: () => void;
  /** Bounds handed to the walk rule (defaults are the proven CLI's). */
  maxPages?: number;
  maxReviews?: number;
}

export class ReviewAcquisitionRunSession {
  private readonly engine: ReviewAcquisitionEngine;
  private readonly driver: ReviewAcquisitionProbeDriver;
  private readonly transport: AwServerTransport;
  private readonly deps: ReviewAcquisitionRunSessionDeps;
  private readonly runId: string;
  private readonly channelCode: string;

  private target: ReviewAcquisitionTarget | null = null;
  private walk: ReviewAcquisitionSession | null = null;
  private lastResult: AcquisitionResult | null = null;

  private started = false;
  private publishedSeq = 0;
  private busyCount = 0;
  private surfaceCloseToken = 0;
  private unsubscribe: (() => void) | null = null;
  /**
   * At most one failure row per run — the unit the seller pressed is the run, so the history entry is about
   * the run: one press, one line.
   */
  private failureSettled = false;
  /**
   * Whether anything was ever handed over. It is what makes the failure row a statement about the RUN rather
   * than about a moment inside it: a read the seller repaired and re-pressed is not a failed sync, and
   * recording it the instant a page refused would have said it was.
   */
  private handedOver = false;

  constructor(
    engine: ReviewAcquisitionEngine,
    driver: ReviewAcquisitionProbeDriver,
    transport: AwServerTransport,
    deps: ReviewAcquisitionRunSessionDeps,
  ) {
    this.engine = engine;
    this.driver = driver;
    this.transport = transport;
    this.deps = deps;
    this.runId = engine.view().runId;
    this.channelCode = deps.channelCode ?? "COUPANG";
    this.started = engine.isStarted();
  }

  attach(): () => void {
    if (this.unsubscribe) return this.unsubscribe;
    const stop = this.transport.subscribe((frame) => this.handle(frame));
    this.unsubscribe = () => {
      this.surfaceCloseToken += 1;
      stop();
    };
    return this.unsubscribe;
  }

  async whenSettled(): Promise<void> {
    for (let i = 0; i < 100_000; i++) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (this.busyCount === 0) return;
    }
    throw new Error("review acquisition session: whenSettled did not converge");
  }

  /** TEST-facing: the last walk result's counts (never the reviews). */
  lastWalkCounts(): { pages: number; collected: number; complete: boolean; stopReason: string } | null {
    const r = this.lastResult;
    return r ? { pages: r.pagesAccepted, collected: r.reviews.length, complete: r.complete, stopReason: r.stopReason } : null;
  }

  private handle(frame: AwClientFrame): void {
    if (frame.kind === "aw_guidance_pack") {
      log("aw_coupang_review_acquisition_guidance_pack_ignored", { accepted: true });
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
      this.transport.send({ kind: "aw_command_result", commandId: safeCommandId(command), accepted: false, reason: "INVALID_ENVELOPE" });
      return;
    }
    const outcome = this.engine.command(command);
    this.transport.send({
      kind: "aw_command_result",
      commandId: command.commandId,
      accepted: outcome.ok,
      ...(outcome.ok ? {} : { reason: outcome.reason }),
    });
    this.publishState();
    if (command.type === "START_RUN" && outcome.ok) this.started = true;
    if (command.type === "FIND_CURRENT_STEP" && outcome.ok) {
      void this.driver
        .focusSurface?.()
        .then((raised) => log("aw_coupang_review_acquisition_surface_focus", { raised }))
        .catch(() => log("aw_coupang_review_acquisition_surface_focus", { raised: false }, "warn"));
    }
    if (outcome.ok && "effect" in outcome && outcome.effect !== "NONE") {
      this.busyCount += 1;
      void this.drive(outcome.effect)
        .catch((e) => this.onDriveError(e))
        .finally(() => {
          this.busyCount -= 1;
        });
    }
  }

  private async onDriveError(e: unknown): Promise<void> {
    log("aw_coupang_review_acquisition_drive_error", { reason: errName(e) }, "warn");
    this.engine.onDriveFault();
    this.publishState();
  }

  private async drive(effect: ReviewAcquisitionEffect): Promise<void> {
    switch (effect) {
      case "RESOLVE": {
        const ref = this.engine.boundAcquisitionRef();
        this.target = null;
        this.walk = null;
        this.lastResult = null;
        const resolved = ref === null ? null : await this.deps.resolveTarget(ref).catch(() => null);
        // A binding for another channel is a wiring bug, not a target: the handoff would file a Coupang page
        // under a channel that never had one. Refused as unresolved, which is what it is from here.
        const usable = resolved !== null && resolved.channelCode === this.channelCode;
        if (usable) {
          this.target = resolved;
          this.walk = new ReviewAcquisitionSession({
            ...(this.deps.maxPages !== undefined ? { maxPages: this.deps.maxPages } : {}),
            ...(this.deps.maxReviews !== undefined ? { maxReviews: this.deps.maxReviews } : {}),
          });
        }
        log("aw_coupang_review_acquisition_binding", { resolved: resolved !== null, usable });
        const next = this.engine.onTargetResolved(usable);
        this.publishState();
        if (usable) this.watchSurfaceClose();
        return this.drive(next);
      }
      case "READ": {
        const walk = this.walk;
        if (!walk) {
          const next = this.engine.onTargetResolved(false);
          this.publishState();
          return this.drive(next);
        }
        const reading = await this.driver.readCurrentPage();
        if (isReviewAcquisitionTerminal(this.engine.currentStage())) return;
        if (reading.reason !== "OK") {
          log("aw_coupang_review_acquisition_page", { readReason: reading.reason, accepted: false });
          // A driver that can explain the refusal does; one that cannot leaves the engine's own default.
          const blocker = this.driver.lastBlocker?.() ?? null;
          const next = this.engine.onPageRead({
            readable: false,
            accepted: false,
            open: walk.open,
            collected: walk.result().reviews.length,
            coverageComplete: false,
            ...(blocker === null ? {} : { blocker }),
          });
          this.publishState();
          return this.drive(next);
        }
        const outcome = walk.offerPage(reading);
        const result = walk.result();
        this.lastResult = result;
        log("aw_coupang_review_acquisition_page", {
          readReason: reading.reason,
          accepted: outcome.accepted,
          rows: outcome.rowsRead,
          fresh: outcome.newReviews,
          known: outcome.alreadyKnown,
          stop: outcome.stopReason,
          pages: result.pagesAccepted,
          collected: result.reviews.length,
        });
        const next = this.engine.onPageRead({
          readable: true,
          accepted: outcome.accepted,
          open: walk.open,
          collected: result.reviews.length,
          coverageComplete: result.complete,
        });
        this.publishState();
        return this.drive(next);
      }
      case "HANDOFF": {
        const walk = this.walk;
        const target = this.target;
        if (!walk || !target) {
          const next = this.engine.onHandoff({ ok: false, stored: 0 });
          this.publishState();
          return this.drive(next);
        }
        // The seller may have pressed 「여기까지만」: close the walk so `complete` reads as what it is.
        walk.finish();
        const result = walk.result();
        this.lastResult = result;
        let response: ReviewHandoffResponse | null = null;
        try {
          response = await this.deps.handoff({
            accountSlot: target.accountSlot,
            channelCode: this.channelCode,
            complete: result.complete,
            stopReason: result.stopReason,
            reviews: result.reviews,
          });
        } catch {
          // Never the caught error: a transport failure can quote the request, and the request is a page of
          // what customers wrote.
          response = null;
        }
        const ok = response !== null && response.ok;
        log("aw_coupang_review_acquisition_handoff", {
          ok,
          received: result.reviews.length,
          stored: ok ? response!.stored : 0,
          complete: result.complete,
          stopReason: result.stopReason,
        });
        if (ok) this.handedOver = true;
        const next = this.engine.onHandoff({ ok, stored: ok ? response!.stored : 0 });
        this.publishState();
        return this.drive(next);
      }
      case "CLEANUP": {
        // Before the target is dropped: this is the one ending the engine reaches by itself (an unresolved
        // binding, a refused handoff, a cancel, a finished walk), and after this line there is no account to
        // attribute anything to. The other ending — the seller closes the window on a parked run — arrives as
        // the carrier's dispose, which calls the same method and finds it already settled.
        await this.settleRun();
        this.walk = null;
        this.target = null;
        await this.driver.cleanup();
        return;
      }
      case "NONE":
      default:
        return;
    }
  }

  /**
   * **The press ended. Write it down if it stored nothing.**
   *
   * Called once when the run is released — which is where the seller's question ("I pressed 지금 동기화 and
   * nothing happened") actually gets its answer. Doing it the moment a page refused would have been earlier
   * and wrong: a seller who is told the list is not up, brings it up, and presses again has not had a failed
   * sync, and a row saying otherwise would sit in their history forever beside the successful one.
   *
   * Four conditions, and each rules out a different thing that is not a failure:
   *
   * - **nothing was handed over** — a run that stored is not a failed run, whatever went wrong on the way;
   * - **a blocker stands** — the engine drops it on `completed` and on a seller's own cancel, so an empty
   *   list and a deliberate 취소 write nothing. A cancel is a decision, not a fault;
   * - **a binding was resolved** — otherwise the account slot IS what failed, and there is no seller account
   *   whose history the row could belong to. Filing it against a guess is worse than the gap;
   * - **once**.
   *
   * The word is the engine's, not the driver's: a driver that cannot explain itself leaves the default, and
   * what the seller was shown is what the run should be remembered by. Never throws — the run has already
   * failed and a bookkeeping error must not become a second one.
   */
  async settleRun(): Promise<void> {
    if (this.failureSettled) return;
    this.failureSettled = true;
    if (this.handedOver) return;
    const code = this.engine.view().blocker?.code;
    const report = this.deps.reportFailure;
    const target = this.target;
    if (!code || !report || !target) return;
    await report({ accountSlot: target.accountSlot, channelCode: this.channelCode, failureCode: code })
      .catch(() => false);
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
    if (isReviewAcquisitionTerminal(this.engine.currentStage())) return;
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
    this.deps.onStatePublished?.();
  }
}

function safeCommandId(command: unknown): string {
  const id = (command as { commandId?: unknown })?.commandId;
  return typeof id === "string" ? id : "unknown";
}

function errName(e: unknown): string {
  if (e instanceof Error) return e.name || "Error";
  return typeof e;
}
