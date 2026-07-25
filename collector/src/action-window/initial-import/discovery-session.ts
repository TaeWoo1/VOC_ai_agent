/**
 * **Range-discovery session supervisor (ISOLATED, v2).** Connects the frontend (over a v2 transport) to the
 * pure {@link ImportDiscoveryEngine} and an {@link ImportDiscoveryDriver}.
 *
 * The same shape as {@link ImportSegmentSession} and deliberately not a generalization of it: the segment
 * session is live-proven, and factoring the two into one supervisor would put that proof behind a refactor
 * for the benefit of a run with two barriers instead of six. What IS shared is the property that cost a live
 * export window to learn — a human barrier has no deadline that kills the run — and it is implemented here
 * the same way, for the same reason.
 *
 * INVARIANTS (structural, inherited):
 *  - the session never performs a marketplace action — it arms observation and reacts to what the driver
 *    reports the SELLER did;
 *  - it puts only sanitized v2 contract values on the wire (and, for discovery, no dates at all);
 *  - a barrier's watcher only advances a barrier that is still open for that same target, so a late or
 *    duplicated observation cannot skip a step.
 */
import { validateCommandEnvelope } from "../../../../contracts/action-window/v2/index";
import type { AwClientFrame, AwServerTransport } from "../../../../contracts/action-window/v2/transport";
import { discoverAvailableRange } from "../../naver/available-range-discovery";
import type { DiscoveryEffect, ImportDiscoveryEngine } from "./discovery-engine";
import type { ImportDiscoveryDriver, ImportTarget } from "./import-driver";

export interface DiscoverySessionOptions {
  /** Fires after every published transition — the persistence hook. */
  onStatePublished?: () => void;
  /**
   * Floor delay between barrier re-arms. A safety floor, not a tuning knob: with a driver that returns
   * immediately the re-arm loop would otherwise spin at full speed and peg a core.
   */
  rearmDelayMs?: number;
}

export class ImportDiscoverySession {
  private readonly engine: ImportDiscoveryEngine;
  private readonly driver: ImportDiscoveryDriver;
  private readonly transport: AwServerTransport;
  private readonly runId: string;
  private readonly onStatePublished: (() => void) | undefined;
  private readonly rearmDelayMs: number;

  private started = false;
  private publishedSeq = 0;
  private autoBusy = false;
  private unsubscribe: (() => void) | null = null;

  constructor(
    engine: ImportDiscoveryEngine,
    driver: ImportDiscoveryDriver,
    transport: AwServerTransport,
    opts?: DiscoverySessionOptions,
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
    this.unsubscribe = this.transport.subscribe((frame) => this.handle(frame));
    return this.unsubscribe;
  }

  /** Resolves once no automatic drive is in flight (test-facing determinism hook). */
  async whenSettled(): Promise<void> {
    for (let i = 0; i < 100_000; i++) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (!this.autoBusy) return;
    }
    throw new Error("discovery session: whenSettled did not converge");
  }

  private handle(frame: AwClientFrame): void {
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
    this.transport.send({
      kind: "aw_command_result",
      commandId: command.commandId,
      accepted: outcome.ok,
      ...(outcome.ok ? {} : { reason: outcome.reason }),
    });
    this.publishState();
    if (command.type === "START_RUN" && outcome.ok) this.started = true;
    if (outcome.ok && "effect" in outcome && outcome.effect !== "NONE") {
      this.autoBusy = true;
      void this.drive(outcome.effect)
        .catch(() => this.fatalCleanup())
        .finally(() => {
          this.autoBusy = false;
        });
    }
  }

  private async drive(effect: DiscoveryEffect): Promise<void> {
    if (typeof effect === "object") {
      if ("locate" in effect) {
        const res = await this.driver.locateTarget(effect.locate);
        const next = this.engine.onTargetLocated(effect.locate, res);
        this.publishState();
        return this.drive(next);
      }
      if ("highlight" in effect) {
        const res = await this.driver.highlightTarget(effect.highlight);
        const next = this.engine.onTargetHighlighted(effect.highlight, res);
        this.publishState();
        return this.drive(next);
      }
      // `observe` rests at a seller barrier. The watcher runs detached so the drive chain unwinds and the
      // run is genuinely idle while the seller works on NAVER.
      await this.driver.armTargetObserve(effect.observe);
      void this.watchBarrier(effect.observe);
      return;
    }
    switch (effect) {
      case "PREPARE": {
        const res = await this.driver.prepareSurface();
        const next = this.engine.onSurfaceReady(res);
        this.publishState();
        return this.drive(next);
      }
      case "READ_BOUNDS": {
        // The session never derives a range itself: the driver reads the controls, the shared pure decision
        // turns that into a verdict, and the engine decides what the verdict means.
        const verdict = discoverAvailableRange(await this.driver.readRangeControls());
        const next = this.engine.onBoundsRead(verdict);
        this.publishState();
        return this.drive(next);
      }
      case "READ_SELECTED": {
        const range = await this.driver.readSelectedRange();
        const next = this.engine.onSelectedRangeRead(range);
        this.publishState();
        return this.drive(next);
      }
      case "REPORT_RANGE": {
        const range = this.engine.establishedRange();
        const evidence = this.engine.recordedEvidence();
        // Both are set by the transition that produced this effect. Fail closed rather than report a range
        // with an evidence the engine never decided — the server would have to default it, and defaulting is
        // exactly what it refuses to do.
        if (!range || !evidence) return;
        const ok = await this.driver.reportDiscoveredRange(range, evidence);
        const next = this.engine.onRangeReported(ok);
        this.publishState();
        return this.drive(next);
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
   * Await the seller's own action on one control, then rejoin the chain.
   *
   * An expiring observation window means the seller has not acted YET — they are reading, or scrolling a
   * calendar back through years of months, which is exactly what this run asks them to do. So it re-arms and
   * keeps watching for as long as the engine is still resting on this target. Bounded anyway: the loop exits
   * the moment the engine leaves this barrier.
   */
  private async watchBarrier(target: ImportTarget): Promise<void> {
    let acted = await this.driver.waitForTargetAction(target);
    while (!acted) {
      if (!this.isRestingOn(target)) return;
      await new Promise<void>((resolve) => setTimeout(resolve, this.rearmDelayMs));
      // Re-check after the pause: the run may have been cancelled or paused while we waited.
      if (!this.isRestingOn(target)) return;
      await this.driver.armTargetObserve(target);
      acted = await this.driver.waitForTargetAction(target);
    }
    this.autoBusy = true;
    try {
      const next = this.engine.onTargetActionObserved(target);
      this.publishState();
      await this.drive(next);
    } catch {
      await this.fatalCleanup();
    } finally {
      this.autoBusy = false;
    }
  }

  /** Whether the engine is still at the barrier for this target — the re-arm loop's only exit condition. */
  private isRestingOn(target: ImportTarget): boolean {
    const stage = this.engine.currentStage();
    return target === "start_date" ? stage === "WAIT_FOR_EARLIEST" : stage === "WAIT_FOR_LATEST";
  }

  private async fatalCleanup(): Promise<void> {
    await this.driver.cleanup().catch(() => {});
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
