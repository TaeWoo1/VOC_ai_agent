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
  ws: WebSocketLike;
  runId: string;
  channelCode: string;
}

/**
 * Mint a ticket from the stored pairing token and open one authenticated socket, resolving only once
 * the agent announces its hosted run (`aw_session`). `null` on any failure — unpaired, unreachable,
 * revoked (401), no announcement in time, or a transport-version mismatch.
 */
async function openAnnouncedSocket(d: ResolvedDeps): Promise<OpenedSocket | null> {
  const token = d.storage.getItem(BRIDGE_TOKEN_KEY);
  if (!token) return null;

  let ticket: string;
  try {
    const res = await d.fetchFn(`${d.httpBase}/bridge/ws-ticket`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ clientProtocolVersion: BRIDGE_PROTOCOL_VERSION }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { ticket?: unknown };
    if (typeof body.ticket !== "string") return null;
    ticket = body.ticket;
  } catch {
    return null;
  }

  return new Promise((resolve) => {
    const ws = d.wsFactory(`${d.wsBase}/bridge/ws?ticket=${encodeURIComponent(ticket)}`);
    let settled = false;
    const giveUp = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* already closed */
      }
      resolve(null);
    };
    const timer = setTimeout(giveUp, d.sessionTimeoutMs);
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
        giveUp();
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
      if (parseAwCarrierKind(m.carrier) !== AW_CARRIER_EXPORT) {
        giveUp();
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({ ws, runId: m.runId, channelCode: m.channelCode });
    };
    ws.onclose = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(null);
      }
    };
    ws.onerror = () => {
      /* onclose follows */
    };
  });
}

/**
 * Connect the live Action Window transport over the Local Agent Bridge. Resolves `null` whenever a
 * live session cannot be established — the caller falls back to the mock.
 */
export async function connectAwBridgeSession(deps: AwWsDeps): Promise<AwBridgeSession | null> {
  const d = resolveDeps(deps);
  const first = await openAnnouncedSocket(d);
  if (!first) return null;

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
      if (!next) continue;
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

  return {
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
}
