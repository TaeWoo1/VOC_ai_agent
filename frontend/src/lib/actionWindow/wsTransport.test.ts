// **Action Window Bridge-WS transport tests.** Injected fetch/WebSocket/storage fakes (the same
// pattern as `bridgeClient.test.ts`) prove the R2B client transport: pairing-token reuse, single-use
// ticket mint, the `aw_session` announcement gate, opaque `{type:"aw"}` framing in both directions,
// reconnect-with-resync, run-identity pinning, and the null fallbacks that keep Operations on the mock.
import { describe, expect, it } from "vitest";
import { serializeFrame, deserializeFrame, ACTION_WINDOW_TRANSPORT_VERSION, type AwServerFrame } from "./contract";
import { UI_SCENARIOS } from "./fixtures";
import { connectAwBridgeSession, type AwConnectionStatus, type AwWsDeps } from "./wsTransport";
import type { StorageLike, WebSocketLike } from "../bridge/bridgeClient";

const RUN_ID = "run_ws_test";
const ANNOUNCEMENT = {
  type: "aw_session",
  transportVersion: ACTION_WINDOW_TRANSPORT_VERSION,
  runId: RUN_ID,
  channelCode: "synthetic",
};

class FakeWs implements WebSocketLike {
  sent: string[] = [];
  closedByClient = false;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.closedByClient = true;
    this.onclose?.();
  }
  /** Server → client message. */
  receive(msg: unknown): void {
    this.onmessage?.({ data: typeof msg === "string" ? msg : JSON.stringify(msg) });
  }
  /** Abrupt server-side drop (not initiated by the client). */
  drop(): void {
    this.onclose?.();
  }
}

function makeStorage(withToken = true): StorageLike {
  const map = new Map<string, string>(withToken ? [["sellerops_bridge_token", "tok-1"]] : []);
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

interface Harness {
  deps: AwWsDeps;
  sockets: FakeWs[];
  ticketCalls: number;
}

function harness(opts: { withToken?: boolean; ticketStatus?: number } = {}): Harness {
  const sockets: FakeWs[] = [];
  const h: Harness = {
    sockets,
    ticketCalls: 0,
    deps: {
      httpBase: "http://127.0.0.1:47615",
      wsBase: "ws://127.0.0.1:47615",
      storage: makeStorage(opts.withToken ?? true),
      sessionTimeoutMs: 200,
      retryDelayMs: 0,
      maxReconnectAttempts: 3,
      fetchFn: (async () => {
        h.ticketCalls += 1;
        const status = opts.ticketStatus ?? 200;
        return {
          ok: status >= 200 && status < 300,
          status,
          json: async () => ({ ticket: `ticket-${h.ticketCalls}`, expiresInMs: 10_000 }),
        } as Response;
      }) as typeof fetch,
      wsFactory: () => {
        const ws = new FakeWs();
        sockets.push(ws);
        return ws;
      },
    },
  };
  return h;
}

/** Poll until `get` is truthy (the transport settles over real microtask/timer boundaries). */
async function until<T>(get: () => T | undefined | null | false, timeoutMs = 2000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = get();
    if (v) return v as T;
    if (Date.now() - start > timeoutMs) throw new Error("until: condition not met in time");
    await new Promise((r) => setTimeout(r, 5));
  }
}

/** Start a connect attempt and complete the announcement handshake on the first socket. */
async function connected(h: Harness) {
  const pending = connectAwBridgeSession(h.deps);
  const ws = await until(() => h.sockets[0]);
  ws.receive({ type: "hello", protocolVersion: 1 }); // status-channel noise — must be ignored
  ws.receive(ANNOUNCEMENT);
  const session = await pending;
  expect(session).not.toBeNull();
  return { session: session!, ws };
}

