/**
 * **Reply-submission ↔ Bridge passthrough endpoint (ISOLATED, v2).** The reply-side analogue of
 * `action-window-endpoint.ts`, binding the **v2** Action Window transport
 * (`contracts/action-window/v2/transport.ts`) to the existing authenticated `/bridge/ws` socket as an
 * OPAQUE carrier. It is a SEPARATE module so the v1 export endpoint is byte-for-byte untouched; the two
 * differ only in the contract version of the opaque payload, which the Bridge never inspects.
 *
 * Carrier shapes (identical framing to export; older clients ignore unknown `type`s):
 *   - both directions: `{ type: "aw", payload: string }` — payload is a serialized v2 Aw*Frame;
 *   - agent → client on attach: `{ type: "aw_session", transportVersion, runId, channelCode }` — the
 *     announcement that tells the FE which reply-submission Operation Run this agent hosts. Run identity
 *     is assigned by the Runtime, never invented by the FE.
 *
 * Security + sanitization are fully inherited (origin-allowlist + ticket + pairing at the Bridge;
 * frames carry only enums/counts/opaque refs from the v2 contract). The endpoint logs only
 * booleans/counts and never a frame body.
 */
import { WebSocket } from "ws";
import {
  ACTION_WINDOW_TRANSPORT_VERSION,
  deserializeFrame,
  serializeFrame,
  type AwClientFrame,
  type AwServerFrame,
  type AwServerTransport,
} from "../../../contracts/action-window/v2/transport";
import type { AwCarrierEndpoint } from "./aw-carrier";
import { log } from "../log";

/** Agent → client announcement of the hosted reply-submission run. Values are sanitized. */
export interface ReplyAwSessionAnnouncement {
  type: "aw_session";
  transportVersion: number;
  runId: string;
  channelCode: string;
}

export interface ReplySubmissionEndpointDeps {
  /** Opaque run identity of the single hosted reply-submission session. */
  runId: string;
  /** Sanitized channel identity (SEMANTIC_CODE, e.g. `naver`). */
  channelCode: string;
}

export class ReplySubmissionEndpoint implements AwCarrierEndpoint {
  private runId: string;
  private channelCode: string;
  private announcing = true;
  private readonly sockets = new Set<WebSocket>();
  private readonly listeners = new Set<(frame: AwClientFrame) => void>();
  private replyTarget: WebSocket | null = null;

  constructor(deps: ReplySubmissionEndpointDeps) {
    this.runId = deps.runId;
    this.channelCode = deps.channelCode;
  }

  /** The Runtime end the `ReplySubmitSession` binds to (same interface the v2 loopback implements). */
  readonly transport: AwServerTransport = {
    send: (frame) => this.sendFrame(frame),
    subscribe: (listener) => {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    },
  };

  onClientConnected(ws: WebSocket): void {
    this.sockets.add(ws);
    if (this.announcing) {
      const announcement: ReplyAwSessionAnnouncement = {
        type: "aw_session",
        transportVersion: ACTION_WINDOW_TRANSPORT_VERSION,
        runId: this.runId,
        channelCode: this.channelCode,
      };
      this.sendRaw(ws, JSON.stringify(announcement));
    }
    log("aw_reply_client_attached", { clients: this.sockets.size, announced: this.announcing });
  }

  /** DEV/TEST: pause/resume the `aw_session` announcement (models the agent being down/up). */
  setAnnouncing(on: boolean): void {
    this.announcing = on;
    log("aw_reply_dev_announcing", { on });
  }

  isAnnouncing(): boolean {
    return this.announcing;
  }

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
      log("aw_reply_frame_malformed", { dropped: true });
      return;
    }
    this.replyTarget = ws;
    try {
      for (const listener of [...this.listeners]) listener(frame);
    } finally {
      this.replyTarget = null;
    }
  }

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
