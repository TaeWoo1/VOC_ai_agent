/**
 * **Coupang WING API-issuance guidance session supervisor (ISOLATED, v2).** Connects the FE (over a v2
 * transport) to the pure {@link CoupangIssuanceEngine} and a {@link CoupangIssuanceProbeDriver}. The Coupang-side
 * sibling of the NAVER `IssuanceGuidanceSession`.
 *
 * An issuance agent hosts exactly ONE run for its lifetime (no per-segment re-arming, no launch ref, no in-page
 * guidance panel). It arms observation and reacts to what the driver reports the SELLER did, it never performs a
 * marketplace action, and it puts only sanitized v2 contract values on the wire.
 *
 * A `{ guide }` effect is handled here as ONE batched unit — locate, then (if the control was found) highlight —
 * publishing only once, so the frontend never sees a half-armed intermediate view.
 */
import { validateCommandEnvelope } from "../../../../contracts/action-window/v2/index";
import type { AwClientFrame, AwServerTransport } from "../../../../contracts/action-window/v2/transport";
import { log } from "../../log";
import type { CoupangIssuanceEffect, CoupangIssuanceEngine } from "./coupang-issuance-engine";
import { COUPANG_TARGET_BARRIER_STAGE, type CoupangIssuanceProbeDriver, type CoupangIssuanceTarget } from "./coupang-issuance-driver";
import { isCoupangIssuancePark, isCoupangIssuanceTerminal } from "./coupang-issuance-stages";

export interface CoupangIssuanceSessionOptions {
  /** Fires after every published transition — the persistence hook. */
  onStatePublished?: () => void;
  /** Floor delay between barrier re-arms. A safety floor, not a tuning knob. */
  rearmDelayMs?: number;
  /** How often an observed wait re-reads WING while the seller logs in / navigates. Tests set 0. */
  surfaceWaitPollMs?: number;
  /** How long an observed wait keeps looking. The seated-operator window — never unbounded. */
  surfaceWaitTimeoutMs?: number;
}

export class CoupangIssuanceGuidanceSession {
  private readonly engine: CoupangIssuanceEngine;
  private readonly driver: CoupangIssuanceProbeDriver;
  private readonly transport: AwServerTransport;
  private readonly runId: string;
  private readonly onStatePublished: (() => void) | undefined;
  private readonly rearmDelayMs: number;
  private readonly surfaceWaitPollMs: number;
  private readonly surfaceWaitTimeoutMs: number;
  /** At most ONE park-recovery loop at a time — several would each issue their own recheck. */
  private recovering = false;

  private started = false;
  private publishedSeq = 0;
  /** Refcount of automatic drives in flight — NOT a boolean (the START drive and a detached watchBarrier run
   * concurrently and each own a unit of "busy"; only when EVERY drive settles does `whenSettled` return). */
  private busyCount = 0;
  private unsubscribe: (() => void) | null = null;
  private surfaceCloseToken = 0;

  constructor(
    engine: CoupangIssuanceEngine,
    driver: CoupangIssuanceProbeDriver,
    transport: AwServerTransport,
    opts?: CoupangIssuanceSessionOptions,
  ) {
    this.engine = engine;
    this.driver = driver;
    this.transport = transport;
    this.runId = engine.view().runId;
    this.started = engine.isStarted();
    this.onStatePublished = opts?.onStatePublished;
    this.rearmDelayMs = opts?.rearmDelayMs ?? 250;
    this.surfaceWaitPollMs = opts?.surfaceWaitPollMs ?? 1_000;
    this.surfaceWaitTimeoutMs = opts?.surfaceWaitTimeoutMs ?? 10 * 60_000;
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
    throw new Error("coupang issuance session: whenSettled did not converge");
  }

