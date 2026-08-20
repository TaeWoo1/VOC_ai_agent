/**
 * **Coupang WING credential-RENEWAL guidance session supervisor (ISOLATED, v2).** The renewal sibling of
 * `../coupang-issuance/coupang-issuance-session.ts`: it connects the FE (over a v2 transport) to the pure
 * {@link CoupangRenewalEngine} and a {@link CoupangRenewalProbeDriver}. A renewal agent hosts exactly ONE run for
 * its lifetime. It arms observation and reacts to what the driver reports the SELLER did; it never performs a
 * marketplace action, never re-issues a key, never reads a credential value, and puts only sanitized v2 contract
 * values on the wire. A `{ guide }` effect is handled here as ONE batched unit (locate, then highlight),
 * publishing only once so the frontend never sees a half-armed intermediate view.
 */
import { validateCommandEnvelope } from "../../../../contracts/action-window/v2/index";
import type { AwClientFrame, AwServerTransport } from "../../../../contracts/action-window/v2/transport";
import { log } from "../../log";
import type { CoupangRenewalEffect, CoupangRenewalEngine } from "./coupang-renewal-engine";
import { COUPANG_RENEWAL_TARGET_BARRIER_STAGE, type CoupangRenewalProbeDriver, type CoupangRenewalTarget } from "./coupang-renewal-driver";
import { isCoupangRenewalTerminal } from "./coupang-renewal-stages";

export interface CoupangRenewalSessionOptions {
  /** Fires after every published transition — the persistence hook. */
  onStatePublished?: () => void;
  /** Floor delay between barrier re-arms. A safety floor, not a tuning knob. */
  rearmDelayMs?: number;
}

export class CoupangRenewalGuidanceSession {
  private readonly engine: CoupangRenewalEngine;
  private readonly driver: CoupangRenewalProbeDriver;
  private readonly transport: AwServerTransport;
  private readonly runId: string;
  private readonly onStatePublished: (() => void) | undefined;
  private readonly rearmDelayMs: number;

  private started = false;
  private publishedSeq = 0;
  private busyCount = 0;
  private unsubscribe: (() => void) | null = null;
  private surfaceCloseToken = 0;
  /**
   * **Latched when the seller closes the marketplace window, cleared only by an accepted seller command.**
   *
   * Every driver call goes through the lazy wrapper, which brings a surface up on ANY call — so after a close,
   * one probe, one highlight-clear or one recovery tick is enough to put a window back on the seller's screen
   * that they just dismissed. And because the landing runs once per carrier, the window that comes back is
   * BLANK. Live 2026-08-20 on the Coupang walk: close at 06:48:49.756, `landing_skipped ALREADY_NAVIGATED_ONCE`
   * at 06:48:50.014.
   *
   * `agentNavigations: 1` is the promise this keeps — the walk opens one window, at open, and never again on
   * its own.
   */
  private surfaceClosed = false;

  constructor(
    engine: CoupangRenewalEngine,
    driver: CoupangRenewalProbeDriver,
    transport: AwServerTransport,
    opts?: CoupangRenewalSessionOptions,
  ) {
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
    throw new Error("coupang renewal session: whenSettled did not converge");
  }

  private handle(frame: AwClientFrame): void {
    if (frame.kind === "aw_guidance_pack") {
      log("aw_coupang_renewal_guidance_pack_ignored", { accepted: true });
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
    // An accepted command is the SELLER asking for something, which is the ONE thing that may re-open a window
    // they closed. Cleared before the drive, so the chain this command starts is allowed to bring it back up.
    if (outcome.ok) this.surfaceClosed = false;
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
    log("aw_coupang_renewal_drive_error", { reason: errName(e) }, "warn");
    const effect = this.engine.onDriveFault();
    this.publishState();
    if (!isNoop(effect)) {
      try {
        await this.drive(effect);
      } catch (err) {
        void this.driver.cleanup().catch(() => undefined);
        log("aw_coupang_renewal_cleanup_failed", { reason: errName(err) }, "warn");
      }
    }
  }

  private async drive(effect: CoupangRenewalEffect): Promise<void> {
    // **THE choke point for a closed surface.** Every effect below reaches the driver, and the lazy driver opens
    // a window on ANY call, so this is answered once here rather than at each call site (where it was missed).
    if (this.surfaceClosed) return;
    if (typeof effect === "object") {
      if ("guide" in effect) return this.guide(effect.guide);
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
        const probe = await (this.driver.probeSurfaceSettled?.() ?? this.driver.probeSurface());
        const next = this.engine.onReachVerified(probe);
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

  private async guide(target: CoupangRenewalTarget): Promise<void> {
    await this.driver.settleSurface?.();
    const loc = await this.driver.locateTarget(target);
    const afterLoc = this.engine.onTargetLocated(target, loc);
    if (typeof afterLoc === "object" && "guide" in afterLoc) {
      const hl = await this.driver.highlightTarget(target);
      const afterHl = this.engine.onTargetHighlighted(target, hl);
      this.publishState();
      return this.drive(afterHl);
    }
    this.publishState();
    return this.drive(afterLoc);
  }

  private async watchBarrier(target: CoupangRenewalTarget): Promise<void> {
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
      this.publishState();
      await this.drive(next);
    } catch (e) {
      await this.onDriveError(e);
    } finally {
      this.busyCount -= 1;
    }
  }

  private stillWaitingOn(target: CoupangRenewalTarget): boolean {
    return !this.engine.isPaused() && this.engine.currentStage() === COUPANG_RENEWAL_TARGET_BARRIER_STAGE[target] && this.engine.activeTarget() === target;
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
    if (isCoupangRenewalTerminal(this.engine.currentStage())) return;
    // Latched BEFORE the engine transition, so nothing the park produces can reach the driver.
    this.surfaceClosed = true;
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

function isNoop(effect: CoupangRenewalEffect): boolean {
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
