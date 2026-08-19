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
 *
 * **On-demand hosting (2026-08-19).** The resident SellerOps 도우미 (`--bridge-only`) mounts ONE endpoint
 * too — an on-demand host that sits idle (announces nothing, holds no browser) until a SellerOps tab asks
 * for a carrier by name with `{type:"aw_attach", carrier, channelCode}`. That request is the only
 * carrier-selection message on the wire; it is optional (fixed-carrier agents ignore it, and older tabs
 * never send it), so every existing carrier keeps its announce-on-connect behaviour unchanged.
 */
import type { WebSocket } from "ws";

/** A SellerOps tab naming the carrier it wants to attach to. Sanitized: two enumerable strings. */
export interface AwAttachRequest {
  /** An `AwCarrierKind` value (`issuance`, `import`, …). Validated by the server before it reaches here. */
  carrier: string;
  /** Sanitized channel identity (`coupang`, `naver`). Lower-case letters only, validated by the server. */
  channelCode: string;
}

export interface AwCarrierEndpoint {
  /** Called once a socket has passed the Bridge's origin + ticket + pairing checks. */
  onClientConnected(ws: WebSocket): void;
  /** An opaque `{type:"aw"}` carrier payload from an authenticated socket. */
  onClientPayload(ws: WebSocket, payload: string): void;
  onClientDisconnected(ws: WebSocket): void;
  /**
   * OPTIONAL: an authenticated socket asked for a carrier by name. A fixed-carrier endpoint may leave this
   * unimplemented (its announcement already went out on connect); the on-demand host uses it to activate
   * the named carrier and announce it to the asking socket.
   */
  onClientAttachRequest?(ws: WebSocket, request: AwAttachRequest): void;
  close(): void;
}
