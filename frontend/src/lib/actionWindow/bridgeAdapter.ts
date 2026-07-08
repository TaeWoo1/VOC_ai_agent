// **Bridge-backed Action Window adapter (R2).**
//
// The real transport sibling of `mockAdapter`. Instead of applying local demo transitions, it speaks
// the shared Action Window transport (frames riding inside Local Agent Bridge v1) to the local-agent
// Runtime: it sends command envelopes and folds the Runtime's sanitized events + View Model back into
// local state. The Runtime alone owns state, verification, and step completion — this adapter never
// completes a step and never fabricates a view.
//
// It is transport-injected (`AwClientTransport`), so it is identical whether the transport is a real
// Bridge WebSocket or an in-process loopback used in tests. Copy stays FE-owned: the adapter emits
// only semantic commands and renders FE-authored notes; it never surfaces a raw identifier as prose.

import {
  ACTION_WINDOW_PROTOCOL_VERSION,
  isDuplicateEvent,
  isOutOfOrderEvent,
  type ActionWindowRunView,
  type AwClientTransport,
  type AwServerFrame,
  type CommandEnvelope,
  type CommandType,
  type EventEnvelope,
} from "./contract";

export interface BridgeClientOptions {
  /** The agreed Operation Run id this adapter drives (assigned out-of-band, e.g. via pairing). */
  runId: string;
  /** Sanitized channel identity sent with START_RUN. */
  channelCode: string;
}

export interface BridgeClient {
  getView(): ActionWindowRunView | null;
  /** FE-authored, sanitized status note for the last local transition (never a raw identifier). */
  getNote(): string;
  /** Whether a command is dispatchable given the latest Runtime-supplied view. */
  isAllowed(type: CommandType): boolean;
  /** Send a command intent. Ignored (with a note) if the latest view does not allow it. */
  send(type: CommandType): void;
  subscribe(listener: () => void): () => void;
  /** Attach to the transport and hydrate via resync (also the reconnect entry point). */
  connect(): void;
  /** Ask the Runtime to replay the latest view + any events missed since the last seen sequence. */
  resync(): void;
  close(): void;
}

const DISALLOWED_NOTE = "지금은 할 수 없는 동작이라 무시했어요.";
const REJECTED_NOTE = "요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.";

class BridgeClientImpl implements BridgeClient {
  private view: ActionWindowRunView | null = null;
  private note = "";
  private lastSequence = 0;
  private cmdSeq = 0;
  private readonly seenEventIds = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly transport: AwClientTransport, private readonly opts: BridgeClientOptions) {}

  getView(): ActionWindowRunView | null {
    return this.view;
  }
  getNote(): string {
    return this.note;
  }

  isAllowed(type: CommandType): boolean {
    if (this.view === null) return type === "START_RUN";
    return this.view.allowedCommands.includes(type);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private emitChange(): void {
    for (const l of [...this.listeners]) l();
  }

  connect(): void {
    if (!this.unsubscribe) this.unsubscribe = this.transport.subscribe((frame) => this.onServerFrame(frame));
    this.resync();
  }
  close(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  send(type: CommandType): void {
    if (!this.isAllowed(type)) {
      this.note = DISALLOWED_NOTE;
      this.emitChange();
      return;
    }
    const command: CommandEnvelope = {
      protocolVersion: ACTION_WINDOW_PROTOCOL_VERSION,
      commandId: `${this.opts.runId}-c${++this.cmdSeq}`,
      runId: this.opts.runId,
      expectedRevision: this.view?.revision ?? 0,
      type,
      ...(type === "START_RUN" ? { payload: { channelCode: this.opts.channelCode } } : {}),
    };
    this.transport.send({ kind: "aw_command", command });
  }

  resync(): void {
    this.transport.send({ kind: "aw_resync", runId: this.opts.runId, sinceSequence: this.lastSequence });
  }

  private onServerFrame(frame: AwServerFrame): void {
    switch (frame.kind) {
      case "aw_event":
        this.ingestEvent(frame.event);
        this.emitChange();
        break;
      case "aw_view":
        this.adoptView(frame.view);
        this.emitChange();
        break;
      case "aw_command_result":
        if (!frame.accepted) {
          this.note = REJECTED_NOTE;
          this.emitChange();
        }
        break;
      case "aw_resync_result":
        if (frame.view) this.adoptView(frame.view);
        for (const e of frame.events) this.ingestEvent(e);
        this.emitChange();
        break;
    }
  }

  /** Events are for ordering/dedupe bookkeeping (drives resync); the view is the render source of truth. */
  private ingestEvent(e: EventEnvelope): void {
    if (isDuplicateEvent(e.eventId, this.seenEventIds)) return;
    if (isOutOfOrderEvent(e.sequence, this.lastSequence)) return;
    this.seenEventIds.add(e.eventId);
    this.lastSequence = e.sequence;
  }
  private adoptView(v: ActionWindowRunView): void {
    if (this.view === null || v.revision >= this.view.revision) this.view = v;
  }
}

export function createBridgeClient(transport: AwClientTransport, opts: BridgeClientOptions): BridgeClient {
  return new BridgeClientImpl(transport, opts);
}
