/**
 * **Review-locate ↔ Bridge passthrough endpoint (ISOLATED, v2).** The locate-side sibling of
 * `action-window-endpoint.ts` (v1 export), `reply-submission-endpoint.ts` (v2 reply),
 * `initial-import-endpoint.ts` (v2 import) and `api-issuance-endpoint.ts` (v2 issuance), binding the **v2**
 * Action Window transport to the existing authenticated `/bridge/ws` socket as an OPAQUE carrier. A separate
 * module so none of the existing endpoints is touched; they differ only in what rides inside the payload,
 * which the Bridge never inspects.
 *
 * Modelled on {@link ApiIssuanceEndpoint}: a locate agent hosts exactly ONE run for its lifetime — one press
 * of `[쿠팡에서 보기]` — so there is NO per-segment `armRun` re-announcement; the announcement is fixed at
 * construction.
 *
 * Carrier shapes (identical framing to the other four; older clients ignore unknown `type`s):
 *   - both directions: `{ type: "aw", payload: string }` — payload is a serialized v2 Aw*Frame;
 *   - agent → client on attach: `{ type: "aw_session", carrier, transportVersion, runId, channelCode }`.
 *     `carrier` is `locate` here — the ONLY field separating this from the reply / import / issuance
 *     carriers (`transportVersion` is 1 in v1 and v2, and `channelCode` is `coupang` on two of them).
 *     Without it, a frontend expecting a guided issuance walk would attach to a locate agent, build a
 *     correctly-versioned client, and sit dormant — the exact mis-attach the carrier-kind field exists to
 *     prevent.
 *
 * Security + sanitization are fully inherited (origin-allowlist + ticket + pairing at the Bridge; frames
 * carry only enums/counts/opaque refs from the v2 contract). The endpoint logs only booleans/counts, never a
 * frame body.
 */
import { WebSocket } from "ws";
import { AW_CARRIER_LOCATE } from "../../../contracts/action-window/aw-carrier-kind";
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

/** Agent → client announcement of the hosted locate run. Values are sanitized. */
export interface ReviewLocateAwSessionAnnouncement {
  type: "aw_session";
  /** Always `locate` for this endpoint. A client expecting another carrier must fail closed on it. */
  carrier: typeof AW_CARRIER_LOCATE;
  transportVersion: number;
  runId: string;
  channelCode: string;
}

export interface ReviewLocateEndpointDeps {
  /** Opaque run identity of the single hosted locate session. */
  runId: string;
  /** Sanitized channel identity (SEMANTIC_CODE) — `coupang`. */
  channelCode: string;
}

export class ReviewLocateEndpoint implements AwCarrierEndpoint {
  private runId: string;
  private channelCode: string;
  private announcing = true;
  private readonly sockets = new Set<WebSocket>();
  private readonly listeners = new Set<(frame: AwClientFrame) => void>();
  private replyTarget: WebSocket | null = null;

  constructor(deps: ReviewLocateEndpointDeps) {
    this.runId = deps.runId;
    this.channelCode = deps.channelCode;
  }

  /** The Runtime end the {@link ReviewLocateSession} binds to (same interface the v2 loopback implements). */
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
      const announcement: ReviewLocateAwSessionAnnouncement = {
        carrier: AW_CARRIER_LOCATE,
        type: "aw_session",
        transportVersion: ACTION_WINDOW_TRANSPORT_VERSION,
        runId: this.runId,
        channelCode: this.channelCode,
      };
      this.sendRaw(ws, JSON.stringify(announcement));
    }
    log("aw_locate_client_attached", { clients: this.sockets.size, announced: this.announcing });
  }

  /** DEV/TEST: pause/resume the `aw_session` announcement (models the agent being down/up). */
  setAnnouncing(on: boolean): void {
    this.announcing = on;
    log("aw_locate_dev_announcing", { on });
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
      log("aw_locate_frame_malformed", { dropped: true });
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
