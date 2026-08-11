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

/**
 * localStorage key holding the long-lived pairing token. Exported (read-only reuse) so the Action
 * Window WS transport authenticates through the SAME pairing this client established — it never runs
 * its own pairing flow.
 */
export const BRIDGE_TOKEN_KEY = "sellerops_bridge_token";
const TOKEN_KEY = BRIDGE_TOKEN_KEY;

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
  /**
   * The agent-owned approval page for the PENDING request. The seller has to reach this page to allow the
   * pairing, and until now nothing handed it to them — the URL was in the agent's response and went nowhere,
   * so the only way to find it was to read it out of a developer console. Loopback-validated (see
   * `sameOriginConfirmUrl`); absent when the agent did not return a usable one.
   */
  confirmUrl?: string;
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
  /**
   * Open the agent's approval page. Injected so tests never pop a window, and so the production default stays
   * one line: a new tab with no opener handle back to SellerOps.
   */
  openConfirmation?: (url: string) => void;
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
      openConfirmation: deps.openConfirmation ?? ((url) => void window.open(url, "_blank", "noopener,noreferrer")),
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
    // Reset the LNA hint on entry: it is set only on a proven-unreachable transition below, so it must not
    // linger from a prior `unreachable` into a recovery where health has since succeeded (the panel keeps the
    // `connecting`/`connecting_ws` phases in its searching branch, and a stale-true flag would tell a seller to
    // allow a permission that is provably not the blocker).
    this.set({ phase: "connecting", maybeNeedsLocalNetworkAccess: false });
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

  /**
   * Accept the agent's approval-page URL only when it is the SAME loopback service this client is talking to.
   *
   * The URL arrives in a response body, and a response body is not a trustworthy place to take navigation
   * from: a compromised or impersonating local listener could answer with any address and the product would
   * open it, wearing SellerOps's own "허용을 눌러 주세요" instruction. Pinning it to `httpBase` means the page
   * we send the seller to is the page the pairing they are approving actually belongs to.
   */
  private sameOriginConfirmUrl(raw: unknown): string | undefined {
    if (typeof raw !== "string" || raw === "") return undefined;
    return raw.startsWith(`${this.d.httpBase}/bridge/confirm?`) ? raw : undefined;
  }

  /** Begin a pairing request, then open the agent-owned approval page the seller confirms on. */
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
      const body = (await res.json()) as { requestId: string; confirmationCode: string; confirmUrl?: string };
      this.pairingRequestId = body.requestId;
      const confirmUrl = this.sameOriginConfirmUrl(body.confirmUrl);
      this.set({ phase: "pairing_pending", confirmationCode: body.confirmationCode, confirmUrl });
      // Opened from inside the seller's own click on 연결, so the browser treats it as a user gesture rather
      // than a pop-up. It can still be blocked, which is why the panel keeps the URL as a visible affordance
      // instead of relying on this call having worked.
      if (confirmUrl) this.d.openConfirmation(confirmUrl);
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
    // A settled request's approval page is DEAD — reopening it renders "만료되었거나 알 수 없는 연결 요청입니다".
    // So the URL is dropped on every terminal outcome, not just the happy one; a lingering affordance would
    // send the seller to an error page and read as the pairing having broken.
    if (poll.status === "paired") {
      this.pairingRequestId = null;
      this.set({ confirmUrl: undefined });
      this.d.storage.setItem(TOKEN_KEY, poll.pairingToken);
      await this.connectWs(poll.pairingToken);
    } else if (poll.status === "denied") {
      this.pairingRequestId = null;
      this.set({ phase: "pairing_denied", confirmUrl: undefined });
    } else if (poll.status === "expired") {
      this.pairingRequestId = null;
      this.set({ phase: "unpaired", confirmUrl: undefined });
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
    this.set({ phase: "connecting_ws", maybeNeedsLocalNetworkAccess: false });
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
