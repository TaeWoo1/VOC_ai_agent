/**
 * Test-only helpers for driving the bridge with the real `ws` client, so tests exercise the actual
 * library handshake/framing and can fully control the handshake headers (Origin) and observe 101-vs-rejection.
 */
import WebSocket from "ws";
import type { ApprovalPresentation, ApprovalPresenter } from "../../src/bridge/approval-presenter";
import type { PairingRegistry } from "../../src/bridge/pairing";

export interface ConnectResult {
  status: number;
  ws?: WebSocket;
}

/**
 * `requestPairing` for tests that are not ABOUT the pending cap: assert the request was admitted and narrow
 * to the success branch. Tests that exercise the cap itself call `requestPairing` directly and inspect the
 * rejection — this helper deliberately throws on one, so a suite can never silently start asserting against
 * a rejected request's `undefined` fields.
 */
export function mustRequestPairing(
  reg: PairingRegistry,
  origin: string,
  workspaceLabel: string,
  opts: { requireApproval?: boolean } = {},
): { requestId: string; confirmationCode: string; approvalCode?: string } {
  const r = reg.requestPairing(origin, workspaceLabel, opts);
  if (!r.ok) throw new Error(`requestPairing unexpectedly rejected: ${r.reason} (${r.pendingCount}/${r.limit})`);
  return r;
}

/**
 * **Test stand-in for the human console.** Pairing is fail-closed in every environment: without an injected
 * presenter the bridge refuses to pair (`503 approval_unavailable`), so any suite that drives a real
 * request→confirm→poll must inject one. This always-available fake records what WOULD have been shown, so a
 * test can act as the human who read the code off the terminal.
 *
 * Test-only: a real presenter must prove it reaches a human (see `stderr-approval-presenter.ts`, which
 * refuses a redirected stderr). This one asserts nothing of the sort — never wire it into production source.
 */
export function fakeApprovalPresenter(): {
  presenter: ApprovalPresenter;
  shown: ApprovalPresentation[];
  /** The approval code from the most recent presentation — what the human would type in. */
  lastCode: () => string;
} {
  const shown: ApprovalPresentation[] = [];
  return {
    shown,
    lastCode: () => {
      const last = shown[shown.length - 1];
      if (!last) throw new Error("fakeApprovalPresenter: nothing presented yet");
      return last.approvalCode;
    },
    presenter: {
      available: () => true,
      present: (p) => {
        shown.push(p);
        return { status: "presented" };
      },
    },
  };
}

/**
 * Open a WS connection with an explicit Origin. Resolves 101 (+ the open socket) on success, or the HTTP
 * rejection status the server returned (bad origin / bad ticket) on failure.
 */
export function connect(opts: { port: number; path: string; origin?: string; autoPong?: boolean }): Promise<ConnectResult> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${opts.port}${opts.path}`, {
      origin: opts.origin,
      // `autoPong: false` makes the client ignore server pings (no pong reply) — a supported `ws` option that
      // simulates a half-open/dead peer for the heartbeat-reaping test, without touching private socket internals.
      ...(opts.autoPong === false ? { autoPong: false } : {}),
      // `ws` also accepts headers; origin above sets the Origin header.
    });
    // Attach the reader NOW (not on open) — the server sends hello+snapshot synchronously right after the
    // handshake, before this promise resolves, so a later listener would miss them.
    ensureReader(ws);
    let settled = false;
    ws.on("open", () => { if (!settled) { settled = true; resolve({ status: 101, ws }); } });
    ws.on("unexpected-response", (_req, res) => {
      if (!settled) { settled = true; resolve({ status: res.statusCode ?? 0 }); }
      res.resume();
      ws.terminate();
    });
    ws.on("error", (err) => {
      // A handshake rejection surfaces as 'unexpected-response' (handled above); a raw connection error only
      // rejects if we haven't already settled.
      if (!settled) { settled = true; reject(err); }
    });
  });
}

interface Reader {
  queue: Record<string, unknown>[];
  waiter?: { count: number; resolve: (m: Record<string, unknown>[]) => void };
}
const readers = new WeakMap<WebSocket, Reader>();

function tryResolve(r: Reader): void {
  if (r.waiter && r.queue.length >= r.waiter.count) {
    const msgs = r.queue.splice(0, r.waiter.count);
    const w = r.waiter;
    r.waiter = undefined;
    w.resolve(msgs);
  }
}

/** Attach the single persistent 'message' listener + shared queue for a socket (idempotent). */
function ensureReader(ws: WebSocket): Reader {
  let r = readers.get(ws);
  if (!r) {
    const reader: Reader = { queue: [] };
    ws.on("message", (data: WebSocket.RawData, isBinary: boolean) => {
      if (isBinary) return;
      try { reader.queue.push(JSON.parse(data.toString())); } catch { /* ignore non-JSON */ }
      tryResolve(reader);
    });
    readers.set(ws, reader);
    r = reader;
  }
  return r;
}

/**
 * Read the next `count` server→client JSON messages (cumulative). ONE persistent 'message' listener per
 * socket feeds a shared queue, so sequential reads never drop frames that arrive between calls.
 */
export function readMessages(ws: WebSocket, count: number, timeoutMs = 8000): Promise<Record<string, unknown>[]> {
  const reader = ensureReader(ws);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { reader.waiter = undefined; reject(new Error(`timeout: queued ${reader.queue.length}/${count}`)); }, timeoutMs);
    reader.waiter = { count, resolve: (m) => { clearTimeout(timer); resolve(m); } };
    tryResolve(reader);
  });
}

/** Fixed injected clock helper for deterministic pairing tests. */
export function fixedClock(startMs = 1_000_000): { now: () => number; advance: (ms: number) => void } {
  let t = startMs;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}
