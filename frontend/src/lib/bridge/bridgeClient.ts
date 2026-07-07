/**
 * **Local Agent Bridge client (frontend).** Detects the local agent, drives the pairing bootstrap over
 * HTTP, and holds an authenticated WebSocket for sanitized real-time state (slice §Phase C — Frontend).
 * G1 is pairing + observability only: it sends NO marketplace/browser/click commands.
 *
 * Transport is injected (fetch + a WebSocket factory + storage), so the state machine is unit-testable in a
 * plain node environment with no browser. Production wiring uses the browser globals via {@link makeBridgeClient}.
 *
 * **Local Network Access (spike §6.1).** A deployed (secure, non-loopback) SellerOps origin can only reach
 * `ws://localhost` after the user grants Chrome's Local Network Access permission; without it the request is
 * blocked and surfaces to JS only as an opaque failure. So on an unreachable agent we cannot distinguish
 * "agent off" from "LNA-blocked" — the client flags `maybeNeedsLocalNetworkAccess` on a secure non-loopback
 * origin so the UI can offer the permission guidance alongside the offline hint.
 */

import {
  BRIDGE_PROTOCOL_VERSION,
  type BridgeEventCategory,
  type BridgeSnapshot,
  type PairPollResponse,
  type ServerMessage,
} from "./bridgeProtocol";

const TOKEN_KEY = "sellerops_bridge_token";

export type BridgePhase =
  | "connecting"
  | "unreachable"
  | "unpaired"
  | "pairing_pending"
  | "pairing_denied"
  | "connecting_ws"
  | "paired"
  | "incompatible_version"
  | "disconnected"
  | "revoked";

export interface BridgeState {
  phase: BridgePhase;
  confirmationCode?: string;
  maybeNeedsLocalNetworkAccess: boolean;
  snapshot?: BridgeSnapshot;
  agentProtocolVersion?: number;
  /** Event categories the agent reports as actually wired right now (capability negotiation, slice §C). */
  supportedEvents?: BridgeEventCategory[];
}

