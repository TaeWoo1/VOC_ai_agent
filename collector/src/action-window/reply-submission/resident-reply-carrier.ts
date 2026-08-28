/**
 * The resident `reply/naver` carrier — a reviewnary conversation starts a NAVER review reply run through the paired
 * local agent with one `START_RUN {intent: "REPLY_SUBMISSION", submissionRef}`, exactly the seated CLI's run
 * shape, minus the seat (Agentic Operating Workspace v2 §13; product-owner decision 2026-08-28 —
 * `docs/resident_helper_on_demand_carrier_v1.md`).
 *
 * <p>The engine binds its target at construction, but a resident helper learns the target only when the seller
 * presses: so this carrier buffers the client's frames, spends the single-use `submissionRef` at the backend to
 * learn the hint and the approved draft, assembles the engine + session + guided-fill driver, and then replays the
 * buffered frames into the session. Nothing about the review (ids, text) is on the Bridge wire; the ref is.
 *
 * <p>Fail-closed: a ref the backend refuses ends the run `FAILED` before a browser is opened.
 */
import type { AwClientFrame, AwServerFrame, AwServerTransport } from "../../../../contracts/action-window/v2/transport";
import { assembleReplyRun } from "./reply-dispatch";
import type { ReplySubmitProbeDriver } from "./reply-driver";
import type { ReplyEngine } from "./reply-engine";
import type { ReplySubmitSession } from "./reply-session";
import type { ReplySubmissionTarget } from "./reply-submission-target-client";
import type { ReplyExecutionObservation } from "./reply-execution-observer-client";
import { log } from "../../log";

export interface ResidentReplyCarrierDeps {
  readonly runId: string;
  readonly channelCode: string;
  readonly transport: AwServerTransport;
  /** Spend the single-use ref at the backend. `null` ⇒ refused (spent, expired, foreign). */
  readonly resolveTarget: (submissionRef: string) => Promise<ReplySubmissionTarget | null>;
  /** Build the driver for this target — the approved draft is handed to the driver and to nothing else. */
  readonly createDriver: (target: ReplySubmissionTarget) => ReplySubmitProbeDriver;
  /** Report a guided-fill observation for the backend's execution row; never awaited on the hot path. */
  readonly observe?: (target: ReplySubmissionTarget, state: ReplyExecutionObservation) => Promise<boolean>;
}

/** The subset of the transport a session sees: replayed frames, plus the real send. */
class BufferedTransport implements AwServerTransport {
  private readonly listeners = new Set<(frame: AwClientFrame) => void>();
  constructor(private readonly inner: AwServerTransport) {}
  send(frame: AwServerFrame): void {
    this.inner.send(frame);
  }
  subscribe(listener: (frame: AwClientFrame) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  replay(frame: AwClientFrame): void {
    for (const l of this.listeners) l(frame);
  }
}

export class ResidentReplyCarrier {
  private readonly buffered: BufferedTransport;
  private readonly pending: AwClientFrame[] = [];
  private session: ReplySubmitSession | null = null;
  private engine: ReplyEngine | null = null;
  private resolving = false;
  private refused = false;
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly deps: ResidentReplyCarrierDeps) {
    this.buffered = new BufferedTransport(deps.transport);
  }

  attach(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.deps.transport.subscribe((frame) => this.onFrame(frame));
  }

  isStarted(): boolean {
    return this.engine?.isStarted() ?? false;
  }

  status(): string | null {
    return this.engine ? this.engine.view().status : this.refused ? "FAILED" : null;
  }

  private onFrame(frame: AwClientFrame): void {
    if (this.session) {
      this.buffered.replay(frame);
      return;
    }
    this.pending.push(frame);
    if (frame.kind !== "aw_command" || frame.command.type !== "START_RUN" || this.resolving || this.refused) return;
    const payload = (frame.command as { payload?: { submissionRef?: unknown } }).payload;
    const ref = typeof payload?.submissionRef === "string" ? payload.submissionRef : null;
    if (!ref) {
      this.refuse(frame.command.commandId, "MISSING_SUBMISSION_REF");
      return;
    }
    this.resolving = true;
    void this.deps.resolveTarget(ref)
      .then((target) => {
        if (!target) {
          this.refuse(frame.command.commandId, "SUBMISSION_REF_REFUSED");
          return;
        }
        const assembly = assembleReplyRun(this.buffered, {
          runId: this.deps.runId,
          channelCode: this.deps.channelCode,
          submissionRef: ref,
          targetHint: target.hint,
          mode: "FULL_SUBMIT",
          composerFill: true,
          createDriver: () => this.deps.createDriver(target),
          onExecutionObserved: (state) => {
            void this.deps.observe?.(target, state).catch(() => false);
          },
        });
        this.engine = assembly.engine;
        this.session = assembly.session;
        this.session.attach();
        log("aw_naver_reply_run_hosted", { onDemand: true, guided: true });
        for (const buffered of this.pending.splice(0)) this.buffered.replay(buffered);
      })
      .catch(() => this.refuse(frame.command.commandId, "SUBMISSION_REF_REFUSED"))
      .finally(() => {
        this.resolving = false;
      });
  }

  private refuse(commandId: string, reason: string): void {
    this.refused = true;
    this.pending.splice(0);
    log("aw_naver_reply_run_refused", { reason });
    this.deps.transport.send({ kind: "aw_command_result", commandId, accepted: false, reason });
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }
}
