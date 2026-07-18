/**
 * **Action-Window carrier endpoint interface.** The minimal shape the {@link BridgeServer} needs from
 * whichever Action-Window endpoint it hosts on the `/bridge/ws` socket, so the server can mount EITHER
 * the v1 export endpoint (`ActionWindowEndpoint`) OR the isolated v2 reply-submission endpoint
 * (`ReplySubmissionEndpoint`) in its single carrier slot without knowing which. Both relay their frames
 * as opaque `{type:"aw"}` payloads, so the Bridge routing is identical; only the contract version
 * inside the opaque payload differs (v1 vs v2), which the Bridge never inspects.
 *
 * An agent hosts exactly ONE Action-Window run (export OR reply), so exactly one such endpoint is ever
 * mounted at a time.
 */
import type { WebSocket } from "ws";

export interface AwCarrierEndpoint {
  /** Called once a socket has passed the Bridge's origin + ticket + pairing checks. */
  onClientConnected(ws: WebSocket): void;
  /** An opaque `{type:"aw"}` carrier payload from an authenticated socket. */
  onClientPayload(ws: WebSocket, payload: string): void;
  onClientDisconnected(ws: WebSocket): void;
  close(): void;
}