describe("actionWindow/wsTransport", () => {
  it("resolves null when unpaired (no stored token) without calling the agent", async () => {
    const h = harness({ withToken: false });
    expect(await connectAwBridgeSession(h.deps)).toBeNull();
    expect(h.ticketCalls).toBe(0);
    expect(h.sockets).toHaveLength(0);
  });

  it("resolves null when the ticket mint is rejected (revoked/unreachable)", async () => {
    const h = harness({ ticketStatus: 401 });
    expect(await connectAwBridgeSession(h.deps)).toBeNull();
    expect(h.sockets).toHaveLength(0);
  });

  it("resolves null when no aw_session announcement arrives in time", async () => {
    const h = harness();
    h.deps.sessionTimeoutMs = 20;
    const session = await connectAwBridgeSession(h.deps);
    expect(session).toBeNull();
    expect(h.sockets[0]?.closedByClient).toBe(true);
  });

  it("resolves null on a transport-version mismatch", async () => {
    const h = harness();
    const pending = connectAwBridgeSession(h.deps);
    const ws = await until(() => h.sockets[0]);
    ws.receive({ ...ANNOUNCEMENT, transportVersion: ACTION_WINDOW_TRANSPORT_VERSION + 1 });
    expect(await pending).toBeNull();
    expect(ws.closedByClient).toBe(true);
  });

  it("establishes a session from the announcement and frames traffic as opaque aw carriers", async () => {
    const h = harness();
    const { session, ws } = await connected(h);
    expect(session.runId).toBe(RUN_ID);
    expect(session.channelCode).toBe("synthetic");

    // Outbound: the client frame rides inside {type:"aw", payload}.
    session.transport.send({ kind: "aw_resync", runId: RUN_ID, sinceSequence: 0 });
    const carrier = JSON.parse(ws.sent[ws.sent.length - 1]!) as { type: string; payload: string };
    expect(carrier.type).toBe("aw");
    expect(deserializeFrame(carrier.payload)).toEqual({ kind: "aw_resync", runId: RUN_ID, sinceSequence: 0 });

    // Inbound: carriers are unwrapped; everything else is ignored.
    const received: AwServerFrame[] = [];
    session.transport.subscribe((f) => received.push(f));
    const view = UI_SCENARIOS["human-action-required"].run!;
    ws.receive({ type: "aw", payload: serializeFrame({ kind: "aw_view", view }) });
    ws.receive({ type: "snapshot", snapshot: { connections: [] } }); // status channel — ignored
    ws.receive({ type: "aw", payload: "{malformed" }); // dropped
    ws.receive({ type: "aw", payload: serializeFrame({ kind: "aw_resync", runId: RUN_ID, sinceSequence: 0 }) }); // client-kind — filtered
    expect(received).toEqual([{ kind: "aw_view", view }]);
    session.close();
  });

  it("reconnects after a drop with a fresh ticket and resyncs from zero", async () => {
    const h = harness();
    const { session } = await connected(h);
    expect(h.ticketCalls).toBe(1);

    h.sockets[0]!.drop();
    const ws2 = await until(() => h.sockets[1]);
    expect(h.ticketCalls).toBe(2); // a NEW single-use ticket, same stored pairing token
    ws2.receive(ANNOUNCEMENT);
    await until(() => ws2.sent.length >= 1);
    const carrier = JSON.parse(ws2.sent[0]!) as { type: string; payload: string };
    expect(deserializeFrame(carrier.payload)).toEqual({ kind: "aw_resync", runId: RUN_ID, sinceSequence: 0 });

    // The re-adopted socket keeps delivering frames.
    const received: AwServerFrame[] = [];
    session.transport.subscribe((f) => received.push(f));
    const view = UI_SCENARIOS["human-action-required"].run!;
    ws2.receive({ type: "aw", payload: serializeFrame({ kind: "aw_view", view }) });
    expect(received).toEqual([{ kind: "aw_view", view }]);
    session.close();
  });

  it("goes dormant instead of splicing runs when the agent announces a different run after reconnect", async () => {
    const h = harness();
    const { session } = await connected(h);
    h.sockets[0]!.drop();
    const ws2 = await until(() => h.sockets[1]);
    ws2.receive({ ...ANNOUNCEMENT, runId: "run_other" });
    await until(() => ws2.closedByClient);
    expect(ws2.sent).toHaveLength(0); // no resync into a different run
    session.close();
  });

  it("close() tears down and stops all reconnection", async () => {
    const h = harness();
    const { session, ws } = await connected(h);
    session.close();
    expect(ws.closedByClient).toBe(true);
    await new Promise((r) => setTimeout(r, 30));
    expect(h.sockets).toHaveLength(1); // no reconnect attempt after an explicit close
    expect(h.ticketCalls).toBe(1);
    session.transport.send({ kind: "aw_resync", runId: RUN_ID, sinceSequence: 0 }); // dropped, no throw
  });
});

// Optional connection-status callback (additive). Product goal: when the agent /
// Bridge connection drops or reconnects, the Operations UI shows the existing
// offline/reconnecting banner and suppresses action buttons. With no callback,
// behavior is unchanged — every test above runs without one.
describe("actionWindow/wsTransport — onStatus callback", () => {
  function statusHarness() {
    const h = harness();
    const statuses: AwConnectionStatus[] = [];
    h.deps.onStatus = (s) => statuses.push(s);
    return { h, statuses };
  }

  it("fires connected when the session is established", async () => {
    const { h, statuses } = statusHarness();
    await connected(h);
    expect(statuses).toEqual(["connected"]);
  });

  it("reports reconnecting on a drop and connected again after a successful restore", async () => {
    const { h, statuses } = statusHarness();
    await connected(h);
    h.sockets[0]!.drop();
    const ws2 = await until(() => h.sockets[1]);
    expect(statuses).toEqual(["connected", "reconnecting"]);
    ws2.receive(ANNOUNCEMENT);
    await until(() => statuses.length === 3);
    expect(statuses).toEqual(["connected", "reconnecting", "connected"]);
  });

  it("goes offline when reconnect attempts are exhausted", async () => {
    const { h, statuses } = statusHarness();
    h.deps.sessionTimeoutMs = 20; // announcement never arrives on retry sockets
    await connected(h);
    h.sockets[0]!.drop();
    await until(() => statuses[statuses.length - 1] === "offline");
    expect(statuses).toEqual(["connected", "reconnecting", "offline"]);
  });

  it("goes offline (dormant) when the agent announces a different run", async () => {
    const { h, statuses } = statusHarness();
    await connected(h);
    h.sockets[0]!.drop();
    const ws2 = await until(() => h.sockets[1]);
    ws2.receive({ ...ANNOUNCEMENT, runId: "run_other" });
    await until(() => statuses[statuses.length - 1] === "offline");
    expect(statuses).toEqual(["connected", "reconnecting", "offline"]);
  });

  it("never fires after close()", async () => {
    const { h, statuses } = statusHarness();
    const { session } = await connected(h);
    session.close(); // the client-initiated close must not report reconnecting/offline
    await new Promise((r) => setTimeout(r, 30));
    expect(statuses).toEqual(["connected"]);
  });
});
