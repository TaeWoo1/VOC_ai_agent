/**
 * **Review-acquisition ↔ Bridge passthrough endpoint (ISOLATED, v2).** The acquisition-side sibling of
 * `review-locate-endpoint.ts`, binding the **v2** Action Window transport to the existing authenticated
 * `/bridge/ws` socket as an OPAQUE carrier. A separate module so none of the existing endpoints is touched;
 * they differ only in what rides inside the payload, which the Bridge never inspects.
 *
 * Modelled on {@link ReviewLocateEndpoint}: an acquisition agent hosts exactly ONE run identity for its
 * lifetime — a second START_RUN with a different `acquisitionRef` re-arms that run — so there is no per-run
 * `armRun` re-announcement.
 *
 * Carrier shapes (identical framing to the other six; older clients ignore unknown `type`s):
 *   - both directions: `{ type: "aw", payload: string }` — payload is a serialized v2 Aw*Frame;
 *   - agent → client on attach: `{ type: "aw_session", carrier, transportVersion, runId, channelCode }`.
 *     `carrier` is `acquire` here — the ONLY field separating this from the locate carrier, which is
 *     otherwise identical on the wire (`channelCode` is `coupang` on both).
 *
 * Security + sanitization are fully inherited (origin-allowlist + ticket + pairing at the Bridge; frames
 * carry only enums/counts/opaque refs from the v2 contract). The endpoint logs only booleans/counts, never a
 * frame body — and never a review, which this carrier is the one that reads.
 */
import { WebSocket } from "ws";
import { AW_CARRIER_ACQUIRE } from "../../../contracts/action-window/aw-carrier-kind";
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

/** Agent → client announcement of the hosted acquisition run. Values are sanitized. */
export interface ReviewAcquisitionAwSessionAnnouncement {
  type: "aw_session";
  /** Always `acquire` for this endpoint. A client expecting another carrier must fail closed on it. */
  carrier: typeof AW_CARRIER_ACQUIRE;
  transportVersion: number;
  runId: string;
  channelCode: string;
}

export interface ReviewAcquisitionEndpointDeps {
  /** Opaque run identity of the single hosted acquisition session. */
  runId: string;
  /** Sanitized channel identity (SEMANTIC_CODE) — `coupang`. */
  channelCode: string;
}

export class ReviewAcquisitionEndpoint implements AwCarrierEndpoint {
  private runId: string;
  private channelCode: string;
  private announcing = true;
  private readonly sockets = new Set<WebSocket>();
  private readonly listeners = new Set<(frame: AwClientFrame) => void>();
  private replyTarget: WebSocket | null = null;

  constructor(deps: ReviewAcquisitionEndpointDeps) {
    this.runId = deps.runId;
    this.channelCode = deps.channelCode;
  }

  /** The Runtime end the {@link ReviewAcquisitionSession} binds to (same interface the v2 loopback implements). */
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
      const announcement: ReviewAcquisitionAwSessionAnnouncement = {
        carrier: AW_CARRIER_ACQUIRE,
        type: "aw_session",
        transportVersion: ACTION_WINDOW_TRANSPORT_VERSION,
        runId: this.runId,
        channelCode: this.channelCode,
      };
      this.sendRaw(ws, JSON.stringify(announcement));
    }
    log("aw_acquire_client_attached", { clients: this.sockets.size, announced: this.announcing });
  }

  /** DEV/TEST: pause/resume the `aw_session` announcement (models the agent being down/up). */
  setAnnouncing(on: boolean): void {
    this.announcing = on;
    log("aw_acquire_dev_announcing", { on });
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
      log("aw_acquire_frame_malformed", { dropped: true });
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

  runtimeListenerCount(): number {
    return this.listeners.size;
  }

  close(): void {
    this.sockets.clear();
    this.listeners.clear();
  }

  private sendFrame(frame: AwServerFrame): void {
    const text = JSON.stringify({ type: "aw", payload: serializeFrame(frame) });
    const directed = frame.kind === "aw_command_result" || frame.kind === "aw_resync_result" ? this.replyTarget : null;
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
