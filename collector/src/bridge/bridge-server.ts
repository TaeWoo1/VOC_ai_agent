/**
 * **Local Agent Bridge server (loopback transport shell).** Wraps the pure pairing/event/origin security
 * core in a minimal `node:http` server that listens ONLY on loopback and speaks the bridge protocol (slice
 * §0, §5, §11). The WebSocket transport is the mature **`ws`** library (no hand-rolled RFC6455 framing):
 * `ws` handles the handshake, framing, protocol ping/pong replies, close frames, malformed clients, and
 * TCP-level disconnects, with an explicit `maxPayload` cap and compression disabled. Binary payloads are
 * rejected — G1 is JSON text only. `ws` does NOT proactively probe liveness, so a server-side heartbeat
 * (see {@link BridgeServer.beat}) pings each status socket and reaps half-open peers that vanished without
 * a close frame (laptop sleep, network drop with no FIN) — otherwise they would linger in `clients` and be
 * broadcast to forever, and `liveClientCount` would over-report.
 *
 * The security decisions stay OURS and run BEFORE `ws` ever sees the socket: loopback-only bind, explicit
 * origin allow (never wildcard), single-use ticket consume with replay protection, and an unauthenticated
 * health surface that carries no pairing/connection detail. G1 is pairing + observability only — there are
 * NO marketplace-workflow / browser-control / click / credential commands.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import { log } from "../log";
import {
  AGENT_CAPABILITIES,
  BRIDGE_PROTOCOL_VERSION,
  SUPPORTED_EVENT_CATEGORIES,
  isProtocolCompatible,
  type BridgeConnectionState,
  type BridgeConnectionView,
  type BridgeHealth,
  type BridgeSnapshot,
  type ClientMessage,
  type ServerMessage,
} from "./protocol";
import { isOriginAllowed } from "./origin-policy";
import { nullApprovalPresenter, type ApprovalPresenter } from "./approval-presenter";
import type { SweepResult } from "./pairing";
import type { FilePairingStore, PairingStorePersistResult } from "./pairing-store";
import { renderConfirmationPage } from "./confirmation-page";
import type { BridgeEventPort } from "./event-adapter";
import { PROJECTION_CLIENT_MAX_BYTES } from "./projection-protocol";
import type { ProjectionEndpoint } from "./projection-endpoint";
import type { ActionWindowEndpoint } from "./action-window-endpoint";

const LOOPBACK = "127.0.0.1";
const MAX_BODY_BYTES = 16 * 1024;
/** Cap a single WS message. G1 messages are tiny JSON control frames; `ws` closes 1009 on excess. */
const MAX_MESSAGE_BYTES = 64 * 1024;
/** How often the server polls projection control-lease expiry (slice §D). */
const PROJECTION_TICK_MS = 5 * 1000;
/**
 * How often the server pings each G1 status socket to detect half-open (dead) peers. A socket that misses
 * the pong for one full interval is reaped on the next beat, so a vanished peer clears within ≤2 intervals.
 */
const HEARTBEAT_MS = 30 * 1000;

export interface BridgeServerDeps {
  store: FilePairingStore;
  allowedOrigins: string[];
  agentVersion: string;
  host?: string;
  port: number;
  /**
   * DEV/TEST ONLY pairing relaxation (slice §0.4): auto-approve pairing requests so no human local
   * confirmation click is needed. The CLI refuses to set this in production. Loudly logged when active.
   */
  autoApprovePairing?: boolean;
  /**
   * G1 status-socket liveness probe interval (ms). Each interval the server pings every `/bridge/ws` client
   * and terminates any that did not answer the previous ping — reaping half-open sockets (a peer that
   * vanished with no close frame) so `clients`/`liveClientCount` stay honest. Injectable for deterministic
   * tests; defaults to {@link HEARTBEAT_MS}. A non-positive value disables the heartbeat.
   */
  heartbeatMs?: number;
  /**
   * The human channel for the out-of-band pairing approval secret (see `./approval-presenter`). Defaults to
   * {@link nullApprovalPresenter} — always unavailable — so an agent whose presenter was never wired FAILS
   * CLOSED (`503 approval_unavailable`) in EVERY environment rather than falling back to an unauthenticated
   * confirm that any local process could forge. There is no environment in which a missing human channel
   * silently degrades: the only bypass is {@link autoApprovePairing}, which must be injected explicitly and
   * is refused under `NODE_ENV=production` by `cli/bridge.ts`.
   */
  approvalPresenter?: ApprovalPresenter;
  /**
   * Optional Browser Projection V0 endpoint (slice §B). When present, the server mounts a SEPARATE projection
   * transport (`POST /projection/ticket`, `/projection/ws` binary) alongside — and independent of — the G1
   * status channel, which keeps its JSON/text/64 KiB boundary untouched.
   */
  projection?: ProjectionEndpoint;
  /**
   * Optional Action Window passthrough endpoint (R2B). When present, `{type:"aw"}` carrier messages on
   * the EXISTING authenticated `/bridge/ws` socket are relayed to it opaquely (payloads are never
   * inspected here), and each accepted socket receives its `aw_session` announcement. This is additive:
   * the typed G1 `ClientMessage`/`ServerMessage` unions and their handling are unchanged.
   */
  actionWindow?: ActionWindowEndpoint;
}