/** Minimal WebSocket surface the client needs — so tests can inject a fake. */
export interface WebSocketLike {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((ev: { data: string }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface BridgeClientDeps {
  httpBase: string;
  wsBase: string;
  workspaceLabel: string;
  /** True when the page is a secure origin that is NOT loopback (deployed) — enables the LNA hint. */
  isSecureNonLoopbackOrigin: boolean;
  fetchFn?: typeof fetch;
  wsFactory?: (url: string) => WebSocketLike;
  storage?: StorageLike;
  clientProtocolVersion?: number;
}

export class BridgeClient {
  private readonly d: Required<Omit<BridgeClientDeps, "clientProtocolVersion">> & { clientProtocolVersion: number };
  private state: BridgeState;
  private listeners = new Set<(s: BridgeState) => void>();
  private ws: WebSocketLike | null = null;
  private pairingRequestId: string | null = null;
  private stopped = false;

  constructor(deps: BridgeClientDeps) {
    this.d = {
      httpBase: deps.httpBase,
      wsBase: deps.wsBase,
      workspaceLabel: deps.workspaceLabel,
      isSecureNonLoopbackOrigin: deps.isSecureNonLoopbackOrigin,
      fetchFn: deps.fetchFn ?? fetch.bind(globalThis),
      wsFactory: deps.wsFactory ?? ((url) => new WebSocket(url) as unknown as WebSocketLike),
      storage: deps.storage ?? window.localStorage,
      clientProtocolVersion: deps.clientProtocolVersion ?? BRIDGE_PROTOCOL_VERSION,
    };
    this.state = { phase: "connecting", maybeNeedsLocalNetworkAccess: false };
  }

  getState(): BridgeState {
    return this.state;
  }

  subscribe(fn: (s: BridgeState) => void): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  private set(patch: Partial<BridgeState>): void {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn(this.state);
  }

  private token(): string | null {
    return this.d.storage.getItem(TOKEN_KEY);
  }
  private clearToken(): void {
    this.d.storage.removeItem(TOKEN_KEY);
  }

  /** Detect the agent and, if we already hold a pairing token, reconnect + restore the snapshot. */
  async refresh(): Promise<void> {
    if (this.stopped) return;
    this.set({ phase: "connecting" });
    let present = false;
    try {
      // Minimal presence check only — health carries NO pairing state (slice §E). A stale/revoked token is
      // discovered at ticket mint (401), not from health.
      const res = await this.d.fetchFn(`${this.d.httpBase}/bridge/health`);
      present = res.ok;
    } catch {
      present = false;
    }
    if (!present) {
      // Agent off OR (on a deployed origin) blocked by Local Network Access — indistinguishable to JS.
      this.set({ phase: "unreachable", maybeNeedsLocalNetworkAccess: this.d.isSecureNonLoopbackOrigin });
      return;
    }
    const token = this.token();
    if (!token) {
      this.set({ phase: "unpaired", maybeNeedsLocalNetworkAccess: false });
      return;
    }
    await this.connectWs(token);
  }

  /** Begin a pairing request; the user then confirms on the agent-owned local page. */
  async requestPairing(): Promise<void> {
    try {
      const res = await this.d.fetchFn(`${this.d.httpBase}/bridge/pair/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceLabel: this.d.workspaceLabel }),
      });
      if (!res.ok) {
        this.set({ phase: "unreachable", maybeNeedsLocalNetworkAccess: this.d.isSecureNonLoopbackOrigin });
        return;
      }
      const body = (await res.json()) as { requestId: string; confirmationCode: string };
      this.pairingRequestId = body.requestId;
      this.set({ phase: "pairing_pending", confirmationCode: body.confirmationCode });
    } catch {
      this.set({ phase: "unreachable", maybeNeedsLocalNetworkAccess: this.d.isSecureNonLoopbackOrigin });
    }
  }

  /** Poll the pending pairing once. On approval it stores the token and connects. */
  async pollPairingOnce(): Promise<void> {
    if (!this.pairingRequestId) return;
    let poll: PairPollResponse;
    try {
      const res = await this.d.fetchFn(`${this.d.httpBase}/bridge/pair/poll`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: this.pairingRequestId }),
      });
      poll = (await res.json()) as PairPollResponse;
    } catch {
      this.set({ phase: "unreachable", maybeNeedsLocalNetworkAccess: this.d.isSecureNonLoopbackOrigin });
      return;
    }
    if (poll.status === "paired") {
      this.pairingRequestId = null;
      this.d.storage.setItem(TOKEN_KEY, poll.pairingToken);
      await this.connectWs(poll.pairingToken);
    } else if (poll.status === "denied") {
      this.pairingRequestId = null;
      this.set({ phase: "pairing_denied" });
    } else if (poll.status === "expired") {
      this.pairingRequestId = null;
      this.set({ phase: "unpaired" });
    }
    // "pending" → caller polls again.
  }

  /** Revoke this browser's pairing (also revocable from the agent side). */
  async revoke(): Promise<void> {
    const token = this.token();
    this.closeWs();
    if (token) {
      try {
        await this.d.fetchFn(`${this.d.httpBase}/bridge/revoke`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        });
      } catch {
        /* best-effort; local token is cleared regardless */
      }
    }
    this.clearToken();
    this.set({ phase: "unpaired", snapshot: undefined });
  }

  /** Mint a single-use ticket and open the authenticated WebSocket. */
  private async connectWs(token: string): Promise<void> {
    this.set({ phase: "connecting_ws" });
    let ticket: string;
    try {
      const res = await this.d.fetchFn(`${this.d.httpBase}/bridge/ws-ticket`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ clientProtocolVersion: this.d.clientProtocolVersion }),
      });
      if (res.status === 401) {
        this.clearToken();
        this.set({ phase: "revoked" });
        return;
      }
      const body = (await res.json()) as { ticket?: string; error?: string; agentProtocolVersion?: number };
      if (res.status === 409 || body.error === "incompatible_version") {
        this.set({ phase: "incompatible_version", agentProtocolVersion: body.agentProtocolVersion });
        return;
      }
      if (!res.ok || !body.ticket) {
        this.set({ phase: "unreachable", maybeNeedsLocalNetworkAccess: this.d.isSecureNonLoopbackOrigin });
        return;
      }
      ticket = body.ticket;
    } catch {
      this.set({ phase: "unreachable", maybeNeedsLocalNetworkAccess: this.d.isSecureNonLoopbackOrigin });
      return;
    }

    const ws = this.d.wsFactory(`${this.d.wsBase}/bridge/ws?ticket=${encodeURIComponent(ticket)}`);
    this.ws = ws;
    ws.onmessage = (ev) => this.onWsMessage(ev.data);
    ws.onclose = () => {
      if (this.ws === ws && !this.stopped) {
        this.ws = null;
        // Was paired; the socket dropped. Surface disconnected — the caller re-runs refresh() to reconnect.
        if (this.state.phase === "paired" || this.state.phase === "connecting_ws") this.set({ phase: "disconnected" });
      }
    };
    ws.onerror = () => { /* onclose follows; handled there */ };
  }

  private onWsMessage(data: string): void {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(data) as ServerMessage;
    } catch {
      return;
    }
    if (msg.type === "hello") {
      // Capability negotiation: record which event categories the agent actually emits (slice §C).
      this.set({ supportedEvents: msg.supportedEvents });
    } else if (msg.type === "snapshot") {
      this.set({ phase: "paired", snapshot: msg.snapshot, supportedEvents: msg.snapshot.supportedEvents });
    } else if (msg.type === "incompatible_version") {
      this.set({ phase: "incompatible_version", agentProtocolVersion: msg.agentProtocolVersion });
    } else if (msg.type === "event") {
      this.applyEvent(msg);
    }
  }

  private applyEvent(msg: Extract<ServerMessage, { type: "event" }>): void {
    const snap = this.state.snapshot;
    if (!snap || !msg.ref) return;
    const connections = snap.connections.map((c) => ({ ...c }));
    let conn = connections.find((c) => c.ref === msg.ref);
    if (!conn) {
      conn = { ref: msg.ref, state: "starting", pendingUserAction: null, browserOpen: false };
      connections.push(conn);
    }
    if (msg.payload.state) conn.state = msg.payload.state;
    if (msg.payload.browserOpen !== undefined) conn.browserOpen = msg.payload.browserOpen;
    if (msg.category === "pending_user_action") conn.pendingUserAction = msg.payload.pendingUserAction ?? null;
    this.set({ snapshot: { ...snap, connections } });
  }

  private closeWs(): void {
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      try { ws.close(); } catch { /* already closed */ }
    }
  }

  /** Tear down (hook unmount): stop reconnect attempts and close the socket. */
  stop(): void {
    this.stopped = true;
    this.closeWs();
  }
}

/** Production factory using the browser globals + a default fixed loopback discovery URL (slice §11). */
export function makeBridgeClient(overrides: Partial<BridgeClientDeps> = {}): BridgeClient {
  const httpBase = overrides.httpBase ?? (import.meta.env.VITE_BRIDGE_URL ?? "http://127.0.0.1:47615");
  const wsBase = overrides.wsBase ?? httpBase.replace(/^http/, "ws");
  const loopback = /^(https?:\/\/)?(127\.0\.0\.1|localhost)(:|\/|$)/.test(location.origin);
  return new BridgeClient({
    httpBase,
    wsBase,
    workspaceLabel: overrides.workspaceLabel ?? "SellerOps",
    isSecureNonLoopbackOrigin: location.protocol === "https:" && !loopback,
    ...overrides,
  });
}
