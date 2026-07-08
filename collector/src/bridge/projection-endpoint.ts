/**
 * **Projection endpoint (slice §B).** Binds the transport-neutral {@link ProjectionHub} to `ws` sockets and
 * owns the projection ticket lifecycle. The bridge server delegates the projection HTTP/WS paths here so the
 * G1 status channel stays untouched. Server→client image frames are BINARY; client→server control messages
 * are small JSON text — a client that sends a binary payload is rejected.
 *
 * Frame bytes never touch a log here; only counters/coarse state are ever surfaced.
 */

import { randomBytes } from "node:crypto";
import type { WebSocket } from "ws";
import { WebSocket as WS } from "ws";
import { log } from "../log";
import {
  isProjectionCompatible,
  PROJECTION_PROTOCOL_VERSION,
  type ProjectionCapabilities,
  type ProjectionClientMessage,
} from "./projection-protocol";
import { ProjectionHub, type ProjectionSource, type ViewerSink } from "./projection-hub";
import type { AdapterFrame } from "./projection-adapter";
import type { ProjectionRegistry, ProjectionTicketRejection } from "./projection-session";

export interface ProjectionEndpointOptions {
  registry: ProjectionRegistry;
  capabilities: ProjectionCapabilities;
  /** Opaque 16-hex initial target handle (never a URL/title). */
  initialTargetHandle: string;
  /** Builds the single projection source (CDP adapter, or a test fake) wired to broadcast frames. */
  createSource: (onFrame: (f: AdapterFrame) => void) => ProjectionSource;
  onTargetSwitchRequested?: (targetHandle: string) => void;
}

export class ProjectionEndpoint {
  readonly hub: ProjectionHub;
  private readonly registry: ProjectionRegistry;
  private readonly wsToConn = new WeakMap<WebSocket, string>();

  constructor(opts: ProjectionEndpointOptions) {
    this.registry = opts.registry;
    const source = opts.createSource((f) => this.hub.broadcastFrame(f));
    this.hub = new ProjectionHub({
      registry: opts.registry,
      source,
      capabilities: opts.capabilities,
      initialTargetHandle: opts.initialTargetHandle,
      onTargetSwitchRequested: opts.onTargetSwitchRequested,
    });
  }

  /** Mint a single-use projection connection ticket for an already-authenticated pairing. */
  mintTicket(pairingId: string): { ticket: string; expiresInMs: number } {
    return this.registry.mintTicket(pairingId);
  }

  /** Consume a projection ticket at WS upgrade (single-use, replay-safe). */
  consumeTicket(ticket: string): { ok: true; pairingId: string } | { ok: false; reason: ProjectionTicketRejection } {
    return this.registry.consumeTicket(ticket);
  }

  /** Is the frontend's projection protocol version compatible? */
  compatible(clientVersion: number): boolean {
    return isProjectionCompatible(clientVersion, PROJECTION_PROTOCOL_VERSION);
  }

  /** Adopt a freshly-upgraded, ticket-authorized viewer socket. */
  onViewerConnected(ws: WebSocket, pairingId: string): void {
    const connId = randomBytes(8).toString("hex");
    this.wsToConn.set(ws, connId);
    log("projection_ws_accepted", { pairingId });

    ws.on("message", (data: Buffer, isBinary: boolean) => {
      if (isBinary) {
        // The client never sends binary — only small JSON control frames. Reject a binary payload.
        ws.close(1003, "binary_unsupported");
        return;
      }
      let msg: ProjectionClientMessage | null = null;
      try { msg = JSON.parse(data.toString()) as ProjectionClientMessage; } catch { msg = null; }
      if (msg) void this.hub.onClientMessage(connId, msg);
    });
    ws.on("close", () => void this.hub.removeViewer(connId));
    ws.on("error", () => { try { ws.terminate(); } catch { /* gone */ } void this.hub.removeViewer(connId); });

    const sink: ViewerSink = {
      sendText: (json) => { if (ws.readyState === WS.OPEN) ws.send(json); },
      sendFrame: (frame, onFlushed) => {
        if (ws.readyState !== WS.OPEN) { onFlushed(); return; }
        ws.send(frame, { binary: true }, () => onFlushed());
      },
      close: (code, reason) => { try { ws.close(code, reason); } catch { /* gone */ } },
    };
    void this.hub.addViewer(connId, pairingId, sink);
  }

  /** Cascade a pairing revocation: stop frames+input and close that pairing's projection sockets. */
  async revokePairing(pairingId: string): Promise<void> {
    await this.hub.revokePairing(pairingId);
  }

  /** Poll control-lease expiry (server interval). */
  tick(): void {
    this.hub.tick();
  }

  /** Terminal stop (agent shutdown). */
  async close(): Promise<void> {
    await this.hub.stopAll("agent_restart");
  }
}
