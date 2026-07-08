/**
 * **Browser Projection V0 client (frontend).** Holds the projection session over a SEPARATE binary WebSocket
 * (never the G1 status channel), drives control acquisition, forwards reviewed input, and hands decoded frame
 * bytes to a renderer via `onFrame`. The state machine is transport-injected (fetch + a WS factory + storage
 * + a desktop flag) so it is unit-testable in plain node with no browser.
 *
 * Invariants (slice §0.2/§0.7): device pairing is the trust root; projection uses a separate short-lived
 * ticket; input needs control ownership; reconnect restores VIEW only (never control); a bounded, drop-old
 * frame queue (depth ≤ 2) prevents unbounded memory; forbidden inputs are never even sent.
 */

import {
  decodeFrameHeader,
  isAllowedInput,
  isProjectionCompatible,
  PROJECTION_PROTOCOL_VERSION,
  type DecodedFrameHeader,
  type ProjectionCapabilities,
  type ProjectionInput,
  type ProjectionInputRejection,
  type ProjectionServerMessage,
  type ProjectionTargetState,
} from "./projectionProtocol";

const TOKEN_KEY = "sellerops_bridge_token";

export type ProjectionPhase =
  | "connecting"
  | "unreachable"
  | "unpaired"
  | "desktop_only"
  | "unavailable"
  | "starting"
  | "active"
  | "paused"
  | "disconnected"
  | "target_closed"
  | "incompatible"
  | "revoked";

export type ControlSubstate = "available" | "requesting" | "owned" | "held_by_other";

export interface ProjectionState {
  phase: ProjectionPhase;
  control: ControlSubstate;
  capabilities?: ProjectionCapabilities;
  targetState?: ProjectionTargetState;
  /** Popup/new target handle awaiting an explicit user switch (slice §11). */
  popupHandle?: string;
  droppedFrames: number;
  /** Always true — frames/input are local-only and non-persistent (privacy indicator, slice §9). */
  localOnly: true;
  lastRejection?: ProjectionInputRejection;
}

