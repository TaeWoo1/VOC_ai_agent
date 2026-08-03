/**
 * **API-issuance guidance session supervisor (ISOLATED, v2).** Connects the FE (over a v2 transport) to the
 * pure {@link IssuanceEngine} and an {@link IssuanceProbeDriver}. The issuance-side sibling of
 * `ActionWindowSession` (v1 export), `ReplySubmitSession` (v2 reply), and `ImportSegmentSession` (v2 import).
 *
 * Simpler than the import session by design: an issuance agent hosts exactly ONE run for its lifetime (no
 * per-segment re-arming sequence, no launch ref, no in-page guidance panel). What it shares with import is the
 * shape that matters: it arms observation and reacts to what the driver reports the SELLER did, it never
 * performs a marketplace action, and it puts only sanitized v2 contract values on the wire.
 *
 * A `{ guide }` effect is handled here as ONE batched unit — locate, then (if the control was found) highlight
 * — publishing only once, so the frontend never sees a half-armed intermediate view for a control that has no
 * dedicated RUNNING stage in the 14-stage machine.
 */
import { validateCommandEnvelope } from "../../../../contracts/action-window/v2/index";
import type { AwClientFrame, AwServerTransport } from "../../../../contracts/action-window/v2/transport";
import { log } from "../../log";
import type { IssuanceEffect, IssuanceEngine } from "./issuance-engine";
import { TARGET_BARRIER_STAGE, type IssuanceProbeDriver, type IssuanceTarget } from "./issuance-driver";
import { isIssuanceTerminal } from "./issuance-stages";

export interface IssuanceSessionOptions {
  /** Fires after every published transition — the persistence hook. */
  onStatePublished?: () => void;
  /**
   * Floor delay between barrier re-arms. A safety floor, not a tuning knob: a driver that returns immediately
   * would otherwise spin at full speed. A re-arm is never a hot path, so a pause costs nothing.
   */
  rearmDelayMs?: number;
}

export class IssuanceGuidanceSession {
  private readonly engine: IssuanceEngine;
  private readonly driver: IssuanceProbeDriver;
  private readonly transport: AwServerTransport;
  private readonly runId: string;
  private readonly onStatePublished: (() => void) | undefined;
  private readonly rearmDelayMs: number;

  private started = false;
  private publishedSeq = 0;
  /**
   * Refcount of automatic drives in flight — NOT a boolean. The START_RUN drive and a detached `watchBarrier`
   * (which it spawns) run concurrently and each own a unit of "busy"; a boolean let whichever finished first
   * clear it while the other was still mid-flight (the flake surfaced once the overlay mount's bounded retry
   * spanned real macrotask sleeps). A counter that each owner increments on entry and decrements in `finally`
   * only reaches 0 when EVERY drive has settled, so `whenSettled` waits for the whole chain, not just the first.
   */
  private busyCount = 0;
  private unsubscribe: (() => void) | null = null;
  private surfaceCloseToken = 0;

  constructor(engine: IssuanceEngine, driver: IssuanceProbeDriver, transport: AwServerTransport, opts?: IssuanceSessionOptions) {
    this.engine = engine;
    this.driver = driver;
    this.transport = transport;
    this.runId = engine.view().runId;
    this.started = engine.isStarted();
    this.onStatePublished = opts?.onStatePublished;
    this.rearmDelayMs = opts?.rearmDelayMs ?? 250;
  }

