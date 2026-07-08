/**
 * **Projection hub (slice §B/§C/§D).** The transport-neutral coordinator between projection viewers (SellerOps
 * tabs) and the single projection source (the CDP adapter). It enforces the V0 invariants:
 *
 * - **One active projection per agent**: a single source, started on the first viewer and stopped on the last.
 * - **Multiple viewers, one control owner**: control is a lease (`ProjectionRegistry`); input is accepted only
 *   from the current owner, renews the lease, and never force-takeable.
 * - **Bounded frame queue, drop-old**: each viewer keeps at most `PROJECTION_MAX_QUEUE_DEPTH` not-yet-flushed
 *   frames; an overflow drops the OLDEST (counter only) so memory never grows.
 * - **No frame bytes / URLs / DOM in logs**: frames are opaque `Buffer`s forwarded to the sink; only counters
 *   and coarse target state are ever surfaced.
 *
 * It is fully decoupled from `ws`: the bridge server adapts each socket to a {@link ViewerSink}. Time is
 * injected via the registry, so lease expiry is driven by `tick()` and is deterministically testable.
 */

import { log } from "../log";
import {
  encodeFrameHeader,
  PROJECTION_MAX_QUEUE_DEPTH,
  PROJECTION_PROTOCOL_VERSION,
  type ProjectionCapabilities,
  type ProjectionClientMessage,
  type ProjectionControlLostReason,
  type ProjectionInputRejection,
  type ProjectionServerMessage,
} from "./projection-protocol";
import type { AdapterFrame } from "./projection-adapter";
import type { Viewport } from "./projection-input";
import type { ProjectionRegistry } from "./projection-session";

/** A transport sink for one viewer socket. `sendFrame` reports flush completion so the hub can pump the queue. */
export interface ViewerSink {
  sendText(json: string): void;
  sendFrame(frame: Buffer, onFlushed: () => void): void;
  close(code?: number, reason?: string): void;
}

/** The single frame/input source (the CDP adapter, or a test fake). */
export interface ProjectionSource {
  readonly isStarted: boolean;
  readonly viewport: Viewport;
  start(): Promise<void>;
  stop(): Promise<void>;
  dispatchInput(
    input: Extract<ProjectionClientMessage, { type: "input" }>["input"],
    modifiers?: { meta?: boolean; ctrl?: boolean },
  ): Promise<{ accepted: boolean; reason?: string }>;
}

interface Viewer {
  connId: string;
  pairingId: string;
  sink: ViewerSink;
  queue: Buffer[];
  sending: boolean;
  drops: number;
}

export interface ProjectionHubOptions {
  registry: ProjectionRegistry;
  source: ProjectionSource;
  capabilities: ProjectionCapabilities;
  /** Opaque 16-hex handle for the initial target (never a URL/title). */
  initialTargetHandle: string;
  /** Called when a viewer explicitly requests switching to an announced target (e.g. a popup). */
  onTargetSwitchRequested?: (targetHandle: string) => void;
}

export class ProjectionHub {
  private readonly reg: ProjectionRegistry;
  private readonly source: ProjectionSource;
  private readonly caps: ProjectionCapabilities;
  private readonly viewers = new Map<string, Viewer>();
  private targetHandle: string;
  private announcedPopup: string | null = null;
  private lastKnownOwner: string | null = null;
  private readonly onTargetSwitchRequested?: (h: string) => void;
  private closed = false;

  constructor(opts: ProjectionHubOptions) {
    this.reg = opts.registry;
    this.source = opts.source;
    this.caps = opts.capabilities;
    this.targetHandle = opts.initialTargetHandle;
    this.onTargetSwitchRequested = opts.onTargetSwitchRequested;
  }

  get viewerCount(): number {
    return this.viewers.size;
  }

  /** Register a viewer (already ticket-authorized). Starts the source on the first viewer. */
  async addViewer(connId: string, pairingId: string, sink: ViewerSink): Promise<void> {
    if (this.closed) { sink.close(1001, "closed"); return; }
    const viewer: Viewer = { connId, pairingId, sink, queue: [], sending: false, drops: 0 };
    this.viewers.set(connId, viewer);
    if (!this.source.isStarted) {
      try {
        await this.source.start();
      } catch {
        this.text(viewer, { type: "recoverable_error", reason: "source_stalled" });
      }
    }
    log("projection_viewer_added", { viewers: this.viewers.size });
    this.text(viewer, { type: "hello_projection", protocolVersion: PROJECTION_PROTOCOL_VERSION, capabilities: this.caps });
    this.text(viewer, { type: "session_started", sessionRef: this.targetHandle, targetHandle: this.targetHandle });
    this.text(viewer, this.reg.controlOwner() ? { type: "control_held_by_other" } : { type: "control_available" });
  }