export interface ProjectionWebSocketLike {
  send(data: string): void;
  close(): void;
  binaryType: string;
  onopen: (() => void) | null;
  onmessage: ((ev: { data: string | ArrayBuffer }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
}

export interface StorageLike {
  getItem(key: string): string | null;
  removeItem(key: string): void;
}

export interface ProjectionClientDeps {
  httpBase: string;
  wsBase: string;
  /** V0 is desktop-only; a non-desktop browser shows the explanation instead of connecting (slice §13). */
  isDesktop: boolean;
  fetchFn?: typeof fetch;
  wsFactory?: (url: string) => ProjectionWebSocketLike;
  storage?: StorageLike;
  clientProjectionVersion?: number;
  /** Renderer sink — receives the frame header + raw image bytes (the client never creates object URLs). */
  onFrame?: (header: DecodedFrameHeader, bytes: Uint8Array) => void;
}

export class ProjectionClient {
  private readonly d: Required<Omit<ProjectionClientDeps, "clientProjectionVersion" | "onFrame">> & {
    clientProjectionVersion: number;
    onFrame?: (h: DecodedFrameHeader, b: Uint8Array) => void;
  };
  private state: ProjectionState = { phase: "connecting", control: "available", droppedFrames: 0, localOnly: true };
  private listeners = new Set<(s: ProjectionState) => void>();
  private ws: ProjectionWebSocketLike | null = null;
  private stopped = false;
  private renderInFlight = false;
  private pendingFrame: { header: DecodedFrameHeader; bytes: Uint8Array } | null = null;

  constructor(deps: ProjectionClientDeps) {
    this.d = {
      httpBase: deps.httpBase,
      wsBase: deps.wsBase,
      isDesktop: deps.isDesktop,
      fetchFn: deps.fetchFn ?? fetch.bind(globalThis),
      wsFactory: deps.wsFactory ?? ((url) => makeBrowserWs(url)),
      storage: deps.storage ?? (window.localStorage as StorageLike),
      clientProjectionVersion: deps.clientProjectionVersion ?? PROJECTION_PROTOCOL_VERSION,
      onFrame: deps.onFrame,
    };
  }

  getState(): ProjectionState {
    return this.state;
  }
  subscribe(fn: (s: ProjectionState) => void): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }
  private set(patch: Partial<ProjectionState>): void {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn(this.state);
  }

  /** Begin a projection: desktop gate → pairing token → projection ticket → binary WS. */
  async start(): Promise<void> {
    if (this.stopped) return;
    if (!this.d.isDesktop) { this.set({ phase: "desktop_only" }); return; }
    const token = this.d.storage.getItem(TOKEN_KEY);
    if (!token) { this.set({ phase: "unpaired" }); return; }
    this.set({ phase: "connecting" });
    let ticket: string;
    try {
      const res = await this.d.fetchFn(`${this.d.httpBase}/projection/ticket`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ clientProjectionVersion: this.d.clientProjectionVersion }),
      });
      if (res.status === 401) { this.set({ phase: "unpaired" }); return; }
      if (res.status === 409) { this.set({ phase: "incompatible" }); return; }
      if (res.status === 404) { this.set({ phase: "unavailable" }); return; }
      const body = (await res.json()) as { ticket?: string };
      if (!res.ok || !body.ticket) { this.set({ phase: "unreachable" }); return; }
      ticket = body.ticket;
    } catch {
      this.set({ phase: "unreachable" });
      return;
    }
    this.connectWs(ticket);
  }

  private connectWs(ticket: string): void {
    this.set({ phase: "starting", control: "available" });
    const ws = this.d.wsFactory(`${this.d.wsBase}/projection/ws?ticket=${encodeURIComponent(ticket)}`);
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    ws.onmessage = (ev) => {
      if (typeof ev.data === "string") this.onControl(ev.data);
      else this.onFrameBytes(new Uint8Array(ev.data));
    };
    ws.onclose = () => {
      if (this.ws === ws && !this.stopped) {
        this.ws = null;
        this.renderInFlight = false;
        this.pendingFrame = null;
        // Reconnect restores VIEW only — control resets to available (slice §0.2).
        if (this.state.phase === "active" || this.state.phase === "starting" || this.state.phase === "paused") {
          this.set({ phase: "disconnected", control: "available" });
        }
      }
    };
    ws.onerror = () => { /* onclose follows */ };
  }

  private onControl(data: string): void {
    let msg: ProjectionServerMessage;
    try { msg = JSON.parse(data) as ProjectionServerMessage; } catch { return; }
    switch (msg.type) {
      case "hello_projection":
        if (!isProjectionCompatible(this.d.clientProjectionVersion, msg.protocolVersion)) {
          this.set({ phase: "incompatible" });
          this.closeWs();
          return;
        }
        this.set({ capabilities: msg.capabilities });
        return;
      case "session_started":
        if (this.state.phase === "starting") this.set({ phase: "active" });
        return;
      case "control_available":
        if (this.state.control !== "owned") this.set({ control: "available" });
        return;
      case "control_held_by_other":
        this.set({ control: "held_by_other" });
        return;
      case "control_granted":
        this.set({ control: "owned", phase: this.state.phase === "starting" ? "active" : this.state.phase });
        return;
      case "control_lost":
        this.set({ control: "available" });
        return;
      case "input_accepted":
        if (this.state.lastRejection) this.set({ lastRejection: undefined });
        return;
      case "input_rejected":
        this.set({ lastRejection: msg.reason });
        return;
      case "target_changed":
        if (msg.state === "closed") { this.set({ phase: "target_closed", targetState: "closed" }); }
        else if (msg.state === "popup_available") { this.set({ targetState: "popup_available", popupHandle: msg.targetHandle }); }
        else this.set({ targetState: msg.state });
        return;
      case "paused":
        this.set({ phase: "paused" });
        return;
      case "stopped":
        this.set({ phase: "unavailable", control: "available" });
        return;
      case "recoverable_error":
        // Stream continues after a transient CDP hiccup — reflect reattaching without losing the session.
        this.set({ phase: "starting" });
        return;
      case "terminal_error":
        this.set({
          phase: msg.reason === "pairing_revoked" ? "revoked" : msg.reason === "target_closed" ? "target_closed" : "unavailable",
          control: "available",
        });
        return;
    }
  }

  /** Bounded drop-old frame delivery: one render in flight + at most one pending (latest) frame. */
  private onFrameBytes(buf: Uint8Array): void {
    const header = decodeFrameHeader(buf);
    if (!header) return;
    const bytes = buf.subarray(10);
    if (this.renderInFlight) {
      if (this.pendingFrame) this.set({ droppedFrames: this.state.droppedFrames + 1 }); // drop the OLD pending
      this.pendingFrame = { header, bytes };
      return;
    }
    this.deliver(header, bytes);
  }
  private deliver(header: DecodedFrameHeader, bytes: Uint8Array): void {
    this.renderInFlight = true;
    this.d.onFrame?.(header, bytes);
  }
  /** The renderer calls this once it has drawn (and released) the last frame — pumps any pending frame. */
  frameRendered(): void {
    this.renderInFlight = false;
    if (this.pendingFrame) {
      const p = this.pendingFrame;
      this.pendingFrame = null;
      this.deliver(p.header, p.bytes);
    }
  }

  requestControl(): void {
    if (!this.ws) return;
    this.set({ control: "requesting" });
    this.ws.send(JSON.stringify({ type: "request_control" }));
  }
  releaseControl(): void {
    if (!this.ws) return;
    this.ws.send(JSON.stringify({ type: "release_control" }));
    this.set({ control: "available" });
  }
  requestTargetSwitch(): void {
    if (!this.ws || !this.state.popupHandle) return;
    this.ws.send(JSON.stringify({ type: "request_target_switch", targetHandle: this.state.popupHandle }));
  }

  /** Send a reviewed input — only while controlling and only if allowed (else silently refused + flagged). */
  sendInput(input: ProjectionInput): void {
    if (!this.ws || this.state.control !== "owned" || this.state.phase !== "active") {
      this.set({ lastRejection: "no_control_lease" });
      return;
    }
    if (!isAllowedInput(input)) {
      this.set({ lastRejection: "forbidden_input" });
      return;
    }
    this.ws.send(JSON.stringify({ type: "input", input }));
  }

  private closeWs(): void {
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      try { ws.close(); } catch { /* already closed */ }
    }
  }

  stop(): void {
    this.stopped = true;
    this.pendingFrame = null;
    this.renderInFlight = false;
    this.closeWs();
  }
}

function makeBrowserWs(url: string): ProjectionWebSocketLike {
  const ws = new WebSocket(url);
  return ws as unknown as ProjectionWebSocketLike;
}

/** Production factory using browser globals (mirrors makeBridgeClient). */
export function makeProjectionClient(overrides: Partial<ProjectionClientDeps> = {}): ProjectionClient {
  const httpBase = overrides.httpBase ?? ((import.meta.env.VITE_BRIDGE_URL as string | undefined) ?? "http://127.0.0.1:47615");
  const wsBase = overrides.wsBase ?? httpBase.replace(/^http/, "ws");
  const isDesktop = overrides.isDesktop ?? !/Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  return new ProjectionClient({ httpBase, wsBase, isDesktop, ...overrides });
}