export class BridgeServer {
  private readonly http: Server;
  private readonly wss: WebSocketServer;
  private readonly store: FilePairingStore;
  private readonly allowedOrigins: string[];
  private readonly agentVersion: string;
  private readonly host: string;
  private readonly wantPort: number;
  private readonly autoApprovePairing: boolean;
  private readonly approvalPresenter: ApprovalPresenter;
  private readonly heartbeatMs: number;
  private readonly projection: ProjectionEndpoint | undefined;
  private readonly actionWindow: ActionWindowEndpoint | undefined;
  private readonly projectionWss: WebSocketServer | undefined;
  private projectionTimer: NodeJS.Timeout | undefined;
  private heartbeatTimer: NodeJS.Timeout | undefined;
  private boundPort = 0;
  private readonly clients = new Map<WebSocket, string>(); // ws → pairingId
  /** Per-socket liveness for the heartbeat: `true` once the last ping was answered, `false` while awaiting one. */
  private readonly alive = new WeakMap<WebSocket, boolean>();
  private readonly connections = new Map<string, BridgeConnectionView>();

  constructor(deps: BridgeServerDeps) {
    this.store = deps.store;
    this.allowedOrigins = deps.allowedOrigins;
    this.agentVersion = deps.agentVersion;
    this.host = deps.host ?? LOOPBACK;
    this.wantPort = deps.port;
    this.autoApprovePairing = deps.autoApprovePairing ?? false;
    this.approvalPresenter = deps.approvalPresenter ?? nullApprovalPresenter;
    this.heartbeatMs = deps.heartbeatMs ?? HEARTBEAT_MS;
    this.projection = deps.projection;
    this.actionWindow = deps.actionWindow;
    if (this.autoApprovePairing) log("bridge_dev_auto_approve_active", { warning: true });
    this.http = createServer((req, res) => void this.onRequest(req, res));
    // We validate origin + ticket ourselves, THEN hand the raw socket to `ws`. `noServer` = we own upgrade.
    this.wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES, perMessageDeflate: false });
    // Projection uses its OWN WS server: a small received-payload cap (client sends only tiny control JSON);
    // server→client image frames are binary and not bounded by maxPayload. Separate from the G1 status WSS.
    this.projectionWss = this.projection
      ? new WebSocketServer({ noServer: true, maxPayload: PROJECTION_CLIENT_MAX_BYTES, perMessageDeflate: false })
      : undefined;
    this.http.on("upgrade", (req, socket, head) => this.onUpgrade(req, socket as Socket, head));
  }

  /** Start listening on loopback. Rejects on EADDRINUSE (a duplicate agent is already bound — §10). */
  listen(): Promise<{ port: number }> {
    return new Promise((resolve, reject) => {
      const onError = (err: NodeJS.ErrnoException): void => {
        this.http.off("listening", onListening);
        reject(err);
      };
      const onListening = (): void => {
        this.http.off("error", onError);
        const addr = this.http.address();
        this.boundPort = typeof addr === "object" && addr ? addr.port : this.wantPort;
        if (this.projection) {
          this.projectionTimer = setInterval(() => this.projection?.tick(), PROJECTION_TICK_MS);
          this.projectionTimer.unref?.();
        }
        if (this.heartbeatMs > 0) {
          this.heartbeatTimer = setInterval(() => this.beat(), this.heartbeatMs);
          this.heartbeatTimer.unref?.();
        }
        log("bridge_listen", { port: this.boundPort, host: this.host });
        resolve({ port: this.boundPort });
      };
      this.http.once("error", onError);
      this.http.once("listening", onListening);
      this.http.listen(this.wantPort, this.host);
    });
  }

  async close(): Promise<void> {
    if (this.projectionTimer) { clearInterval(this.projectionTimer); this.projectionTimer = undefined; }
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = undefined; }
    if (this.projection) { try { await this.projection.close(); } catch { /* best effort */ } }
    this.actionWindow?.close();
    for (const ws of this.clients.keys()) {
      try { ws.terminate(); } catch { /* already gone */ }
    }
    this.clients.clear();
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
    if (this.projectionWss) await new Promise<void>((resolve) => this.projectionWss!.close(() => resolve()));
    await new Promise<void>((resolve) => this.http.close(() => resolve()));
  }

  address(): { port: number } {
    return { port: this.boundPort };
  }

  /** Seed the configured connections (real connection refs) so the snapshot is populated before settle. */
  seedConnections(refs: readonly string[]): void {
    for (const ref of refs) {
      if (!this.connections.has(ref)) {
        this.connections.set(ref, { ref, state: "starting", pendingUserAction: null, browserOpen: false });
      }
    }
  }

  private selfOrigins(): string[] {
    return [`http://127.0.0.1:${this.boundPort}`, `http://localhost:${this.boundPort}`];
  }

  /**
   * Make the registry's bounded timeout-eviction observable. The pure core sweeps stale pairing requests and
   * expired tickets opportunistically but returns only coarse COUNTS; we log them (never the evicted ids or any
   * secret) so an operator can see that requests/tickets are ageing out. Silent when nothing was evicted.
   */
  private logSweep(swept: SweepResult, trigger: "pair_request" | "ws_ticket"): void {
    if (swept.requestsEvicted > 0 || swept.ticketsEvicted > 0) {
      log("bridge_pairing_swept", { trigger, requestsEvicted: swept.requestsEvicted, ticketsEvicted: swept.ticketsEvicted });
    }
  }

  /**
   * Persist the durable pairings and make a NON-durable write observable. The store never throws — it returns
   * a sanitized result — so this only forwards the outcome and logs a `bridge_persist_failed` diagnostic (a
   * coarse `context` + failure category, never a pairingId/path/secret) when the pairing change did not reach
   * disk. Each caller then decides how to keep memory and disk consistent (roll back a non-durable confirm;
   * honor a revoke in-session but report it non-durable).
   */
  private persistPairings(context: "confirm" | "revoke" | "auto_approve"): PairingStorePersistResult {
    const result = this.store.persist();
    if (result.status === "failed") log("bridge_persist_failed", { context, reason: result.reason });
    return result;
  }

  // ---- HTTP -----------------------------------------------------------------

  private async onRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://${LOOPBACK}`);
    const path = url.pathname;
    const method = req.method ?? "GET";

    // The SellerOps frontend origin differs from this loopback agent, so cross-origin fetches need CORS.
    // Echo ONLY an explicitly-allowed origin (never a wildcard). WS handshakes are checked separately.
    const origin = header(req, "origin");
    const originAllowed = !!origin && isOriginAllowed(origin, this.allowedOrigins);
    if (originAllowed) {
      res.setHeader("Access-Control-Allow-Origin", origin!);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    }
    if (method === "OPTIONS") {
      if (originAllowed && header(req, "access-control-request-private-network")) {
        res.setHeader("Access-Control-Allow-Private-Network", "true");
      }
      res.writeHead(originAllowed ? 204 : 403);
      res.end();
      return;
    }

    try {
      if (method === "GET" && path === "/bridge/health") return this.handleHealth(req, res);
      if (method === "POST" && path === "/bridge/pair/request") return await this.handlePairRequest(req, res);
      if (method === "GET" && path === "/bridge/confirm") return this.handleConfirmPage(url, res);
      if (method === "POST" && path === "/bridge/pair/confirm") return await this.handleConfirm(req, res);
      if (method === "POST" && path === "/bridge/pair/poll") return await this.handlePoll(req, res);
      if (method === "POST" && path === "/bridge/ws-ticket") return await this.handleWsTicket(req, res);
      if (method === "POST" && path === "/projection/ticket") return await this.handleProjectionTicket(req, res);
      if (method === "POST" && path === "/bridge/revoke") return await this.handleRevoke(req, res);
      if (method === "POST" && path === "/bridge/agent/revoke") return await this.handleAgentRevoke(req, res);
      sendJson(res, 404, { error: "not_found" });
    } catch {
      sendJson(res, 500, { error: "internal" });
    }
  }

  private handleHealth(req: IncomingMessage, res: ServerResponse): void {
    // MINIMUM presence + protocol only — no pairing state, no account/connection/marketplace/personal data
    // (slice §E). A disallowed browser Origin is rejected; curl (no Origin) is fine.
    const origin = header(req, "origin");
    if (origin && !isOriginAllowed(origin, this.allowedOrigins)) {
      sendJson(res, 403, { error: "bad_origin" });
      return;
    }
    const body: BridgeHealth = {
      ok: true,
      service: "sellerops-local-agent",
      agentVersion: this.agentVersion,
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
    };
    sendJson(res, 200, body);
  }

  private async handlePairRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const origin = header(req, "origin");
    if (!isOriginAllowed(origin, this.allowedOrigins)) {
      sendJson(res, 403, { error: "bad_origin" });
      return;
    }
    const body = await readJson(req);
    const workspaceLabel = typeof body?.workspaceLabel === "string" ? body.workspaceLabel.slice(0, 80) : "SellerOps";

    const confirmUrlFor = (id: string): string => `http://127.0.0.1:${this.boundPort}/bridge/confirm?requestId=${id}`;

    if (this.autoApprovePairing) {
      // DEV/TEST relaxation only — skip the human local confirmation click (never enabled in production;
      // `cli/bridge.ts` refuses the flag there). This and the human approval channel are mutually exclusive
      // by definition: auto-approve means no human is involved, so no presenter is consulted and no approval
      // secret is minted. It must be injected EXPLICITLY — it is never a fallback for a missing presenter.
      // Same persist-then-commit discipline as the human confirm path: a pairing that did not reach disk is
      // fully undone so poll never hands out an inert token for a pairing that was never stored.
      const { requestId, confirmationCode, swept } = this.store.registry.requestPairing(origin!, workspaceLabel);
      this.logSweep(swept, "pair_request");
      const r = this.store.registry.confirmPairing(requestId, "allow");
      if (r.ok && this.persistPairings("auto_approve").status === "failed") {
        this.store.registry.undoConfirm(requestId);
      }
      log("bridge_pair_requested", { requestId, autoApproved: true });
      sendJson(res, 200, { requestId, confirmationCode, confirmUrl: confirmUrlFor(requestId) });
      return;
    }

    // FAIL-CLOSED, in EVERY environment: ask BEFORE minting. A presenter that cannot reach a human means the
    // human could never learn the code, so pairing refuses rather than minting a secret that goes nowhere —
    // there is no un-gated confirm to degrade to. Nothing is minted here: no requestId, no code, no entry.
    if (!this.approvalPresenter.available()) {
      log("bridge_pair_refused", { reason: "approval_unavailable" });
      sendJson(res, 503, { error: "approval_unavailable" });
      return;
    }
    const minted = this.store.registry.requestPairing(origin!, workspaceLabel, { requireApproval: true });
    this.logSweep(minted.swept, "pair_request");
    // Awaited: a native presenter drives an OS dialog asynchronously so the agent's event loop keeps serving
    // every other socket while the human reads the code.
    const shown = await this.approvalPresenter.present({
      requestId: minted.requestId,
      origin: origin!,
      workspaceLabel,
      approvalCode: minted.approvalCode!,
    });
    if (shown.status === "declined") {
      // A human was reached and REFUSED. Discard immediately — an actively-refused request must not linger
      // until its TTL. Reported distinctly from `approval_unavailable` (no channel) so the frontend can say
      // "거부됨" rather than "연결할 수 없음". This tells the caller only that a human said no — nothing it
      // did not already learn from not being paired.
      this.store.registry.discardRequest(minted.requestId);
      log("bridge_pair_refused", { reason: "declined" });
      sendJson(res, 403, { error: "approval_declined" });
      return;
    }
    if (shown.status !== "presented") {
      // The human never saw the code — roll the request back so it can never be confirmed, and refuse.
      this.store.registry.discardRequest(minted.requestId);
      log("bridge_pair_refused", { reason: shown.reason });
      sendJson(res, 503, { error: "approval_unavailable" });
      return;
    }
    log("bridge_pair_requested", { requestId: minted.requestId, approvalGated: true });
    // NOTE: `approvalCode` is deliberately absent from this response — that is the whole point of the slice.
    sendJson(res, 200, {
      requestId: minted.requestId,
      confirmationCode: minted.confirmationCode,
      confirmUrl: confirmUrlFor(minted.requestId),
    });
  }

  private handleConfirmPage(url: URL, res: ServerResponse): void {
    const requestId = url.searchParams.get("requestId") ?? "";
    const view = this.store.registry.getRequestView(requestId);
    if (!view) {
      res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<!doctype html><meta charset=utf-8><p>만료되었거나 알 수 없는 연결 요청입니다.</p>");
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(renderConfirmationPage({
      requestId,
      origin: view.origin,
      workspaceLabel: view.workspaceLabel,
      confirmationCode: view.confirmationCode,
      approvalRequired: view.approvalRequired,
    }));
  }

  private async handleConfirm(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Defence in depth ONLY: this Origin check is trivially spoofable by a non-browser local caller (and an
    // absent Origin passes), so it is NOT what secures this endpoint. The out-of-band `approvalCode` below is.
    const origin = header(req, "origin");
    if (origin && !this.selfOrigins().includes(origin)) {
      sendJson(res, 403, { error: "bad_origin" });
      return;
    }
    const body = await readJson(req);
    const requestId = typeof body?.requestId === "string" ? body.requestId : "";
    const decision = body?.decision === "allow" ? "allow" : "deny";
    // The human retypes this off the agent's console. A caller confined to the HTTP surface cannot read it.
    const approvalCode = typeof body?.approvalCode === "string" ? body.approvalCode : "";
    const result = this.store.registry.confirmPairing(requestId, decision, approvalCode);
    if (result.ok && decision === "allow") {
      if (this.persistPairings("confirm").status === "failed") {
        // Persist-then-commit: the pairing takes effect ONLY when durable. Fully undo the confirm — delete the
        // minted pairing, discard the undelivered token, and return the request to `pending` — so a follow-up
        // poll reports `pending` and NEVER surrenders an inert token for a pairing that was never stored. The
        // human may retry the confirmation. Report the write as non-durable, not a 200.
        this.store.registry.undoConfirm(requestId);
        log("bridge_pair_confirmed", { ok: false, allowed: true, durable: false });
        sendJson(res, 500, { ok: false, error: "persist_failed" });
        return;
      }
    }
    log("bridge_pair_confirmed", { ok: result.ok, allowed: decision === "allow" });
    sendJson(res, result.ok ? 200 : 409, { ok: result.ok });
  }

  private async handlePoll(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const origin = header(req, "origin");
    if (!isOriginAllowed(origin, this.allowedOrigins)) {
      sendJson(res, 403, { error: "bad_origin" });
      return;
    }
    const body = await readJson(req);
    const requestId = typeof body?.requestId === "string" ? body.requestId : "";
    sendJson(res, 200, this.store.registry.pollPairing(requestId));
  }

  private async handleWsTicket(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const origin = header(req, "origin");
    if (!isOriginAllowed(origin, this.allowedOrigins)) {
      sendJson(res, 403, { error: "bad_origin" });
      return;
    }
    const token = bearer(req);
    const body = await readJson(req);
    const clientVersion = typeof body?.clientProtocolVersion === "number" ? body.clientProtocolVersion : -1;
    if (!token) {
      sendJson(res, 401, { error: "unpaired" });
      return;
    }
    const pairing = this.store.registry.authenticate(token);
    if (!pairing) {
      sendJson(res, 401, { error: "unpaired" });
      return;
    }
    if (!isProtocolCompatible(clientVersion, BRIDGE_PROTOCOL_VERSION)) {
      sendJson(res, 409, { error: "incompatible_version", agentProtocolVersion: BRIDGE_PROTOCOL_VERSION });
      return;
    }
    const { ticket, expiresInMs, swept } = this.store.registry.mintTicket(pairing.pairingId);
    this.logSweep(swept, "ws_ticket");
    // NEVER log the ticket or token — only the opaque pairingId.
    log("bridge_ticket_minted", { pairingId: pairing.pairingId });
    sendJson(res, 200, { ticket, expiresInMs });
  }

  /**
   * Mint a SEPARATE single-use projection connection ticket from the long-term pairing (slice §0.5, §10):
   * device pairing is the trust root; projection uses its own short-lived ticket — the bearer is never
   * elevated to browser control. Only the paired origin + a valid pairing token may request one.
   */
  private async handleProjectionTicket(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.projection) { sendJson(res, 404, { error: "not_found" }); return; }
    const origin = header(req, "origin");
    if (!isOriginAllowed(origin, this.allowedOrigins)) { sendJson(res, 403, { error: "bad_origin" }); return; }
    const token = bearer(req);
    const body = await readJson(req);
    const clientVersion = typeof body?.clientProjectionVersion === "number" ? body.clientProjectionVersion : -1;
    if (!token) { sendJson(res, 401, { error: "unpaired" }); return; }
    const pairing = this.store.registry.authenticate(token);
    if (!pairing) { sendJson(res, 401, { error: "unpaired" }); return; }
    if (!this.projection.compatible(clientVersion)) {
      sendJson(res, 409, { error: "incompatible_version", agentProjectionVersion: 1 });
      return;
    }
    const { ticket, expiresInMs } = this.projection.mintTicket(pairing.pairingId);
    log("projection_ticket_minted", { pairingId: pairing.pairingId });
    sendJson(res, 200, { ticket, expiresInMs });
  }

  private async handleRevoke(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const origin = header(req, "origin");
    if (!isOriginAllowed(origin, this.allowedOrigins)) {
      sendJson(res, 403, { error: "bad_origin" });
      return;
    }
    const token = bearer(req);
    const pairing = token ? this.store.registry.authenticate(token) : null;
    const result = pairing ? this.store.registry.revoke(pairing.pairingId) : { ok: false };
    if (result.ok && pairing) {
      if (this.persistPairings("revoke").status === "failed") {
        // Persist-then-commit: the revoke takes effect ONLY when durable. Roll it back — un-revoke the pairing
        // — so the credential stays valid and a retry re-attempts the durable write with the SAME token rather
        // than a now-dead one; memory and disk stay consistent, so a restart cannot resurrect a revoke that was
        // reported successful. No sockets are dropped (nothing was revoked).
        this.store.registry.restoreRevoked(pairing.pairingId);
        log("bridge_revoked", { ok: false, initiator: "frontend", durable: false });
        sendJson(res, 500, { ok: false, error: "persist_failed" });
        return;
      }
      // Durably revoked — NOW enforce the user's revocation on live sockets + projection sessions.
      this.dropSocketsWithoutValidPairing();
      if (this.projection) void this.projection.revokePairing(pairing.pairingId);
    }
    log("bridge_revoked", { ok: result.ok, initiator: "frontend" });
    sendJson(res, result.ok ? 200 : 404, { ok: result.ok });
  }

  private async handleAgentRevoke(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Agent-side revoke: callable only from the agent's own loopback surface (self-origin or no browser origin).
    const origin = header(req, "origin");
    if (origin && !this.selfOrigins().includes(origin)) {
      sendJson(res, 403, { error: "bad_origin" });
      return;
    }
    const body = await readJson(req);
    const pairingId = typeof body?.pairingId === "string" ? body.pairingId : "";
    const result = this.store.registry.revoke(pairingId);
    if (result.ok) {
      if (this.persistPairings("revoke").status === "failed") {
        // Same persist-then-commit rollback as the frontend revoke: un-revoke on a failed write so the revoke
        // takes effect only when durable, memory stays consistent with disk (no restart resurrection), and a
        // retry does not depend on a now-revoked credential. No sockets are dropped (nothing was revoked).
        this.store.registry.restoreRevoked(pairingId);
        log("bridge_revoked", { ok: false, initiator: "agent", durable: false });
        sendJson(res, 500, { ok: false, error: "persist_failed" });
        return;
      }
      this.dropSocketsWithoutValidPairing();
      if (this.projection) void this.projection.revokePairing(pairingId);
    }
    log("bridge_revoked", { ok: result.ok, initiator: "agent" });
    sendJson(res, result.ok ? 200 : 404, { ok: result.ok });
  }

  // ---- WebSocket (via `ws`) -------------------------------------------------

  private onUpgrade(req: IncomingMessage, socket: Socket, head: Buffer): void {
    // `reason` is the client-facing HTTP status text (a stable `BridgeErrorCode`); the optional `detail` is a
    // sanitized enum that stays in the LOG only — it distinguishes a benign timeout (`expired`) from a replay
    // (`used`) or a forged ticket (`not_found`) without changing the wire response or exposing the ticket.
    const reject = (code: number, reason: string, detail?: string): void => {
      log("bridge_ws_rejected", { reason, ...(detail ? { detail } : {}) });
      socket.write(`HTTP/1.1 ${code} ${reason}\r\nConnection: close\r\n\r\n`);
      socket.destroy();
    };
    const url = new URL(req.url ?? "/", `http://${LOOPBACK}`);
    const origin = header(req, "origin");

    if (url.pathname === "/projection/ws") {
      if (!this.projection || !this.projectionWss) return reject(404, "not_found");
      // Same origin discipline as G1, but a SEPARATE single-use projection ticket + a re-check that the
      // pairing is still valid (revocation invalidates projection sessions — slice §10).
      if (!isOriginAllowed(origin, this.allowedOrigins)) return reject(403, "bad_origin");
      const ticket = url.searchParams.get("ticket") ?? "";
      const consumed = this.projection.consumeTicket(ticket);
      if (!consumed.ok) return reject(401, "bad_ticket");
      const stillValid = this.store.registry.listPairings().some((p) => p.pairingId === consumed.pairingId && !p.revoked);
      if (!stillValid) return reject(401, "bad_ticket");
      const projection = this.projection;
      this.projectionWss.handleUpgrade(req, socket, head, (ws) => projection.onViewerConnected(ws, consumed.pairingId));
      return;
    }

    if (url.pathname !== "/bridge/ws") return reject(404, "not_found");

    // Our security checks run BEFORE `ws` upgrades the socket.
    if (!isOriginAllowed(origin, this.allowedOrigins)) return reject(403, "bad_origin");

    const ticket = url.searchParams.get("ticket") ?? "";
    const consumed = this.store.registry.consumeTicket(ticket);
    // Surface the granular rejection reason the pure core already computed (`used`/`expired`/`not_found`)
    // instead of flattening every failure to an opaque `bad_ticket`. The wire response stays `bad_ticket`.
    if (!consumed.ok) return reject(401, "bad_ticket", consumed.reason);

    this.wss.handleUpgrade(req, socket, head, (ws) => this.onWsConnection(ws, consumed.pairingId));
  }

  private onWsConnection(ws: WebSocket, pairingId: string): void {
    this.clients.set(ws, pairingId);
    this.alive.set(ws, true);
    log("bridge_ws_accepted", { pairingId });

    // Heartbeat liveness: `ws` answers our ping automatically, so any live peer flips back to alive here.
    // A half-open peer never pongs, so `beat()` reaps it on the next interval.
    ws.on("pong", () => this.alive.set(ws, true));
    ws.on("message", (data: RawData, isBinary: boolean) => {
      if (isBinary) {
        // G1 is JSON text only — a binary payload is unsupported.
        ws.close(1003, "binary_unsupported");
        return;
      }
      let msg: Record<string, unknown> | null = null;
      try {
        const parsed: unknown = JSON.parse(data.toString());
        msg = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
      } catch { msg = null; }
      if (msg?.type === "aw") {
        // Action Window passthrough (R2B): relay the OPAQUE payload string to the endpoint without
        // inspecting it. Only reachable on an authenticated socket; ignored when no endpoint is mounted
        // (exactly how unknown client message types were already ignored).
        if (this.actionWindow && typeof msg.payload === "string") this.actionWindow.onClientPayload(ws, msg.payload);
        return;
      }
      const typed = msg as ClientMessage | null;
      if (typed?.type === "request_snapshot") this.sendTo(ws, { type: "snapshot", snapshot: this.snapshot() });
      // {type:"ping"} app-level heartbeat needs no reply beyond keeping the socket alive; `ws` handles
      // protocol-level ping/pong automatically.
    });
    ws.on("close", () => { this.clients.delete(ws); this.actionWindow?.onClientDisconnected(ws); });
    ws.on("error", () => { this.clients.delete(ws); this.actionWindow?.onClientDisconnected(ws); try { ws.terminate(); } catch { /* gone */ } });

    // Immediately negotiate + send the current snapshot so a (re)connecting tab restores state.
    this.sendTo(ws, {
      type: "hello",
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
      agentVersion: this.agentVersion,
      capabilities: AGENT_CAPABILITIES,
      supportedEvents: SUPPORTED_EVENT_CATEGORIES,
    });
    this.sendTo(ws, { type: "snapshot", snapshot: this.snapshot() });
    // Announce the hosted Action Window run (if any) AFTER the standard hello+snapshot negotiation.
    this.actionWindow?.onClientConnected(ws);
  }

  private dropSocketsWithoutValidPairing(): void {
    for (const [ws, pairingId] of this.clients) {
      const stillValid = this.store.registry.listPairings().some((p) => p.pairingId === pairingId && !p.revoked);
      if (!stillValid) ws.close(1000, "revoked");
    }
  }

  /**
   * One heartbeat sweep of the G1 status sockets. A socket that did NOT answer the previous ping (still
   * `alive === false`) is a dead half-open peer and is terminated — its `close` handler prunes `clients`.
   * Every survivor is marked awaiting-pong and pinged; a real peer's automatic pong flips it back to alive
   * before the next beat, so only a vanished peer (no close frame) is ever reaped.
   */
  private beat(): void {
    for (const ws of this.clients.keys()) {
      if (this.alive.get(ws) === false) {
        try { ws.terminate(); } catch { /* already gone; close handler prunes */ }
        continue;
      }
      this.alive.set(ws, false);
      try { ws.ping(); } catch { /* send failed on a dying socket — reaped next beat */ }
    }
  }

  /** Number of currently-connected G1 status sockets (post-reap). Lifecycle-visibility surface for tests/ops. */
  liveClientCount(): number {
    return this.clients.size;
  }

  private sendTo(ws: WebSocket, msg: ServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  private broadcast(msg: ServerMessage): void {
    const text = JSON.stringify(msg);
    for (const ws of this.clients.keys()) {
      if (ws.readyState === WebSocket.OPEN) ws.send(text);
    }
  }

  private snapshot(): BridgeSnapshot {
    return {
      agentVersion: this.agentVersion,
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
      capabilities: AGENT_CAPABILITIES,
      supportedEvents: SUPPORTED_EVENT_CATEGORIES,
      connections: [...this.connections.values()],
    };
  }

  private upsert(ref: string, mutate: (v: BridgeConnectionView) => void): BridgeConnectionView {
    const existing = this.connections.get(ref) ?? { ref, state: "starting", pendingUserAction: null, browserOpen: false };
    mutate(existing);
    this.connections.set(ref, existing);
    return existing;
  }

  /** The transport-neutral event port the runtime/observer calls at execution time (slice §8/§11). */
  readonly events: BridgeEventPort = {
    connectionState: (ref, state) => {
      this.upsert(ref, (v) => { v.state = state; });
      this.broadcast({ type: "event", category: "connection_lifecycle", ref, payload: { state } });
    },
    browserOpen: (ref, open) => {
      this.upsert(ref, (v) => { v.browserOpen = open; });
      this.broadcast({ type: "event", category: "browser_lifecycle", ref, payload: { browserOpen: open } });
    },
    pendingUserAction: (ref, action) => {
      this.upsert(ref, (v) => { v.pendingUserAction = action; });
      this.broadcast({ type: "event", category: "pending_user_action", ref, payload: action ? { pendingUserAction: action } : {} });
    },
    collectionProgress: (ref, progress) => {
      this.broadcast({ type: "event", category: "collection_progress", ref, payload: { progress } });
    },
    collectionResult: (ref, result) => {
      this.broadcast({ type: "event", category: "collection_result", ref, payload: { result } });
    },
    recoverableFailure: (ref, reasonCode) => {
      this.broadcast({ type: "event", category: "recoverable_failure", ref, payload: { failure: "recoverable", ...(reasonCode ? { reasonCode } : {}) } });
    },
    terminalFailure: (ref, reasonCode) => {
      this.broadcast({ type: "event", category: "terminal_failure", ref, payload: { failure: "terminal", ...(reasonCode ? { reasonCode } : {}) } });
    },
    agentLifecycle: (state) => {
      this.broadcast({ type: "event", category: "agent_lifecycle", ref: null, payload: { reasonCode: state } });
    },
  };
}

// ---- small HTTP helpers -----------------------------------------------------

function header(req: IncomingMessage, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

function bearer(req: IncomingMessage): string | undefined {
  const auth = header(req, "authorization");
  if (!auth) return undefined;
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  return m ? m[1] : undefined;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(text);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    total += (chunk as Buffer).length;
    if (total > MAX_BODY_BYTES) return null;
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// `BridgeConnectionState` re-exported for callers seeding real connection state.
export type { BridgeConnectionState };
