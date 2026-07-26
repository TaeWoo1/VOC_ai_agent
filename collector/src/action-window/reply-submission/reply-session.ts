/**
 * **Reply-submission session (R2, ISOLATED, v2).** Connects the FE (over a v2 transport) to the pure
 * {@link ReplyEngine} and a {@link ReplySubmitProbeDriver}. Mirrors the export `ActionWindowSession`'s
 * command-reactive choreography, minus the downstream chain: it advances the automatic prep stages,
 * STOPS at the human barrier, and terminates at `OPERATOR_REPORTED` when the operator reports.
 *
 * INVARIANT (inherited): the session never submits the reply. It only arms observation and reacts to
 * a submit the driver reports, and it puts only sanitized v2 contract values on the wire.
 */
import { validateCommandEnvelope } from "../../../../contracts/action-window/v2/index";
import type { AwClientFrame, AwServerTransport } from "../../../../contracts/action-window/v2/transport";
import type { ReplyEffect, ReplyEngine } from "./reply-engine";
import type { ReplySubmitProbeDriver } from "./reply-driver";

/** Optional session hooks. `onStatePublished` fires after every published transition (R3 persistence). */
export interface ReplySessionOptions {
  onStatePublished?: () => void;
}

export class ReplySubmitSession {
  private readonly engine: ReplyEngine;
  private readonly driver: ReplySubmitProbeDriver;
  private readonly transport: AwServerTransport;
  private readonly runId: string;
  private readonly onStatePublished: (() => void) | undefined;

  private started = false;
  private publishedSeq = 0;
  private autoBusy = false;
  private unsubscribe: (() => void) | null = null;

  constructor(engine: ReplyEngine, driver: ReplySubmitProbeDriver, transport: AwServerTransport, opts?: ReplySessionOptions) {
    this.engine = engine;
    this.driver = driver;
    this.transport = transport;
    this.runId = engine.view().runId;
    this.started = engine.isStarted();
    this.onStatePublished = opts?.onStatePublished;
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
    throw new Error("reply-submission session: whenSettled did not converge");
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
    // A guided reply posts one reply on the seller's own screen and has no in-page guidance panel, so an
    // `aw_guidance_pack` is not a frame this runtime has anything to do with. Ignored rather than answered:
    // there is no command to reject and nothing to acknowledge.
    if (frame.kind !== "aw_command") return;
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
    if (outcome.ok && "effect" in outcome && outcome.effect !== "NONE") {
      this.autoBusy = true;
      void this.drive(outcome.effect)
        .catch(() => this.fatalCleanup())
        .finally(() => {
          this.autoBusy = false;
        });
    }
  }

  private async drive(effect: ReplyEffect): Promise<void> {
    switch (effect) {
      case "PREPARE": {
        const res = await this.driver.prepareSurface();
        const next = this.engine.onSurfaceReady(res);
        this.publishState();
        return this.drive(next);
      }
      case "LOCATE_ROW": {
        const res = await this.driver.locateReviewRow();
        const next = this.engine.onRowLocated(res);
        this.publishState();
        return this.drive(next);
      }
      case "HIGHLIGHT_ROW": {
        // The driver RE-VALIDATES the unique match while annotating; feed that result back (anti-drift).
        const res = await this.driver.highlightRow();
        const next = this.engine.onRowHighlighted(res);
        this.publishState();
        return this.drive(next);
      }
      case "OBSERVE_ROW": {
        await this.driver.armRowObserve();
        // Rest at the row-open barrier; the operator opens the reply control themselves (their own click).
        void this.watchRowOpen();
        return;
      }
      case "LOCATE": {
        const res = await this.driver.locateComposer();
        const next = this.engine.onLocated(res);
        this.publishState();
        return this.drive(next);
      }
      case "HIGHLIGHT": {
        await this.driver.highlight();
        const next = this.engine.onHighlighted();
        this.publishState();
        return this.drive(next);
      }
      case "OBSERVE": {
        await this.driver.armObserve();
        // Rest at the human barrier; the seller submits. The session never submits — it observes.
        void this.watchSubmit();
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
   * Guided: await the operator's own row-open click, then rejoin the composer chain. Unlike
   * {@link watchSubmit}, the continuation DRIVES a multi-step chain (locate → highlight → observe), so it
   * must hold `autoBusy` across that chain or `whenSettled` could race and return early.
   */
  private async watchRowOpen(): Promise<void> {
    const opened = await this.driver.waitForRowOpen();
    if (opened && this.engine.currentStage() === "WAIT_FOR_ROW_OPEN") {
      this.autoBusy = true;
      try {
        const next = this.engine.onRowOpened();
        this.publishState();
        await this.drive(next);
      } catch {
        await this.fatalCleanup();
      } finally {
        this.autoBusy = false;
      }
    }
  }

  private async watchSubmit(): Promise<void> {
    const observed = await this.driver.waitForSubmit();
    if (observed && this.engine.currentStage() === "WAIT_FOR_SUBMIT") {
      this.engine.onUserActionObserved();
      this.publishState();
    }
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
    // R3 persistence hook: the reply-run marker is saved AFTER the sanitized state is published, never
    // before — so a persisted record can never lead the wire. No-op unless a persistDir was wired.
    this.onStatePublished?.();
  }
}

function safeCommandId(command: unknown): string {
  const id = (command as { commandId?: unknown })?.commandId;
  return typeof id === "string" ? id : "unknown";
}