  private handle(frame: AwClientFrame): void {
    if (frame.kind === "aw_guidance_pack") {
      // Coupang issuance has no in-page guidance panel (the seller works in the WING window), so a pack is
      // accepted-and-ignored rather than driving anything.
      log("aw_coupang_issuance_guidance_pack_ignored", { accepted: true });
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
    if (outcome.ok && "effect" in outcome && !isNoop(outcome.effect)) {
      this.busyCount += 1;
      void this.drive(outcome.effect)
        .catch((e) => this.onDriveError(e))
        .finally(() => {
          this.busyCount -= 1;
        });
    }
  }

  private async onDriveError(e: unknown): Promise<void> {
    // A drive fault is most often a NAVIGATION RACE — an in-page locate/highlight read fired while the seller's
    // own page was still moving, destroying the execution context. Do NOT fail closed and leave the run idle:
    // ask the engine to PARK recoverably on page_mismatch, so a `REQUEST_STEP_RECHECK` re-settles and re-guides.
    log("aw_coupang_issuance_drive_error", { reason: errName(e) }, "warn");
    const effect = this.engine.onDriveFault();
    this.publishState();
    if (!isNoop(effect)) {
      try {
        await this.drive(effect);
      } catch (err) {
        void this.driver.cleanup().catch(() => undefined);
        log("aw_coupang_issuance_cleanup_failed", { reason: errName(err) }, "warn");
      }
    }
  }

  private async drive(effect: CoupangIssuanceEffect): Promise<void> {
    if (typeof effect === "object") {
      if ("guide" in effect) return this.guide(effect.guide);
      // `observe` rests at a seller barrier. The watcher runs detached so the drive chain unwinds and the run is
      // genuinely idle while the seller works in the WING window.
      await this.driver.armObserve(effect.observe);
      void this.watchBarrier(effect.observe);
      return;
    }
    switch (effect) {
      case "PROBE": {
        const probe = await this.driver.probeSurface();
        this.watchSurfaceClose();
        const next = this.engine.onSurfaceProbed(probe);
        this.publishState();
        return this.drive(next);
      }
      case "VERIFY_REACH": {
        // The seller navigated to the issuance page (a navigation the driver observed). Re-read the sanitized page
        // category and let the engine confirm it is open_api_issuance before guiding 자체개발. BOUNDED POLLING: the
        // SPA can classify as a transient `unknown` mid-hydration, so use the driver's settled probe if present.
        const probe = await (this.driver.probeSurfaceSettled?.() ?? this.driver.probeSurface());
        const next = this.engine.onReachVerified(probe);
        this.publishState();
        return this.drive(next);
      }
      case "AWAIT_SURFACE": {
        // Keep looking, inside WING, until the seller gets somewhere we recognize. This is the loop that lets a
        // run start on a blank tab and survive a login without anyone touching the SellerOps tab.
        //
        // The engine's wait states are idempotent, so re-reading the same page emits nothing; only a CHANGE
        // produces a transition. Bounded by the same seated-operator window every other observation uses — an
        // unbounded loop would outlive the run and keep polling a page nobody is looking at.
        // Counted in POLLS, not in accumulated milliseconds: a zero-delay cadence (which tests use, and which a
        // caller could pass) would advance an elapsed-time accumulator by zero and loop forever.
        const maxPolls = Math.max(1, Math.ceil(this.surfaceWaitTimeoutMs / Math.max(1, this.surfaceWaitPollMs)));
        for (let i = 0; i < maxPolls; i++) {
          if (this.engine.isPaused() || isCoupangIssuanceTerminal(this.engine.currentStage())) return;
          await new Promise<void>((resolve) => setTimeout(resolve, this.surfaceWaitPollMs));
          if (this.engine.isPaused() || isCoupangIssuanceTerminal(this.engine.currentStage())) return;
          const again = await this.driver.probeSurface();
          const next = this.engine.onSurfaceProbed(again);
          this.publishState();
          if (next !== "AWAIT_SURFACE") return this.drive(next);
        }
        return;
      }
      case "CLEAR_HIGHLIGHT": {
        await this.driver.clearHighlight();
        this.maybeRecoverPark();
        return;
      }
      case "CLEANUP": {
        await this.driver.cleanup();
        return;
      }
      case "NONE":
      default:
        this.maybeRecoverPark();
        return;
    }
  }

  /**
   * Start the park recovery loop if the run has settled into one, and only one loop at a time.
   *
   * Called where a drive chain ENDS, because that is where a park becomes visible: the effect that produced it
   * has been applied and nothing else is going to move the run.
   */
  private maybeRecoverPark(): void {
    if (this.recovering) return;
    if (!isCoupangIssuancePark(this.engine.currentStage())) return;
    if (this.engine.isPaused()) return;
    this.recovering = true;
    this.busyCount += 1;
    void this.recoverPark()
      .catch(() => undefined)
      .finally(() => {
        this.recovering = false;
        this.busyCount -= 1;
      });
  }

  /**
   * Guide one control to a seller barrier as a single batched unit: locate, then — only if the engine says the
   * locate was clean — highlight. Publishing once at the end means the frontend never sees the barrier stage
   * before its `TARGET_HIGHLIGHTED` event exists.
   */
  private async guide(target: CoupangIssuanceTarget): Promise<void> {
    // Settle the surface BEFORE the locate so a fixed-label locate/highlight never fires on a still-settling
    // post-navigation page. Best-effort and value-free; a driver without a real page omits it. If a read still
    // races a navigation and throws, `onDriveError → engine.onDriveFault` parks recoverably.
    await this.driver.settleSurface?.();
    const loc = await this.driver.locateTarget(target);
    const afterLoc = this.engine.onTargetLocated(target, loc);
    if (typeof afterLoc === "object" && "guide" in afterLoc) {
      const hl = await this.driver.highlightTarget(target);
      const afterHl = this.engine.onTargetHighlighted(target, hl);
      this.publishState();
      return this.drive(afterHl);
    }
    // Locate parked (target_not_found) — publish the park and follow whatever it returned.
    this.publishState();
    return this.drive(afterLoc);
  }

  /**
   * Await the seller's own action on one control, then rejoin the chain. Re-arms while the engine is still
   * resting on this barrier — an expired observation window means the seller has not acted YET, not that the run
   * should be abandoned. Bounded: the loop exits the moment the engine leaves this barrier.
   */
  private async watchBarrier(target: CoupangIssuanceTarget): Promise<void> {
    let acted = await this.driver.observeUserAction(target);
    while (!acted) {
      if (!this.stillWaitingOn(target)) return;
      await new Promise<void>((resolve) => setTimeout(resolve, this.rearmDelayMs));
      if (!this.stillWaitingOn(target)) return;
      await this.driver.armObserve(target);
      acted = await this.driver.observeUserAction(target);
    }
    this.busyCount += 1;
    try {
      const next = this.engine.onUserActionObserved(target);
      // Publish the observation before driving on — otherwise a terminal `CLEANUP` effect, which does not itself
      // publish, would never send the completion view.
      this.publishState();
      await this.drive(next);
    } catch (e) {
      await this.onDriveError(e);
    } finally {
      this.busyCount -= 1;
    }
  }

  /**
   * Recover a RECOVERABLE PARK by itself, inside WING.
   *
   * The remaining parks — a control that is not on the page yet, a page that moved between the locate and the
   * highlight, a window that was closed and reopened — all cleared only on a `REQUEST_STEP_RECHECK`, which the
   * seller can only send from the SellerOps tab. That is the tab this walk exists to keep them out of, so each
   * of those parks was a silent instruction to go back.
   *
   * A recheck is what the frontend's button would have sent; issuing it here on a timer is the same recovery
   * without the round trip. Bounded, and it stops the moment the run leaves the park (or the engine reports
   * there is nothing to redo), so a genuinely stuck run does not spin forever.
   *
   * The button remains: this removes the NEED to press it, never the ability.
   */
  private async recoverPark(): Promise<void> {
    const maxPolls = Math.max(1, Math.ceil(this.surfaceWaitTimeoutMs / Math.max(1, this.surfaceWaitPollMs)));
    for (let i = 0; i < maxPolls; i++) {
      await new Promise<void>((resolve) => setTimeout(resolve, this.surfaceWaitPollMs));
      if (this.engine.isPaused() || isCoupangIssuanceTerminal(this.engine.currentStage())) return;
      if (!isCoupangIssuancePark(this.engine.currentStage())) return;
      const outcome = this.engine.command({ type: "REQUEST_STEP_RECHECK", expectedRevision: this.engine.view().revision });
      if (!outcome.ok) return;
      this.publishState();
      if ("effect" in outcome && !isNoop(outcome.effect)) {
        await this.drive(outcome.effect);
        // The drive either recovered the run or parked it again; either way the loop's own check decides.
      }
    }
  }

  /** True while the engine is resting on exactly this target's barrier and not paused. */
  private stillWaitingOn(target: CoupangIssuanceTarget): boolean {
    return !this.engine.isPaused() && this.engine.currentStage() === COUPANG_TARGET_BARRIER_STAGE[target] && this.engine.activeTarget() === target;
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
    if (isCoupangIssuanceTerminal(this.engine.currentStage())) return;
    const effect = this.engine.onSurfaceClosed();
    this.publishState();
    if (!isNoop(effect)) {
      this.busyCount += 1;
      void this.drive(effect)
        .catch((e) => this.onDriveError(e))
        .finally(() => {
          this.busyCount -= 1;
        });
    }
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

function isNoop(effect: CoupangIssuanceEffect): boolean {
  return effect === "NONE";
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
