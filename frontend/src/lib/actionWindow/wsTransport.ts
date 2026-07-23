// **Action Window Bridge-WS transport (R2B).** The concrete `AwClientTransport` that carries Action
// Window frames as OPAQUE `{type:"aw", payload}` messages over the existing authenticated Local Agent
// Bridge WebSocket (`/bridge/ws`), per the ratified transport governance (contract README §8): frames
// nest inside Bridge v1; no new Bridge message semantics, no separate socket type.
//
// Authentication is fully reused: this module reads the pairing token the Bridge status client stored
// (`BRIDGE_TOKEN_KEY`), mints a single-use WS ticket, and connects — it never pairs on its own. The
// hosted run's identity arrives from the agent as the `aw_session` announcement; the FE never invents
// a runId. When anything is missing (agent off, unpaired, no hosted run, version mismatch) the
// connection resolves `null` and Operations stays on the mock (see `devMode.ts`).
//
// Reconnect: if an established socket drops, the transport re-mints a ticket, reopens, and sends
// `aw_resync` from sequence 0 — the adapter dedupes replayed events by eventId/sequence and adopts the
// highest-revision view, so a full replay is idempotent. If the agent now hosts a DIFFERENT run, the
// transport goes dormant instead of splicing two runs together.

import {
  AW_CARRIER_EXPORT,
  parseAwCarrierKind,
  type AwCarrierKind,
} from "../../../../contracts/action-window/aw-carrier-kind";
import {
  ACTION_WINDOW_TRANSPORT_VERSION,
  deserializeFrame,
  serializeFrame,
  type AwClientFrame,
  type AwClientTransport,
  type AwServerFrame,
} from "./contract";
import { BRIDGE_PROTOCOL_VERSION } from "../bridge/bridgeProtocol";
import { BRIDGE_TOKEN_KEY, type StorageLike, type WebSocketLike } from "../bridge/bridgeClient";

/**
 * Connection status of an ESTABLISHED session (FE-owned UI signal, not a wire message).
 * Product goal: when the local agent / Bridge connection drops or reconnects, the
 * Operations UI shows the existing offline/reconnecting banner and temporarily
 * suppresses action buttons, so the seller does not click commands while SellerOps
 * is not actually connected.
 *  - "connected"     — live socket adopted (initially, or restored after a drop);
 *  - "reconnecting"  — the socket dropped and the retry loop is running;
 *  - "offline"       — dormant: retries exhausted, or the agent now hosts a different run.
 */
export type AwConnectionStatus = "connected" | "reconnecting" | "offline";

export interface AwWsDeps {
  httpBase: string;
  wsBase: string;
  fetchFn?: typeof fetch;
  wsFactory?: (url: string) => WebSocketLike;
  storage?: StorageLike;
  /** How long to wait for the agent's `aw_session` announcement before giving up. */
  sessionTimeoutMs?: number;
  /** Delay between reconnect attempts after an established socket drops. */
  retryDelayMs?: number;
  /** Consecutive failed reconnect attempts before the transport goes dormant. */
  maxReconnectAttempts?: number;
  /** OPTIONAL status callback (additive): fired on connected/reconnecting/offline
   *  transitions of an established session, deduped, never after `close()`.
   *  When omitted, transport behavior is identical to before this hook existed. */
  onStatus?: (status: AwConnectionStatus) => void;
}

/** A live Action Window transport bound to the run the local agent announced. */
export interface AwBridgeSession {
  transport: AwClientTransport;
  runId: string;
  channelCode: string;
  /** Tear down the socket and stop all reconnection. */
  close(): void;
}

interface ResolvedDeps {
  httpBase: string;
  wsBase: string;
  fetchFn: typeof fetch;
  wsFactory: (url: string) => WebSocketLike;
  storage: StorageLike;
  sessionTimeoutMs: number;
  retryDelayMs: number;
  maxReconnectAttempts: number;
  onStatus?: (status: AwConnectionStatus) => void;
}

const SERVER_FRAME_KINDS = new Set(["aw_event", "aw_view", "aw_command_result", "aw_resync_result"]);

function resolveDeps(deps: AwWsDeps): ResolvedDeps {
  return {
    httpBase: deps.httpBase,
    wsBase: deps.wsBase,
    fetchFn: deps.fetchFn ?? fetch.bind(globalThis),
    wsFactory: deps.wsFactory ?? ((url) => new WebSocket(url) as unknown as WebSocketLike),
    storage: deps.storage ?? window.localStorage,
    sessionTimeoutMs: deps.sessionTimeoutMs ?? 4000,
    retryDelayMs: deps.retryDelayMs ?? 1500,
    maxReconnectAttempts: deps.maxReconnectAttempts ?? 5,
    onStatus: deps.onStatus,
  };
}

