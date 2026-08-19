/**
 * **The resident helper's on-demand carrier host.**
 *
 * ## Why this exists
 *
 * The SellerOps 도우미 a seller keeps resident is `--bridge-only` (#466): pairing/health bridge, no browser, no
 * carrier. The Coupang connect screen's PRIMARY path is the guided WING issuance walk, which needs the
 * `issuance`/`coupang` carrier hosted by an agent — and until now the only agents that hosted it were the
 * flag-selected one-carrier boots (`--action-window-coupang-issuance-live`, the fixture flag), so a seller with
 * the resident helper paired got "no carrier", and #467 papered over that by dropping them into the text
 * checklist. Product intent (2026-08-19): ONE resident helper; idle = bridge only; the guided walk is primary
 * and comes up ON DEMAND; after it the helper is idle again; the seller never switches a carrier.
 *
 * ## What it does
 *
 * It occupies the bridge's single carrier slot like every other endpoint, and is one of three things:
 *
 *  - **idle** — announces nothing on connect (a tab that does not ask gets what bridge-only always gave it:
 *    a paired helper, no `aw_session`), relays nothing, holds no browser;
 *  - **activating → active** — a tab sent `{type:"aw_attach", carrier, channelCode}` and the injected
 *    `activate` knew that pair: the real carrier (endpoint + session + lazy driver) is built THEN, announced to
 *    the asking socket, and every later socket/payload is delegated to it. The browser still opens lazily, on
 *    the session's first call (`LazyCoupangIssuanceDriver`) — attaching opens no window;
 *  - **releasing → idle** — the walk is over and nobody needs the window: see {@link maybeRelease}.
 *
 * One carrier at a time (the slot is still one slot): a second, different request while one is active is
 * ignored — the asking tab times out into its own fallback, exactly as against a fixed-carrier agent of the
 * other kind. A request for the SAME carrier re-announces the live run (page refresh → resync).
 *
 * ## When it goes idle again — and when it deliberately does not
 *
 * Releasing closes the WING window. The walk ends with WING showing the secret key ONCE, and the seller then
 * copies it into SellerOps — so "the run is COMPLETED" and even "the SellerOps tab detached" are NOT the moment
 * to close that window. Release happens only when ALL of these hold: no attached tab, the run is terminal or
 * was never started, and EITHER the seller has closed the window themselves (or none was ever opened) OR the
 * window has been sitting with no tab for the long grace (`windowGraceMs`, 15 min). A walk abandoned mid-way
 * with the SellerOps tab gone is released after the same grace. Nothing here clicks, navigates, or reads a
 * value; release = `dispose()` on the active carrier, which closes a window the agent itself opened.
 */
import type { WebSocket } from "ws";
import { log } from "../log";
import type { AwAttachRequest, AwCarrierEndpoint } from "./aw-carrier";

/** A carrier the host brought up on demand. Built by the injected activator; owned by the host until release. */
export interface ActivatedCarrier {
  /** The real endpoint (announces on `onClientConnected`, relays payloads). */
  endpoint: AwCarrierEndpoint;
  /** Sanitized: is the run over (COMPLETED / CANCELLED / FAILED)? `true` also when no run was ever started. */
  isSettled(): boolean;
  /** Sanitized: is the marketplace window the carrier opened still up? `false` when never opened or closed. */
  isSurfaceOpen(): boolean;
  /** Tear everything down: close the session and the window (if any). Idempotent. */
  dispose(): Promise<void>;
}

export interface OnDemandCarrierHostDeps {
  /**
   * Build the carrier for a request, or `null` when this host cannot serve it (unknown carrier/channel). Pure
   * decision + construction only — MUST NOT open a browser (the lazy driver does that on the run's first call).
   */
  activate: (request: AwAttachRequest) => ActivatedCarrier | null;
  /** How long an idle window (no attached tab) is kept before release. Default 15 minutes. */
  windowGraceMs?: number;
  /** How often the settled/surface state is re-read while waiting to release. Default 2 s. */
  pollMs?: number;
  /** Injectable timers for tests. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  now?: () => number;
}

export class OnDemandCarrierHost implements AwCarrierEndpoint {
  private readonly deps: OnDemandCarrierHostDeps;
  private readonly windowGraceMs: number;
  private readonly pollMs: number;
  private active: { carrier: ActivatedCarrier; request: AwAttachRequest; activatedAt: number } | null = null;
  /** Every authenticated socket, so a carrier activated later can still be told about them on attach. */
  private readonly sockets = new Set<WebSocket>();
  /** The sockets that ASKED for the active carrier. Their emptiness is what "nobody needs the window" means. */
  private readonly attached = new Set<WebSocket>();
  private detachedSince: number | null = null;
  private pollHandle: unknown = null;
  private closed = false;
  private releasing: Promise<void> | null = null;

  constructor(deps: OnDemandCarrierHostDeps) {
    this.deps = deps;
    this.windowGraceMs = deps.windowGraceMs ?? 15 * 60_000;
    this.pollMs = deps.pollMs ?? 2_000;
  }

  /** Sanitized state for the boot line / tests. */
  state(): { active: boolean; carrier: string | null; channelCode: string | null; attachedClients: number } {
    return {
      active: this.active !== null,
      carrier: this.active?.request.carrier ?? null,
      channelCode: this.active?.request.channelCode ?? null,
      attachedClients: this.attached.size,
    };
  }

