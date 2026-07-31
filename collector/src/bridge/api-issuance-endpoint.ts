/**
 * **API-issuance ↔ Bridge passthrough endpoint (ISOLATED, v2).** The issuance-side sibling of
 * `action-window-endpoint.ts` (v1 export), `reply-submission-endpoint.ts` (v2 reply), and
 * `initial-import-endpoint.ts` (v2 import), binding the **v2** Action Window transport to the existing
 * authenticated `/bridge/ws` socket as an OPAQUE carrier. A separate module so none of the existing endpoints
 * is touched; they differ only in what rides inside the payload, which the Bridge never inspects.
 *
 * Modelled on {@link ReplySubmissionEndpoint} rather than the import endpoint: an issuance agent hosts exactly
 * ONE run for its lifetime (a single onboarding walk), so there is NO per-segment `armRun` re-announcement —
 * the announcement is fixed at construction.
 *
 * Carrier shapes (identical framing to the other three; older clients ignore unknown `type`s):
 *   - both directions: `{ type: "aw", payload: string }` — payload is a serialized v2 Aw*Frame;
 *   - agent → client on attach: `{ type: "aw_session", carrier, transportVersion, runId, channelCode }`.
 *     `carrier` is `issuance` here — the ONLY field separating this from the reply/import carriers
 *     (`transportVersion` is 1 in v1 and v2, `channelCode` is `naver`). Without it, a frontend expecting a
 *     reply or import run would attach to an issuance agent, build a correctly-versioned client, and sit
 *     dormant — the exact mis-attach the carrier-kind field exists to prevent.
 *
 * ── REGISTRATION SEAM ─────────────────────────────────────────────────────────────────────────────────
 * This endpoint is NOT yet wired into `agent/agent-bridge.ts`. Mounting it there means extending the
 * mutually-exclusive carrier union (`AgentBridgeConfig`), the boot-time exclusivity guard, the
 * `importEndpoint ?? replyEndpoint ?? actionWindow` precedence chain, the `AgentBridge` interface, and the
 * `cli/local-agent.ts` boot — broad agent-bootstrap surface. Per the slice's low-risk rule that seam is left
 * for a follow-up: this endpoint already `implements AwCarrierEndpoint`, so it slots into the same single
 * carrier slot with no shape change when wired. See the implementation report.
 *
 * Security + sanitization are fully inherited (origin-allowlist + ticket + pairing at the Bridge; frames
 * carry only enums/counts/opaque refs from the v2 contract). The endpoint logs only booleans/counts, never a
 * frame body.
 */
import { WebSocket } from "ws";
import { AW_CARRIER_ISSUANCE } from "../../../contracts/action-window/aw-carrier-kind";
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

/** Agent → client announcement of the hosted issuance run. Values are sanitized. */
export interface IssuanceAwSessionAnnouncement {
  type: "aw_session";
  /** Always `issuance` for this endpoint. A reply/import/export-expecting client must fail closed on it. */
  carrier: typeof AW_CARRIER_ISSUANCE;
  transportVersion: number;
  runId: string;
  channelCode: string;
}

export interface ApiIssuanceEndpointDeps {
  /** Opaque run identity of the single hosted issuance session. */
  runId: string;
  /** Sanitized channel identity (SEMANTIC_CODE, e.g. `naver`). */
  channelCode: string;
}

export class ApiIssuanceEndpoint implements AwCarrierEndpoint {
  private runId: string;
  private channelCode: string;
  private announcing = true;
  private readonly sockets = new Set<WebSocket>();
  private readonly listeners = new Set<(frame: AwClientFrame) => void>();
  private replyTarget: WebSocket | null = null;

  constructor(deps: ApiIssuanceEndpointDeps) {
    this.runId = deps.runId;
    this.channelCode = deps.channelCode;
  }

  /** The Runtime end the {@link IssuanceGuidanceSession} binds to (same interface the v2 loopback implements). */
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
      const announcement: IssuanceAwSessionAnnouncement = {
        carrier: AW_CARRIER_ISSUANCE,
        type: "aw_session",
        transportVersion: ACTION_WINDOW_TRANSPORT_VERSION,
        runId: this.runId,
        channelCode: this.channelCode,
      };
      this.sendRaw(ws, JSON.stringify(announcement));
    }
    log("aw_issuance_client_attached", { clients: this.sockets.size, announced: this.announcing });
  }

  /** DEV/TEST: pause/resume the `aw_session` announcement (models the agent being down/up). */
  setAnnouncing(on: boolean): void {
    this.announcing = on;
    log("aw_issuance_dev_announcing", { on });
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
      log("aw_issuance_frame_malformed", { dropped: true });
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