interface OpenedSocket {
  ok: true;
  ws: WebSocketLike;
  runId: string;
  channelCode: string;
}

/**
 * Why a live session could not be established. A CLOSED set of stable, sanitized enum values —
 * never a message, a status code, an origin, or a token — so it is safe to show and safe to log.
 *
 * <p>These used to be one indistinguishable `null`, which made "you have not paired yet", "the agent
 * is off", and "the agent is hosting the REPLY carrier" the same event to a caller. The last one in
 * particular is a normal, recoverable state that an operator can act on — and reporting it as
 * "offline" is how a working agent looks broken.
 */
export type AwRefusalReason =
  | "bridge-disabled"
  | "unpaired"
  | "ticket-rejected"
  | "unreachable"
  | "no-announcement"
  | "transport-version-mismatch"
  | "carrier-mismatch";

/** A refused connection attempt: the reason, plus the announced carrier when that is what refused it. */
export interface AwRefusal {
  ok: false;
  reason: AwRefusalReason;
  /**
   * Present only for {@code carrier-mismatch} AND only when the announced value was a KNOWN carrier.
   * An unrecognised or absent carrier stays absent here: it is precisely the thing we could not
   * identify, and naming it would be a guess.
   */
  announcedCarrier?: AwCarrierKind;
}

export type AwBridgeConnectResult = { ok: true; session: AwBridgeSession } | AwRefusal;

function refuse(reason: AwRefusalReason): AwRefusal {
  return { ok: false, reason };
}

/**
 * Mint a ticket from the stored pairing token and open one authenticated socket, resolving only once
 * the agent announces its hosted run (`aw_session`).
 *
 * <p>Every failure carries a REASON rather than collapsing to null. They are genuinely different
 * situations — "you have not paired", "the agent is off", "the agent is hosting the OTHER carrier" —
 * and an operator can act on the difference. The refusal behaviour itself is unchanged: no reason
 * attaches a socket that the previous code would have rejected.
 */
async function openAnnouncedSocket(d: ResolvedDeps): Promise<OpenedSocket | AwRefusal> {
  const token = d.storage.getItem(BRIDGE_TOKEN_KEY);
  if (!token) return refuse("unpaired");

  let ticket: string;
  try {
    const res = await d.fetchFn(`${d.httpBase}/bridge/ws-ticket`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ clientProtocolVersion: BRIDGE_PROTOCOL_VERSION }),
    });
    if (!res.ok) return refuse("ticket-rejected");
    const body = (await res.json()) as { ticket?: unknown };
    if (typeof body.ticket !== "string") return refuse("ticket-rejected");
    ticket = body.ticket;
  } catch {
    return refuse("unreachable");
  }

  return new Promise((resolve) => {
    const ws = d.wsFactory(`${d.wsBase}/bridge/ws?ticket=${encodeURIComponent(ticket)}`);
    let settled = false;
    const giveUp = (reason: AwRefusalReason, announcedCarrier?: AwCarrierKind): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* already closed */
      }
      resolve(announcedCarrier ? { ok: false, reason, announcedCarrier } : refuse(reason));
    };
    const timer = setTimeout(() => giveUp("no-announcement"), d.sessionTimeoutMs);
    ws.onmessage = (ev) => {
      if (settled) return;
      let msg: unknown;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      const m = msg as {
        type?: unknown;
        carrier?: unknown;
        transportVersion?: unknown;
        runId?: unknown;
        channelCode?: unknown;
      };
      if (m.type !== "aw_session") return; // hello/snapshot belong to the status channel — ignore here
      if (m.transportVersion !== ACTION_WINDOW_TRANSPORT_VERSION || typeof m.runId !== "string" || typeof m.channelCode !== "string") {
        giveUp("transport-version-mismatch");
        return;
      }
      // WHICH carrier the agent hosts. Nothing else on this announcement can tell them apart:
      // `transportVersion` is 1 in BOTH contracts (it versions the framing, which really is
      // identical) and `channelCode` is `naver` on both. Without this check, attaching to an agent
      // hosting the REPLY carrier would build a v1 client and feed it v2 envelopes — "connected but
      // dormant" instead of an honest fallback.
      //
      // This transport serves the v1 EXPORT world only. A reply carrier is not an error and not a
      // degraded export: it is a different world this caller does not speak, so it fails closed and
      // the operations surface keeps its contract-backed fixture rather than a half-attached live view.
      //
      // Absence fails closed too. Both endpoints predate this field, so an announcement without it is
      // genuinely ambiguous — and resolving that by assuming "export" is exactly how the mis-attach
      // would come back.
      const announced = parseAwCarrierKind(m.carrier);
      if (announced !== AW_CARRIER_EXPORT) {
        // The announced carrier travels with the refusal when it is a KNOWN one: "this agent hosts
        // replies" is actionable where "offline" is not. A null announced value stays absent rather
        // than being reported as a carrier, since it is precisely the thing we could not identify.
        giveUp("carrier-mismatch", announced ?? undefined);
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({ ok: true, ws, runId: m.runId, channelCode: m.channelCode });
    };
    ws.onclose = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(refuse("unreachable"));
      }
    };
    ws.onerror = () => {
      /* onclose follows */
    };
  });
}

