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

export interface ReviewAcquisitionRunSessionDeps {
  resolveTarget: ReviewAcquisitionTargetResolver;
  handoff: ReviewAcquisitionHandoff;
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
        const next = this.engine.onHandoff({ ok, stored: ok ? response!.stored : 0 });
        this.publishState();
        return this.drive(next);
      }
      case "CLEANUP": {
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
