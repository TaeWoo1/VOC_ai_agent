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
 * One carrier at a time (the slot is still one slot). A request for the SAME carrier re-announces the live run
 * (page refresh → resync). A DIFFERENT request while one is active is answered one of two ways:
 *
 *  - **handed over** when NO tab is attached to the active carrier — nobody is on that screen, so the slot
 *    moves with the seller. The old carrier is released (window closed) before the new one is built, so two
 *    carriers never hold a browser at once;
 *  - **refused** while a tab IS attached. A tab on the screen is the only evidence a human is mid-walk, and
 *    it is the evidence this uses. The asking tab times out into its own fallback, exactly as against a
 *    fixed-carrier agent of the other kind. That is the one-slot guarantee and it does not move.
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
 *
 * **…and what the grace is NOT.** It keeps a finished walk's window up in case the seller comes back to it. It
 * was never meant to make the helper unavailable to a DIFFERENT screen meanwhile — see the handover in
 * `onClientAttachRequest`, which is the same two readings this rule waits out, applied when somebody else
 * actually wants the slot.
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
      if (same) {
        this.markAttached(ws);
        // Re-announce to this socket (a refresh, or a second tab of the same walk). Idempotent on the endpoint.
        this.active.carrier.endpoint.onClientConnected(ws);
        return;
      }
      /**
       * **A DIFFERENT carrier, and the active one is finished and unwatched — hand the slot over.**
       *
       * The slot is still ONE slot; what changes is who has to wait. Before this, a different request
       * was refused outright, and the seller's screen said "SellerOps 도우미가 지금 다른 작업을 하고
       * 있어…" for as long as the window grace lasted — **fifteen minutes** on the product default.
       * Live on 2026-08-20: a seller who started the Coupang renewal walk, left it, and then pressed
       * `[쿠팡에서 보기]` on 리뷰 was told the helper was busy, by a walk they had already abandoned.
       *
       * The reason it lasted that long is the grace, and the grace is right: the guided walks end with
       * WING showing the secret key ONCE, so a settled walk whose window is still open is deliberately
       * NOT released — the seller is copying that key. But "keep the window up in case they come back"
       * and "refuse everyone else while it is up" are different promises, and only the first one was
       * ever intended. The import carrier hid this for a year of screens because it opens no window at
       * all, so it always released instantly on `SETTLED_SURFACE_CLOSED`.
       *
       * **The precondition is NO ATTACHED TAB, and that is the whole of it.**
       *
       * Not "and the run is settled" — that was the first cut of this fix and a live chain on
       * 2026-08-20 showed it declining exactly where it was needed: the seller had started the
       * renewal walk (so the run was mid-flight, not settled) and then left it. An in-flight run with
       * no tab on it is not being driven by anyone — the frontend is the only thing that sends
       * commands — it is parked, waiting for a tab that has gone. `maybeRelease` already agrees and
       * releases precisely this case, as `ABANDONED_GRACE_ELAPSED`; the handover just stops making
       * somebody else wait fifteen minutes for it.
       *
       * **The one-slot guarantee does not move: a tab still attached always refuses.** A tab on the
       * screen is the only evidence that a human is in the middle of that walk, and it is the
       * evidence this checks.
       *
       * **And the key-copying case is untouched**, which is worth stating because it is what the
       * grace exists for. A seller finishing the Coupang issuance walk goes back to
       * `/connect/coupang` to paste the secret — that screen asks for the SAME carrier, so it takes
       * the `same` branch above and re-announces. It never reaches here. Reaching here means they
       * asked for a DIFFERENT walk, which is a clearer statement of intent than the grace's guess.
       */
      if (this.canHandOver()) {
        log("aw_on_demand_carrier_handover", {
          from: this.active.request.carrier,
          fromChannel: this.active.request.channelCode,
          to: request.carrier,
          toChannel: request.channelCode,
        });
        // Sequenced, not raced: the previous carrier's window is closed and its endpoint torn down
        // BEFORE the new one is built, so two carriers never hold a browser at the same moment.
        void this.release("HANDOVER").then(() => {
          if (this.closed || this.active) return;
          this.activateFor(ws, request);
        });
        return;
      }
      // One slot, and this one is busy or being watched. The other world's tab gets no announcement
      // and takes its own fallback.
      log("aw_on_demand_attach_refused", { reason: "OTHER_CARRIER_ACTIVE", carrier: request.carrier, channelCode: request.channelCode });
      return;
    }
    this.activateFor(ws, request);
  }

  /**
   * May the active carrier give up the slot to a different request right now?
   *
   * One reading: is any tab still attached to it. A carrier already being torn down is not
   * handed over either — the release in flight will land the host in idle, and the asking tab
   * retries or falls back.
   */
  private canHandOver(): boolean {
    if (!this.active || this.releasing) return false;
    return this.attached.size === 0;
  }

  /** Build, announce and start polling a carrier for `request`. Refuses (logging why) when unservable. */
  private activateFor(ws: WebSocket, request: AwAttachRequest): void {
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
