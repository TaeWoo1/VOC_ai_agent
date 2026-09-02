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
import type { ReplyEffect, ReplyEngine, SurfaceProbeResult } from "./reply-engine";
import type { ReplySubmitProbeDriver } from "./reply-driver";
import type { ReplyExecutionObservation } from "./reply-execution-observer-client";

/** Optional session hooks. `onStatePublished` fires after every published transition (R3 persistence). */
export interface ReplySessionOptions {
  onStatePublished?: () => void;
  /**
   * 2026-08-28: fires once per observation the guided fill path makes — `COMPOSER_FILLED` when the draft went
   * into the box, `SELLER_SUBMISSION_OBSERVED` when the seller's submit was seen on it. The carrier reports
   * these to the backend's execution record; the session itself neither posts nor verifies anything.
   */
  onExecutionObserved?: (state: ReplyExecutionObservation) => void;
}

/**
 * Whether a surface probe failed on something a HUMAN can still fix on the page in front of them —
 * the same two codes the engine calls recoverable. Anything else (and a bare `false`) is a state this
 * run cannot wait its way out of.
 */
function isRecoverableSurfaceBlocker(res: SurfaceProbeResult): boolean {
  return res !== true && res !== false && (res.code === "LOGIN_REQUIRED" || res.code === "SESSION_EXPIRED");
}

export class ReplySubmitSession {
  private readonly engine: ReplyEngine;
  private readonly driver: ReplySubmitProbeDriver;
  private readonly transport: AwServerTransport;
  private readonly runId: string;
  private readonly onStatePublished: (() => void) | undefined;
  private readonly onExecutionObserved: ((state: ReplyExecutionObservation) => void) | undefined;

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
    this.onExecutionObserved = opts?.onExecutionObserved;
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
        // A RECOVERABLE precondition is not an outcome — it is a wait (2026-09-03). `LOGIN_REQUIRED` has
        // always been labelled recoverable, and the engine has always turned it into `FAILED` anyway: the
        // dedicated window opens at a login screen, the probe answers in milliseconds, and the run is dead
        // before the seller has finished typing. When the driver can watch the page for that condition
        // clearing, it does, and the engine hears one final answer instead of a premature one. A driver
        // that cannot watch keeps the old behaviour exactly.
        let res = await this.driver.prepareSurface();
        if (isRecoverableSurfaceBlocker(res) && this.driver.waitForSurfaceReady) {
          const ready = await this.driver.waitForSurfaceReady();
          // Re-PROBE rather than trusting the wait: the wait says "the page looks signed in now", and the
          // probe is what the engine's decision is allowed to rest on. A timeout falls through with the
          // original blocker, which fails exactly as it did before.
          if (ready) res = await this.driver.prepareSurface();
        }
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
      case "OPEN_COMPOSER": {
        // The runtime's own press on the verified row's non-submit open control — or, when the driver cannot
        // say which control that is, the barrier where the seller opens it.
        const res = this.driver.openComposer
          ? await this.driver.openComposer()
          : ({ opened: false, reason: "NOT_SUPPORTED" } as const);
        const next = this.engine.onComposerOpened(res);
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
      case "FILL": {
        // A driver without `fillComposer` cannot fill; the run reaches the barrier unfilled, as it always did.
        const res = this.driver.fillComposer ? await this.driver.fillComposer() : ({ filled: false, reason: "NOT_FILLABLE" } as const);
        const next = this.engine.onComposerFilled(res);
        this.publishState();
        if (res.filled) this.onExecutionObserved?.("COMPOSER_FILLED");
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
      if (this.engine.wasComposerFilled()) this.onExecutionObserved?.("SELLER_SUBMISSION_OBSERVED");
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