  /** A viewer socket closed. Releases its control lease; stops the source when the last viewer leaves. */
  async removeViewer(connId: string): Promise<void> {
    const v = this.viewers.get(connId);
    if (!v) return;
    this.viewers.delete(connId);
    v.queue.length = 0;
    const wasOwner = this.reg.hasControl(connId);
    this.reg.onConnectionClosed(connId);
    if (wasOwner) {
      this.lastKnownOwner = null;
      this.broadcastControlLost(connId, "disconnected");
      this.broadcast({ type: "control_available" });
    }
    if (this.viewers.size === 0 && this.source.isStarted) {
      await this.source.stop();
    }
    log("projection_viewer_removed", { viewers: this.viewers.size });
  }

  /** Handle a client control message. Returns nothing — all effects flow back over the sinks. */
  async onClientMessage(connId: string, msg: ProjectionClientMessage): Promise<void> {
    const v = this.viewers.get(connId);
    if (!v) return;
    switch (msg.type) {
      case "request_control": {
        const grant = this.reg.requestControl(connId, v.pairingId);
        if (grant.ok) {
          this.lastKnownOwner = connId;
          this.text(v, { type: "control_granted", expiresInMs: grant.expiresInMs });
          for (const other of this.viewers.values()) if (other.connId !== connId) this.text(other, { type: "control_held_by_other" });
        } else {
          this.text(v, { type: "control_held_by_other" });
        }
        return;
      }
      case "release_control": {
        if (this.reg.hasControl(connId)) {
          this.reg.releaseControl(connId);
          this.lastKnownOwner = null;
          this.text(v, { type: "control_lost", reason: "released" });
          this.broadcast({ type: "control_available" });
        }
        return;
      }
      case "input": {
        if (!this.reg.hasControl(connId)) { this.text(v, { type: "input_rejected", reason: "no_control_lease" }); return; }
        if (!this.source.isStarted) { this.text(v, { type: "input_rejected", reason: "not_started" }); return; }
        const modifiers = deriveModifiers(msg.input);
        const r = await this.source.dispatchInput(msg.input, modifiers);
        if (r.accepted) {
          this.reg.renewControl(connId);
          this.text(v, { type: "input_accepted" });
        } else {
          this.text(v, { type: "input_rejected", reason: normalizeReason(r.reason) });
        }
        return;
      }
      case "request_target_switch": {
        // Explicit user action to move to an announced popup/new target (slice §11). No URL is ever involved.
        if (this.announcedPopup && msg.targetHandle === this.announcedPopup) {
          this.onTargetSwitchRequested?.(msg.targetHandle);
          this.targetHandle = msg.targetHandle;
          this.announcedPopup = null;
          this.broadcast({ type: "target_changed", targetHandle: this.targetHandle, state: "active" });
        }
        return;
      }
      case "ping":
        return;
    }
  }

  /** Broadcast a sanitized image frame to all viewers with per-viewer bounded queue + drop-old. */
  broadcastFrame(frame: AdapterFrame): void {
    if (this.closed) return;
    const header = encodeFrameHeader(frame.seq, frame.deviceWidth, frame.deviceHeight);
    const payload = Buffer.concat([header, frame.bytes]);
    for (const v of this.viewers.values()) this.enqueue(v, payload);
  }

  private enqueue(v: Viewer, payload: Buffer): void {
    if (v.queue.length >= PROJECTION_MAX_QUEUE_DEPTH) {
      v.queue.shift(); // drop-old: discard the oldest not-yet-flushed frame
      v.drops += 1;
    }
    v.queue.push(payload);
    this.pump(v);
  }

  private pump(v: Viewer): void {
    if (v.sending || v.queue.length === 0) return;
    const next = v.queue.shift()!;
    v.sending = true;
    v.sink.sendFrame(next, () => {
      v.sending = false;
      this.pump(v);
    });
  }

