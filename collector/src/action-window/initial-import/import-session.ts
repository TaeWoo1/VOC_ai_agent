/**
 * **Initial-review-import session supervisor (ISOLATED, v2).** Connects the FE (over a v2 transport) to the
 * pure {@link ImportSegmentEngine} and an {@link ImportProbeDriver}. The import-side sibling of
 * `ActionWindowSession` (v1 export) and `ReplySubmitSession` (v2 reply).
 *
 * **Why this is more than a copy of the reply session.** A reply run has ONE human barrier; an import
 * segment has six, and each one is followed by more automatic work. That makes `autoBusy` genuinely
 * load-bearing rather than a test convenience: every barrier continuation drives a multi-step chain
 * (locate → highlight → observe, or read-scope → gate → locate export), so the flag has to be held across
 * the whole chain or `whenSettled` returns while the run is mid-flight and a test asserts on a state that
 * is about to change.
 *
 * INVARIANTS (inherited, and structural here):
 *  - the session never performs a marketplace action — it arms observation and reacts to what the driver
 *    reports the SELLER did;
 *  - it puts only sanitized v2 contract values on the wire;
 *  - a barrier's watcher only advances a barrier that is still open for that same target, so a late or
 *    duplicated observation cannot skip a step.
 */
import { validateCommandEnvelope } from "../../../../contracts/action-window/v2/index";
import type { AwClientFrame, AwServerTransport } from "../../../../contracts/action-window/v2/transport";
import type { ImportEffect, ImportSegmentEngine } from "./import-engine";
import type { ImportProbeDriver, ImportTarget, RequiredRange } from "./import-driver";

export interface ImportSessionOptions {
  /** Fires after every published transition — the persistence hook. */
  onStatePublished?: () => void;
  /**
   * Floor delay between barrier re-arms.
   *
   * Not a tuning knob — a safety floor. With a long observation window (the live driver waits two minutes)
   * the loop is naturally slow, but with a driver that returns immediately it would spin at full speed and
   * peg a core. A re-arm is never a hot path, so a pause costs nothing and removes the hazard.
   */
  rearmDelayMs?: number;
}

export class ImportSegmentSession {
  private readonly engine: ImportSegmentEngine;
  private readonly driver: ImportProbeDriver;
  private readonly transport: AwServerTransport;
  private readonly required: RequiredRange;
  private readonly runId: string;
  private readonly onStatePublished: (() => void) | undefined;
  private readonly rearmDelayMs: number;

  private started = false;
  private publishedSeq = 0;
  private autoBusy = false;
  private unsubscribe: (() => void) | null = null;

  constructor(
    engine: ImportSegmentEngine,
    driver: ImportProbeDriver,
    transport: AwServerTransport,
    required: RequiredRange,
    opts?: ImportSessionOptions,
  ) {
    this.engine = engine;
    this.driver = driver;
    this.transport = transport;
    this.required = required;
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
    throw new Error("import session: whenSettled did not converge");
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
    if (outcome.ok && "effect" in outcome && !isNoop(outcome.effect)) {
      this.autoBusy = true;
      void this.drive(outcome.effect)
        .catch(() => this.fatalCleanup())
        .finally(() => {
          this.autoBusy = false;
        });
    }
  }

  private async drive(effect: ImportEffect): Promise<void> {
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
      case "READ_FACTS": {
        const facts = await this.driver.readSurfaceFacts();
        const next = this.engine.onFactsRead(facts);
        this.publishState();
        return this.drive(next);
      }
      case "READ_SCOPE": {
        // The driver reads the raw selected dates in-process and returns only the verdict; nothing here
        // ever sees a date value, which is what keeps the OPERATOR-LOCAL rule intact by construction.
        const match = await this.driver.readSelectedScope(this.required);
        const next = this.engine.onScopeRead(match);
        this.publishState();
        return this.drive(next);
      }
      case "DETECT_DOWNLOAD": {
        const res = await this.driver.detectDownload();
        const next = this.engine.onDownloadDetected(res);
        this.publishState();
        return this.drive(next);
      }
      case "VALIDATE_ARTIFACT": {
        const ref = this.engine.detectedArtifactRef();
        if (!ref) return;
        const res = await this.driver.validateArtifact(ref);
        const next = this.engine.onArtifactValidated(res);
        this.publishState();
        return this.drive(next);
      }
      case "INGEST": {
        const ref = this.engine.detectedArtifactRef();
        if (!ref) return;
        const res = await this.driver.ingest(ref);
        const next = this.engine.onIngested(res);
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
   * Holds `autoBusy` across the continuation because it drives more than one step — a date barrier leads
   * to another locate/highlight, and the last date barrier leads to the scope read and the gate. Without
   * that, `whenSettled` could return between the observation and the work it triggers.
   */
  private async watchBarrier(target: ImportTarget): Promise<void> {
    // A human barrier has no deadline that should kill the run. An observation window expiring means the
    // seller has not acted YET — they are reading, or picking from a calendar, or were interrupted — so the
    // observation is re-armed and we keep watching for as long as the engine is still resting on this
    // target. The first live attempt stranded here: a 15-second window expired while the operator was
    // working, the watcher returned, and nothing was left observing a run that still said
    // WAITING_FOR_HUMAN. A status that claims we are waiting has to mean we are actually watching.
    //
    // Bounded anyway: the loop exits the moment the engine leaves this barrier — a cancel, a pause, a
    // scope block or a completed step all move it — so this cannot spin on a finished run.
    let acted = await this.driver.waitForTargetAction(target);
    while (!acted) {
      if (this.engine.currentStage() !== this.barrierStageFor(target)) return;
      await new Promise<void>((resolve) => setTimeout(resolve, this.rearmDelayMs));
      // Re-check after the pause: the run may have been cancelled or paused while we waited.
      if (this.engine.currentStage() !== this.barrierStageFor(target)) return;
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

  private barrierStageFor(target: ImportTarget): string {
    return BARRIER_STAGE_FOR[target];
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
    // The run marker is saved AFTER the sanitized state is published, never before — a persisted record
    // must not lead the wire, or a resumed run could claim progress the frontend never saw.
    this.onStatePublished?.();
  }
}

/**
 * The barrier stage the engine sits at while resting on one target. Mirrored here (rather than exported from
 * the engine) so the session can ask "is this barrier still open" without reaching into engine internals.
 */
const BARRIER_STAGE_FOR: Readonly<Record<ImportTarget, string>> = {
  start_date: "WAIT_FOR_START",
  end_date: "WAIT_FOR_END",
  apply_range: "WAIT_FOR_APPLY",
  export: "WAIT_FOR_EXPORT",
  consent: "WAIT_FOR_CONSENT",
};

function isNoop(effect: ImportEffect): boolean {
  return effect === "NONE";
}

function safeCommandId(command: unknown): string {
  const id = (command as { commandId?: unknown })?.commandId;
  return typeof id === "string" ? id : "unknown";
}