  attach(): () => void {
    if (this.unsubscribe) return this.unsubscribe;
    const stopTransport = this.transport.subscribe((frame) => this.handle(frame));
    this.unsubscribe = () => {
      // Retire the current window's close watch so a late close after release cannot park a released run.
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
    throw new Error("issuance session: whenSettled did not converge");
  }

  private handle(frame: AwClientFrame): void {
    if (frame.kind === "aw_guidance_pack") {
      // Issuance has no in-page guidance panel (the seller works in the API-center window, not a SellerOps
      // overlay this session owns), so a pack is accepted-and-ignored rather than driving anything.
      log("aw_issuance_guidance_pack_ignored", { accepted: true });
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
    // own page was still moving (the `app_list → app_detail` transition), destroying the execution context. Do
    // NOT fail the run closed and leave it idle with no barrier: ask the engine to PARK recoverably on
    // page_mismatch, so a `REQUEST_STEP_RECHECK` re-settles and re-guides. The engine bounds this — a permanent
    // fault stops re-guiding after a few consecutive faults. Sanitized name only in the log.
    log("aw_issuance_drive_error", { reason: errName(e) }, "warn");
    const effect = this.engine.onDriveFault();
    this.publishState();
    if (!isNoop(effect)) {
      try {
        await this.drive(effect);
      } catch (err) {
        // The recovery drive (CLEAR_HIGHLIGHT) itself faulted — clean up quietly; do NOT re-park (avoid a loop).
        void this.driver.cleanup().catch(() => undefined);
        log("aw_issuance_cleanup_failed", { reason: errName(err) }, "warn");
      }
    }
  }

  private async drive(effect: IssuanceEffect): Promise<void> {
    if (typeof effect === "object") {
      if ("guide" in effect) return this.guide(effect.guide);
      // `observe` rests at a seller barrier. The watcher runs detached so the drive chain unwinds and the run
      // is genuinely idle while the seller works in the API-center window.
      await this.driver.armObserve(effect.observe);
      void this.watchBarrier(effect.observe);
      return;
    }
    switch (effect) {
      case "PROBE": {
        const probe = await this.driver.probeSurface();
        // The window is up (probeSurface did not throw) — arm a close-watch for THIS window.
        this.watchSurfaceClose();
        const next = this.engine.onSurfaceProbed(probe);
        this.publishState();
        return this.drive(next);
      }
      case "READ_APPS": {
        const read = await this.driver.readApplications();
        const next = this.engine.onApplicationsRead(read);
        this.publishState();
        return this.drive(next);
      }
      case "VERIFY_OPEN": {
        // The seller opened their existing app (a navigation the driver observed). Re-read the sanitized page
        // category and let the engine confirm it is app_detail before reusing the api_group highlight — a wrong
        // page / multiple transitions parks recoverably rather than highlighting on a page with no api_group.
        // BOUNDED POLLING: the app-detail SPA can classify as a transient `unknown` mid-hydration, so use the
        // driver's settled probe (poll until app_detail / login / bounded) rather than failing on the first read.
        const probe = await (this.driver.probeSurfaceSettled?.() ?? this.driver.probeSurface());
        const next = this.engine.onOpenAppVerified(probe);
        this.publishState();
        return this.drive(next);
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
        return;
    }
  }

  /**
   * Guide one control to a seller barrier as a single batched unit: locate, then — only if the engine says
   * the locate was clean — highlight. Publishing once at the end means the frontend never sees the barrier
   * stage before its `TARGET_HIGHLIGHTED` event exists.
   */
  private async guide(target: IssuanceTarget): Promise<void> {
    // Settle the surface BEFORE the locate so a fixed-label locate/highlight never fires on a still-settling
    // post-navigation page (the `app_list → app_detail` transition that destroyed the execution context and left
    // the run idle in the live proof). Best-effort and value-free; a driver without a real page omits it. If a
    // read still races a navigation and throws, `onDriveError → engine.onDriveFault` parks recoverably.
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
   * resting on this barrier — an expired observation window means the seller has not acted YET, not that the
   * run should be abandoned. Bounded: the loop exits the moment the engine leaves this barrier.
   */
  private async watchBarrier(target: IssuanceTarget): Promise<void> {
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
      // Publish the observation (USER_ACTION_OBSERVED / STEP_COMPLETED / RUN_COMPLETED) before driving on —
      // otherwise a terminal `CLEANUP` effect, which does not itself publish, would never send the completion
      // view. The stage is still the just-completed barrier here (it does not advance until the next control is
      // highlighted inside `guide`), so this never shows the NEXT barrier before its highlight event exists.
      this.publishState();
      await this.drive(next);
    } catch (e) {
      await this.onDriveError(e);
    } finally {
      this.busyCount -= 1;
    }
  }

  /** True while the engine is resting on exactly this target's barrier and not paused. */
  private stillWaitingOn(target: IssuanceTarget): boolean {
    return !this.engine.isPaused() && this.engine.currentStage() === TARGET_BARRIER_STAGE[target] && this.engine.activeTarget() === target;
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
    if (isIssuanceTerminal(this.engine.currentStage())) return;
    // A closed API-center window is the seller not being where they can act. Park recoverably on
    // page_mismatch (re-opening + a re-check re-probes and recovers) rather than spin an observation on a
    // dead page. The engine returns CLEAR_HIGHLIGHT so the run stops pointing at a control they cannot reach.
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

function isNoop(effect: IssuanceEffect): boolean {
  return effect === "NONE";
}

function safeCommandId(command: unknown): string {
  const id = (command as { commandId?: unknown })?.commandId;
  return typeof id === "string" ? id : "unknown";
}

/** A sanitized label for a caught error — its constructor name only, never its message (which can carry a URL/selector). */
function errName(e: unknown): string {
  if (e instanceof Error) return e.name || "Error";
  return typeof e;
}
