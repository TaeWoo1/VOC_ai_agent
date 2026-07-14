/**
 * **Action Window ↔ Bridge passthrough endpoint (R2B).** Binds the shared Action Window transport
 * (`contracts/action-window/v1/transport.ts`) to the existing authenticated `/bridge/ws` socket as an
 * OPAQUE carrier, per the ratified transport governance (contract README §8, contract-boundary §1):
 * Action Window frames are serialized strings the Bridge relays without inspecting — they are NOT new
 * variants of the Bridge `ClientMessage`/`ServerMessage` union, and `bridge/protocol.ts` is unchanged.
 *
 * Carrier shapes (additive; older clients ignore unknown `type`s, so Bridge v1 semantics are untouched):
 *   - both directions: `{ type: "aw", payload: string }` — payload is a serialized Aw*Frame;
 *   - agent → client on attach: `{ type: "aw_session", transportVersion, runId, channelCode }` — the
 *     announcement that tells the FE which Operation Run this agent hosts (run identity is assigned by
 *     the Runtime, never invented by the FE).
 *
 * Security is fully inherited: a socket only ever reaches this endpoint after the Bridge's own
 * origin-allowlist + single-use-ticket + pairing checks, so no separate Action Window ticket exists.
 * Sanitization is inherited from the contract (frames carry only enums/counts/opaque refs); the
 * endpoint itself logs only booleans/counts and never logs a frame body.
 */
import { WebSocket } from "ws";
import {
  ACTION_WINDOW_TRANSPORT_VERSION,
  deserializeFrame,
  serializeFrame,
  type AwClientFrame,
  type AwServerFrame,
  type AwServerTransport,
} from "../../../contracts/action-window/v1/transport";
import { log } from "../log";

/** Agent → client announcement of the hosted run. Values are sanitized (opaque runId, semantic code). */
export interface AwSessionAnnouncement {
  type: "aw_session";
  transportVersion: number;
  runId: string;
  channelCode: string;
}

export interface ActionWindowEndpointDeps {
  /** Opaque run identity of the single hosted session (announced to every attached client). */
  runId: string;
  /** Sanitized channel identity (SEMANTIC_CODE, e.g. `synthetic`). */
  channelCode: string;
}

export class ActionWindowEndpoint {
  private runId: string;
  private channelCode: string;
  /** When false, a newly attached socket receives NO `aw_session` announcement — see {@link setAnnouncing}. */
  private announcing = true;
  private readonly sockets = new Set<WebSocket>();
  private readonly listeners = new Set<(frame: AwClientFrame) => void>();
  /**
   * The socket whose inbound frame is currently being handled. `ActionWindowSession` answers
   * `aw_command_result`/`aw_resync_result` SYNCHRONOUSLY inside `handle()`, so routing those two reply
   * kinds to this socket (and broadcasting everything else) keeps one client's resync replay or
   * rejection note from reaching other tabs, while events/views still fan out to every client.
   */
  private replyTarget: WebSocket | null = null;

  constructor(deps: ActionWindowEndpointDeps) {
    this.runId = deps.runId;
    this.channelCode = deps.channelCode;
  }

  /** The Runtime end the `ActionWindowSession` binds to (same interface the loopback channel implements). */
  readonly transport: AwServerTransport = {
    send: (frame) => this.sendFrame(frame),
    subscribe: (listener) => {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    },
  };

  /** Called by the Bridge server once a socket has passed origin + ticket + pairing checks. */
  onClientConnected(ws: WebSocket): void {
    this.sockets.add(ws);
    // When announcing is paused (a DEV-harness knob), the client gets no `aw_session`, so the FE's
    // `openAnnouncedSocket` times out and — after its retry envelope — settles offline. Default is true,
    // so the production boot and every existing caller announce exactly as before.
    if (this.announcing) {
      const announcement: AwSessionAnnouncement = {
        type: "aw_session",
        transportVersion: ACTION_WINDOW_TRANSPORT_VERSION,
        runId: this.runId,
        channelCode: this.channelCode,
      };
      this.sendRaw(ws, JSON.stringify(announcement));
    }
    log("aw_client_attached", { clients: this.sockets.size, announced: this.announcing });
  }

  // ── DEV/TEST harness controls ────────────────────────────────────────────────────────────────────
  // Loopback knobs for the synthetic UI-verification agent (`cli/action-window-ui-harness.ts`) that let
  // an operator drive the FE's connection states (checkpoint/drop/reconnect/offline/same-vs-different run)
  // by hand. They are NEVER wired into the production local-agent boot; announcing defaults true so the
  // default announce/relay behaviour is unchanged. Logs stay sanitized (booleans/counts only, no runId).

  /** DEV: change the run identity announced to the NEXT connecting socket (same/different-run restart). */
  setHostedRun(runId: string, channelCode?: string): void {
    this.runId = runId;
    if (channelCode !== undefined) this.channelCode = channelCode;
    log("aw_dev_rehost", {});
  }

  /** DEV: pause/resume the `aw_session` announcement (models the agent being "down"/"up" for the AW channel). */
  setAnnouncing(on: boolean): void {
    this.announcing = on;
    log("aw_dev_announcing", { on });
  }

  /** DEV: whether the endpoint is currently announcing its hosted run to new sockets. */
  isAnnouncing(): boolean {
    return this.announcing;
  }

  /** DEV: force-close every attached client socket (models a real network drop). Returns how many closed. */
  dropClientSockets(): number {
    const count = this.sockets.size;
    for (const ws of [...this.sockets]) {
      try {
        ws.close();
      } catch {
        /* already closed */
      }
    }
    log("aw_dev_drop", { count });
    return count;
  }

  /** DEV: the currently announced run identity (sanitized opaque synthetic id). */
  hostedRunId(): string {
    return this.runId;
  }

  onClientDisconnected(ws: WebSocket): void {
    this.sockets.delete(ws);
  }

  /** An opaque `{type:"aw"}` carrier payload from an authenticated socket. Malformed frames are dropped. */
  onClientPayload(ws: WebSocket, payload: string): void {
    let frame: AwClientFrame | null = null;
    try {
      const parsed = deserializeFrame(payload);
      if (parsed.kind === "aw_command" || parsed.kind === "aw_resync") frame = parsed;
    } catch {
      frame = null;
    }
    if (!frame) {
      // Never log the payload — only the fact that a frame was dropped.
      log("aw_frame_malformed", { dropped: true });
      return;
    }
    this.replyTarget = ws;
    try {
      for (const listener of [...this.listeners]) listener(frame);
    } finally {
      this.replyTarget = null;
    }
  }

  /** Number of currently attached (authenticated) clients. Sanitized: a count only. */
  clientCount(): number {
    return this.sockets.size;
  }

  close(): void {
    this.sockets.clear();
    this.listeners.clear();
  }

  private sendFrame(frame: AwServerFrame): void {
    const text = JSON.stringify({ type: "aw", payload: serializeFrame(frame) });
    const directed =
      frame.kind === "aw_command_result" || frame.kind === "aw_resync_result" ? this.replyTarget : null;
    if (directed) {
      this.sendRaw(directed, text);
      return;
    }
    for (const ws of this.sockets) this.sendRaw(ws, text);
  }

  private sendRaw(ws: WebSocket, text: string): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(text);
  }
}