  onClientConnected(ws: WebSocket): void {
    this.sockets.add(ws);
    // Idle: say nothing. A tab that wants a carrier asks for it; one that does not must see bridge-only as it
    // always was (no `aw_session`). Active: the real endpoint announces its run to every socket, as a
    // fixed-carrier agent does — a refreshed tab resyncs on that.
    this.active?.carrier.endpoint.onClientConnected(ws);
  }

  onClientAttachRequest(ws: WebSocket, request: AwAttachRequest): void {
    if (this.closed) return;
    if (this.active) {
      const same = this.active.request.carrier === request.carrier && this.active.request.channelCode === request.channelCode;
      if (!same) {
        // One slot. The other world's tab gets no announcement and takes its own fallback.
        log("aw_on_demand_attach_refused", { reason: "OTHER_CARRIER_ACTIVE", carrier: request.carrier, channelCode: request.channelCode });
        return;
      }
      this.markAttached(ws);
      // Re-announce to this socket (a refresh, or a second tab of the same walk). Idempotent on the endpoint.
      this.active.carrier.endpoint.onClientConnected(ws);
      return;
    }
    let carrier: ActivatedCarrier | null = null;
    try {
      carrier = this.deps.activate(request);
    } catch {
      carrier = null;
    }
    if (!carrier) {
      log("aw_on_demand_attach_refused", { reason: "NOT_SERVABLE", carrier: request.carrier, channelCode: request.channelCode });
      return;
    }
    this.active = { carrier, request, activatedAt: (this.deps.now ?? Date.now)() };
    this.detachedSince = null;
    this.markAttached(ws);
    log("aw_on_demand_carrier_activated", { carrier: request.carrier, channelCode: request.channelCode });
    // Tell the carrier about every socket already here, then announce to them. Announcing to the status
    // sockets too is what every fixed-carrier agent does, and is what a refreshed tab relies on.
    for (const s of this.sockets) carrier.endpoint.onClientConnected(s);
    this.startPolling();
  }

  onClientPayload(ws: WebSocket, payload: string): void {
    this.active?.carrier.endpoint.onClientPayload(ws, payload);
  }

  onClientDisconnected(ws: WebSocket): void {
    this.sockets.delete(ws);
    if (this.attached.delete(ws) && this.attached.size === 0) {
      this.detachedSince = (this.deps.now ?? Date.now)();
      log("aw_on_demand_all_clients_detached", {});
    }
    this.active?.carrier.endpoint.onClientDisconnected(ws);
  }

  close(): void {
    this.closed = true;
    this.stopPolling();
    const active = this.active;
    this.active = null;
    this.attached.clear();
    this.sockets.clear();
    if (active) {
      active.carrier.endpoint.close();
      void active.carrier.dispose().catch(() => undefined);
    }
  }

  /** Resolves once the active carrier (if any) has been torn down — for shutdown, so a window is not left. */
  async disposeActive(): Promise<void> {
    const active = this.active;
    if (!active) return;
    await this.release("SHUTDOWN");
  }

  private markAttached(ws: WebSocket): void {
    this.attached.add(ws);
    this.detachedSince = null;
  }

  private startPolling(): void {
    if (this.pollHandle !== null) return;
    const set = this.deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    const tick = (): void => {
      this.pollHandle = null;
      if (!this.active || this.closed) return;
      void this.maybeRelease().finally(() => {
        if (this.active && !this.closed && this.pollHandle === null) this.pollHandle = set(tick, this.pollMs);
      });
    };
    this.pollHandle = set(tick, this.pollMs);
  }

  private stopPolling(): void {
    if (this.pollHandle === null) return;
    (this.deps.clearTimer ?? ((h) => clearTimeout(h as NodeJS.Timeout)))(this.pollHandle);
    this.pollHandle = null;
  }

  /**
   * The release decision, re-read on every poll. Visible for tests; safe to call any time.
   *
   *  - attached tab present → keep (the walk is being watched, or the seller is on the completion screen);
   *  - run still in flight (not settled) → keep, unless no tab for `windowGraceMs` (abandoned);
   *  - run settled and the window is closed / was never opened → release now;
   *  - run settled, window still open → keep for `windowGraceMs` from the last detach (the seller is copying
   *    the key), then release.
   */
  async maybeRelease(): Promise<boolean> {
    const active = this.active;
    if (!active || this.releasing) return false;
    if (this.attached.size > 0) return false;
    const now = (this.deps.now ?? Date.now)();
    const since = this.detachedSince ?? active.activatedAt;
    const idleFor = now - since;
    const settled = safe(() => active.carrier.isSettled(), true);
    const surfaceOpen = safe(() => active.carrier.isSurfaceOpen(), false);
    if (settled && !surfaceOpen) {
      await this.release("SETTLED_SURFACE_CLOSED");
      return true;
    }
    if (idleFor >= this.windowGraceMs) {
      await this.release(settled ? "SETTLED_GRACE_ELAPSED" : "ABANDONED_GRACE_ELAPSED");
      return true;
    }
    return false;
  }

  private async release(reason: string): Promise<void> {
    const active = this.active;
    if (!active) return;
    if (this.releasing) return this.releasing;
    this.releasing = (async () => {
      this.active = null;
      this.attached.clear();
      this.detachedSince = null;
      this.stopPolling();
      log("aw_on_demand_carrier_released", { reason, carrier: active.request.carrier, channelCode: active.request.channelCode });
      try {
        active.carrier.endpoint.close();
      } catch {
        /* already closed */
      }
      await active.carrier.dispose().catch(() => undefined);
    })().finally(() => {
      this.releasing = null;
    });
    return this.releasing;
  }
}

function safe<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch {
    return fallback;
  }
}