  /** Announce a popup/new target became available (agent-side wiring). Viewer must switch explicitly. */
  announcePopup(targetHandle: string): void {
    this.announcedPopup = targetHandle;
    this.broadcast({ type: "target_changed", targetHandle, state: "popup_available" });
  }

  /** Announce the current target is navigating (stream continues) — no URL. */
  announceNavigating(): void {
    this.broadcast({ type: "target_changed", targetHandle: this.targetHandle, state: "navigating" });
  }

  /** The current target closed (terminal for this projection). */
  async announceTargetClosed(): Promise<void> {
    this.broadcast({ type: "target_changed", targetHandle: this.targetHandle, state: "closed" });
    await this.stopAll("target_closed");
  }

  /** Poll lease expiry (server calls on an interval); notifies the ex-owner of an idle expiry. */
  tick(): void {
    const owner = this.reg.controlOwner();
    if (this.lastKnownOwner && owner !== this.lastKnownOwner) {
      const ex = this.lastKnownOwner;
      this.lastKnownOwner = owner;
      this.broadcastControlLost(ex, "expired");
      this.broadcast({ type: "control_available" });
    } else {
      this.lastKnownOwner = owner;
    }
  }

  /** Revoke everything for a pairing (pairing revocation): stop frames+input, close that pairing's viewers. */
  async revokePairing(pairingId: string): Promise<void> {
    this.reg.revokeForPairing(pairingId);
    const owned = [...this.viewers.values()].filter((v) => v.pairingId === pairingId);
    for (const v of owned) {
      this.text(v, { type: "control_lost", reason: "pairing_revoked" });
      this.text(v, { type: "terminal_error", reason: "pairing_revoked" });
      v.queue.length = 0;
      v.sink.close(1000, "revoked");
      this.viewers.delete(v.connId);
    }
    if (this.reg.controlOwner() === null) this.lastKnownOwner = null;
    if (this.viewers.size === 0 && this.source.isStarted) await this.source.stop();
  }

  /** Terminal stop for all viewers (agent shutdown / target close / projection stop). */
  async stopAll(reason: ProjectionControlLostReason): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.reg.clearControl();
    this.lastKnownOwner = null;
    for (const v of this.viewers.values()) {
      this.text(v, { type: "control_lost", reason });
      this.text(v, { type: "stopped" });
      v.queue.length = 0;
      v.sink.close(1000, "stopped");
    }
    this.viewers.clear();
    if (this.source.isStarted) await this.source.stop();
  }

  private broadcastControlLost(connId: string, reason: ProjectionControlLostReason): void {
    const v = this.viewers.get(connId);
    if (v) this.text(v, { type: "control_lost", reason });
  }

  private text(v: Viewer, msg: ProjectionServerMessage): void {
    v.sink.sendText(JSON.stringify(msg));
  }

  private broadcast(msg: ProjectionServerMessage): void {
    const text = JSON.stringify(msg);
    for (const v of this.viewers.values()) v.sink.sendText(text);
  }

  /** Test-only: dropped-frame counters per viewer (aggregate). No frame bytes. */
  dropStats(): { totalDrops: number; maxQueueDepth: number } {
    let totalDrops = 0, maxQueueDepth = 0;
    for (const v of this.viewers.values()) {
      totalDrops += v.drops;
      if (v.queue.length > maxQueueDepth) maxQueueDepth = v.queue.length;
    }
    return { totalDrops, maxQueueDepth };
  }
}

const REJECTIONS: ReadonlySet<ProjectionInputRejection> = new Set<ProjectionInputRejection>([
  "no_control_lease", "not_started", "forbidden_input", "out_of_bounds", "paused", "disconnected", "closed_target",
]);
function normalizeReason(reason: string | undefined): ProjectionInputRejection {
  return reason && (REJECTIONS as ReadonlySet<string>).has(reason) ? (reason as ProjectionInputRejection) : "forbidden_input";
}

function deriveModifiers(input: Extract<ProjectionClientMessage, { type: "input" }>["input"]): { meta?: boolean; ctrl?: boolean } {
  // V0 inputs carry no modifier flags (chords are rejected by policy); reserved for a future extension.
  void input;
  return {};
}