/**
 * Connect the live Action Window transport over the Local Agent Bridge.
 *
 * <p>Resolves a session, or a REFUSAL carrying why. The caller still falls back to the mock on any
 * refusal — the honest-fallback rule is unchanged; the difference is only that it can now say what
 * happened instead of showing "offline" for every cause.
 */
export async function connectAwBridgeSession(deps: AwWsDeps): Promise<AwBridgeConnectResult> {
  const d = resolveDeps(deps);
  const first = await openAnnouncedSocket(d);
  if (!first.ok) return first;

  const listeners = new Set<(frame: AwServerFrame) => void>();
  let active: WebSocketLike | null = null;
  let closed = false;

  // Optional status reporting (additive): deduped transitions, silent after close().
  let lastStatus: AwConnectionStatus | null = null;
  const setStatus = (status: AwConnectionStatus): void => {
    if (closed || status === lastStatus) return;
    lastStatus = status;
    d.onStatus?.(status);
  };

  const deliver = (raw: string): void => {
    let msg: unknown;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const m = msg as { type?: unknown; payload?: unknown };
    if (m.type !== "aw" || typeof m.payload !== "string") return;
    let frame: AwServerFrame;
    try {
      const parsed = deserializeFrame(m.payload);
      if (!SERVER_FRAME_KINDS.has(parsed.kind)) return;
      frame = parsed as AwServerFrame;
    } catch {
      return;
    }
    for (const listener of [...listeners]) listener(frame);
  };

  const sendFrame = (frame: AwClientFrame): void => {
    // No live socket → the frame is dropped, exactly like a detached loopback end; the resync sent on
    // the next successful reconnect repairs the gap.
    if (closed || !active) return;
    try {
      active.send(JSON.stringify({ type: "aw", payload: serializeFrame(frame) }));
    } catch {
      /* dropped */
    }
  };

  const adopt = (ws: WebSocketLike): void => {
    active = ws;
    ws.onmessage = (ev) => deliver(ev.data);
    ws.onclose = () => {
      if (!closed && active === ws) {
        active = null;
        setStatus("reconnecting");
        void reconnect();
      }
    };
    ws.onerror = () => {
      /* onclose follows */
    };
  };

  const reconnect = async (): Promise<void> => {
    for (let attempt = 0; !closed && attempt < d.maxReconnectAttempts; attempt++) {
      await new Promise<void>((r) => setTimeout(r, d.retryDelayMs));
      if (closed) return;
      const next = await openAnnouncedSocket(d);
      // A refusal on reconnect is retried like any other failure — including a carrier switch, which
      // must never be adopted into an established v1 transport.
      if (!next.ok) continue;
      if (closed || next.runId !== first.runId) {
        // Session closed meanwhile, or the agent now hosts a different run — never splice two runs.
        try {
          next.ws.close();
        } catch {
          /* already closed */
        }
        if (!closed) setStatus("offline"); // dormant: different run — never splice
        return;
      }
      adopt(next.ws);
      // Replay from zero: the adapter dedupes by eventId/sequence and keeps the highest-revision view.
      sendFrame({ kind: "aw_resync", runId: first.runId, sinceSequence: 0 });
      setStatus("connected");
      return;
    }
    setStatus("offline"); // dormant: retries exhausted (setStatus is a no-op after close())
  };

  adopt(first.ws);
  setStatus("connected");

  const session: AwBridgeSession = {
    runId: first.runId,
    channelCode: first.channelCode,
    transport: {
      send: sendFrame,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    close: () => {
      closed = true;
      const ws = active;
      active = null;
      if (ws) {
        try {
          ws.close();
        } catch {
          /* already closed */
        }
      }
    },
  };
  return { ok: true, session };
}
