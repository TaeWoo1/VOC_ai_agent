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
  // The real export endpoint announces this; without it the transport fails closed, because nothing
  // else on the wire distinguishes the export carrier from the reply one.
  carrier: "export",
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

function harness(
  opts: {
    withToken?: boolean;
    ticketStatus?: number;
    /** Ask the agent for a carrier by name (on-demand hosting) — what every product session now does. */
    attachChannelCode?: string;
    expectedCarrier?: string;
    sessionTimeoutMs?: number;
  } = {},
): Harness {
  const sockets: FakeWs[] = [];
  const h: Harness = {
    sockets,
    ticketCalls: 0,
    deps: {
      httpBase: "http://127.0.0.1:47615",
      wsBase: "ws://127.0.0.1:47615",
      storage: makeStorage(opts.withToken ?? true),
      sessionTimeoutMs: opts.sessionTimeoutMs ?? 200,
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
      ...(opts.attachChannelCode ? { attachChannelCode: opts.attachChannelCode } : {}),
      ...(opts.expectedCarrier ? { expectedCarrier: opts.expectedCarrier as never } : {}),
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
  const result = await pending;
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("unreachable: session expected");
  return { session: result.session, ws };
}

describe("actionWindow/wsTransport", () => {
  it("refuses as `unpaired` (no stored token) without calling the agent", async () => {
    const h = harness({ withToken: false });
    expect(await connectAwBridgeSession(h.deps)).toEqual({ ok: false, reason: "unpaired" });
    expect(h.ticketCalls).toBe(0);
    expect(h.sockets).toHaveLength(0);
  });

  it("refuses as `ticket-rejected` when the ticket mint is rejected (revoked/unreachable)", async () => {
    const h = harness({ ticketStatus: 401 });
    expect(await connectAwBridgeSession(h.deps)).toEqual({ ok: false, reason: "ticket-rejected" });
    expect(h.sockets).toHaveLength(0);
  });

  it("refuses as `no-announcement` when none arrives in time", async () => {
    const h = harness();
    h.deps.sessionTimeoutMs = 20;
    const result = await connectAwBridgeSession(h.deps);
    expect(result).toEqual({ ok: false, reason: "no-announcement" });
    expect(h.sockets[0]?.closedByClient).toBe(true);
  });

  it("refuses as `transport-version-mismatch`", async () => {
    const h = harness();
    const pending = connectAwBridgeSession(h.deps);
    const ws = await until(() => h.sockets[0]);
    ws.receive({ ...ANNOUNCEMENT, transportVersion: ACTION_WINDOW_TRANSPORT_VERSION + 1 });
    expect(await pending).toEqual({ ok: false, reason: "transport-version-mismatch" });
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

describe("actionWindow/wsTransport — carrier discrimination", () => {
  // The mis-attach this guard exists for. `transportVersion` is 1 in BOTH the v1 and v2 contracts
  // (it versions the framing, which really is identical) and `channelCode` is the same on both, so
  // before `carrier` there was nothing to tell them apart: this transport would have accepted a
  // reply-carrier agent, built a v1 client, and fed it v2 envelopes — connected but dormant.

  /** Announce `overrides` on the first socket and resolve whatever the transport decides. */
  async function announce(overrides: Record<string, unknown>) {
    const h = harness();
    const pending = connectAwBridgeSession(h.deps);
    const ws = await until(() => h.sockets[0]);
    ws.receive({ ...ANNOUNCEMENT, ...overrides });
    return { session: await pending, ws };
  }

  it("REFUSES to attach to an agent hosting the REPLY carrier", async () => {
    // Null, not a degraded export: a different world this caller does not speak. The operations
    // surface keeps its contract-backed fixture instead of a half-attached live view.
    const { session, ws } = await announce({ carrier: "reply" });

    // The reason travels with the refusal — "the agent hosts replies" is actionable where a bare
    // failure is not — and it names WHICH carrier, so diagnostics can say so.
    expect(session).toEqual({ ok: false, reason: "carrier-mismatch", announcedCarrier: "reply" });
    expect(ws.closedByClient).toBe(true);
  });

  it("REFUSES an announcement with no carrier at all", async () => {
    // Both endpoints predate this field, so an announcement without it is genuinely ambiguous —
    // and resolving ambiguity by assuming "export" is exactly how the mis-attach comes back.
    const withoutCarrier: Record<string, unknown> = { ...ANNOUNCEMENT };
    delete withoutCarrier.carrier;
    const h = harness();
    const pending = connectAwBridgeSession(h.deps);
    const ws = await until(() => h.sockets[0]);
    ws.receive(withoutCarrier);

    // No announcedCarrier: absence is precisely the thing we could not identify, so naming one
    // would be a guess.
    expect(await pending).toEqual({ ok: false, reason: "carrier-mismatch" });
    expect(ws.closedByClient).toBe(true);
  });

  it("REFUSES an unrecognised carrier rather than guessing", async () => {
    const { session } = await announce({ carrier: "something-new" });

    expect(session).toEqual({ ok: false, reason: "carrier-mismatch" });
  });

  /**
   * **The handover race.** An on-demand host announces whatever it is currently hosting to every socket
   * the moment it connects — before that socket has said which carrier it wants. A client that DID ask
   * must not take that first frame as the answer.
   *
   * Live on 2026-08-20: a seller pressed `[쿠팡에서 보기]` while an abandoned renewal walk still held the
   * slot, met the renewal announcement, and read "SellerOps 도우미가 지금 다른 작업을 하고 있어…" — while
   * the host handed the slot over ~170 ms later and the correct announcement was already on its way.
   * Pressing again worked, which is the shape of a race and not of a refusal.
   */
  it("waits out a handover when it ASKED for a carrier — the later, correct announcement wins", async () => {
    const h = harness({ attachChannelCode: "coupang", expectedCarrier: "locate" });
    const pending = connectAwBridgeSession(h.deps);
    const ws = await until(() => h.sockets[0]);

    // What the host was still hosting when this socket connected.
    ws.receive({ ...ANNOUNCEMENT, carrier: "renewal" });
    // NOT settled: no client is built for the wrong carrier, but the decision is not made yet either.
    expect(ws.closedByClient).toBe(false);

    ws.receive({ ...ANNOUNCEMENT, carrier: "locate", runId: "run_locate_1" });

    const result = await pending;
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.session.runId).toBe("run_locate_1");
  });

  it("…and still refuses with carrier-mismatch if the right announcement never comes", async () => {
    const h = harness({ attachChannelCode: "coupang", expectedCarrier: "locate", sessionTimeoutMs: 20 });
    const pending = connectAwBridgeSession(h.deps);
    const ws = await until(() => h.sockets[0]);
    ws.receive({ ...ANNOUNCEMENT, carrier: "renewal" });

    // The diagnosis survives the wait — a genuinely fixed-carrier agent of the wrong kind is still
    // named, just at the timeout instead of on the first frame.
    expect(await pending).toEqual({ ok: false, reason: "carrier-mismatch", announcedCarrier: "renewal" });
  });

  it("REFUSES a carrier switch on RECONNECT — an agent that came back hosting replies is not spliced", async () => {
    // The guard lives inside the shared handshake, so the retry loop re-reads the announcement rather
    // than trusting the carrier it attached under. Worth pinning: an agent restarted with
    // --dev-action-window-reply is a realistic way for the carrier to change mid-session, and
    // splicing v2 frames into an established v1 transport is the failure this slice exists to stop.
    const h = harness();
    h.deps.maxReconnectAttempts = 1; // one attempt, so the refusal settles quickly
    const { session } = await connected(h);

    h.sockets[0]!.drop();
    const ws2 = await until(() => h.sockets[1]);
    ws2.receive({ ...ANNOUNCEMENT, carrier: "reply" });

    // The reply-carrier socket is refused by the handshake, so it is never adopted: no resync frame
    // is ever sent on it. Dormant, not spliced.
    await new Promise((r) => setTimeout(r, 20));
    expect(ws2.sent).toHaveLength(0);
    expect(session.runId).toBe(RUN_ID);
  });

  it("still attaches to the EXPORT carrier — v1 behaviour is unchanged", async () => {
    const h = harness();
    const { session } = await connected(h);

    expect(session.runId).toBe(RUN_ID);
  });
});

describe("actionWindow/wsTransport — expectedCarrier (the caller declares its world)", () => {
  // NOT mode switching: a session is bound to one carrier for its whole life. This only lets the v2
  // reply world use the shared transport by declaring `reply`, instead of hardcoding v1's `export` —
  // with the refusal symmetric in both directions.

  it("attaches a reply-declared caller to a REPLY-carrier agent", async () => {
    const h = harness();
    h.deps.expectedCarrier = "reply";
    const pending = connectAwBridgeSession(h.deps);
    const ws = await until(() => h.sockets[0]);
    ws.receive({ ...ANNOUNCEMENT, carrier: "reply" });
    const result = await pending;

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.session.runId).toBe(RUN_ID);
  });

  it("REFUSES an EXPORT-carrier agent for a reply-declared caller — symmetric, and names the carrier", async () => {
    const h = harness();
    h.deps.expectedCarrier = "reply";
    const pending = connectAwBridgeSession(h.deps);
    const ws = await until(() => h.sockets[0]);
    ws.receive(ANNOUNCEMENT); // the real export announcement

    expect(await pending).toEqual({ ok: false, reason: "carrier-mismatch", announcedCarrier: "export" });
    expect(ws.closedByClient).toBe(true);
  });

  it("omitting expectedCarrier still means EXPORT — every existing caller is unchanged", async () => {
    const h = harness();
    const pending = connectAwBridgeSession(h.deps);
    const ws = await until(() => h.sockets[0]);
    ws.receive({ ...ANNOUNCEMENT, carrier: "reply" });

    expect(await pending).toEqual({ ok: false, reason: "carrier-mismatch", announcedCarrier: "reply" });
  });
});
