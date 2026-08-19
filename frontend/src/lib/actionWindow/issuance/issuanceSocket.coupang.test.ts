// **Coupang guided-issuance over the ISSUANCE carrier of the real Bridge-WS transport.**
//
// `wsTransport.test.ts` proves the transport for the EXPORT/REPLY carriers; `issuanceSession.test.ts` proves
// the thin issuance wrapper against a MOCKED transport. Neither drives the ISSUANCE carrier over a socket for
// `channelCode: "coupang"` — which is exactly the wire the Coupang guided walkthrough runs on. This does, using
// the same injected FakeWs + fetch + StorageLike harness, so "the browser discovers, pairs, and drives a Coupang
// issuance run over the bridge" is pinned on the FE side without a live agent.
//
// It drives `connectAwBridgeSession` with `expectedCarrier: "issuance"` — the exact call
// `connectIssuanceSession` delegates to (`issuanceSession.ts`) — announcing `carrier:"issuance",
// channelCode:"coupang"`, and exercises: token gating, wrong/expired-token fail-closed, carrier discrimination
// (never mis-attach to export/reply), opaque v2 `{type:"aw"}` framing in both directions, reconnect-with-resync
// (refresh / agent restart), and going dormant rather than splicing onto a different run.
import { describe, expect, it } from "vitest";
import { AW_CARRIER_ISSUANCE } from "../../../../../contracts/action-window/aw-carrier-kind";
import type { ActionWindowRunView } from "../../../../../contracts/action-window/v2/index";
import {
  serializeFrame,
  deserializeFrame,
  ACTION_WINDOW_TRANSPORT_VERSION,
  type AwServerFrame,
} from "../../../../../contracts/action-window/v2/transport";
import { connectAwBridgeSession, type AwWsDeps } from "../wsTransport";
import type { StorageLike, WebSocketLike } from "../../bridge/bridgeClient";

const RUN_ID = "run_coupang_ws";
const ANNOUNCEMENT = {
  type: "aw_session",
  carrier: AW_CARRIER_ISSUANCE,
  transportVersion: ACTION_WINDOW_TRANSPORT_VERSION,
  runId: RUN_ID,
  channelCode: "coupang",
};

/** A minimal but contract-shaped v2 issuance view for a coupang run. */
function coupangView(over: Partial<ActionWindowRunView> = {}): ActionWindowRunView {
  return {
    protocolVersion: 2,
    runId: RUN_ID,
    revision: 5,
    channelCode: "coupang",
    runCopyKey: "actionWindow.coupangIssuance.run",
    status: "WAITING_FOR_HUMAN",
    executionMode: "ACTION_WINDOW",
    intent: "API_ISSUANCE_GUIDANCE",
    currentStep: {
      stepId: "aw.coupang_issuance_self_dev",
      stepNumber: 2,
      totalSteps: 7,
      copyKey: "actionWindow.coupangIssuance.selfDev",
      status: "AWAITING_USER",
    },
    guidanceEnabled: true,
    allowedCommands: ["REQUEST_STEP_RECHECK", "CANCEL_RUN"],
    progress: { completedSteps: 1, totalSteps: 7 },
    updatedAt: "2026-08-07T00:00:00.000Z",
    ...over,
  };
}

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
  receive(msg: unknown): void {
    this.onmessage?.({ data: typeof msg === "string" ? msg : JSON.stringify(msg) });
  }
  drop(): void {
    this.onclose?.();
  }
}

function makeStorage(withToken = true): StorageLike {
  const map = new Map<string, string>(withToken ? [["sellerops_bridge_token", "tok-1"]] : []);
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
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
      expectedCarrier: AW_CARRIER_ISSUANCE,
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

async function until<T>(get: () => T | undefined | null | false, timeoutMs = 2000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = get();
    if (v) return v as T;
    if (Date.now() - start > timeoutMs) throw new Error("until: condition not met in time");
    await new Promise((r) => setTimeout(r, 5));
  }
}

async function connected(h: Harness) {
  const pending = connectAwBridgeSession(h.deps);
  const ws = await until(() => h.sockets[0]);
  ws.receive({ type: "hello", protocolVersion: 1 }); // status-channel noise — ignored
  ws.receive(ANNOUNCEMENT);
  const result = await pending;
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("unreachable: session expected");
  return { session: result.session, ws };
}

describe("Coupang issuance over the bridge-WS transport (issuance carrier)", () => {
  it("refuses as `unpaired` when no bridge token is stored — no agent call, no socket", async () => {
    const h = harness({ withToken: false });
    expect(await connectAwBridgeSession(h.deps)).toEqual({ ok: false, reason: "unpaired" });
    expect(h.ticketCalls).toBe(0);
    expect(h.sockets).toHaveLength(0);
  });

  it("refuses as `ticket-rejected` when the stored token is wrong/expired (ws-ticket 401)", async () => {
    const h = harness({ ticketStatus: 401 });
    expect(await connectAwBridgeSession(h.deps)).toEqual({ ok: false, reason: "ticket-rejected" });
    expect(h.sockets).toHaveLength(0);
  });

  it("ASKS the resident helper for the Coupang walk on open (`aw_attach` issuance/coupang), then attaches on its announcement; re-asks on reconnect", async () => {
    const h = harness();
    h.deps = { ...h.deps, attachChannelCode: "coupang" };
    const pending = connectAwBridgeSession(h.deps);
    const ws = await until(() => h.sockets[0]);
    expect(ws.sent).toHaveLength(0); // nothing before the socket is open
    ws.onopen?.();
    expect(ws.sent.map((s) => JSON.parse(s))).toEqual([{ type: "aw_attach", carrier: AW_CARRIER_ISSUANCE, channelCode: "coupang" }]);
    ws.receive(ANNOUNCEMENT);
    const result = await pending;
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    // The drop → a fresh socket asks again before the resync.
    ws.drop();
    const ws2 = await until(() => h.sockets[1]);
    ws2.onopen?.();
    expect(JSON.parse(ws2.sent[0]!)).toEqual({ type: "aw_attach", carrier: AW_CARRIER_ISSUANCE, channelCode: "coupang" });
    result.session.close();
  });

  it("sends NO attach request when no channel was asked for (byte-identical legacy handshake)", async () => {
    const h = harness();
    const { ws } = await connected(h);
    ws.onopen?.();
    expect(ws.sent).toHaveLength(0);
  });

  it("attaches to an ISSUANCE-carrier agent announcing channelCode coupang", async () => {
    const h = harness();
    const { session } = await connected(h);
    expect(session.runId).toBe(RUN_ID);
    expect(session.channelCode).toBe("coupang");
  });

  it("REFUSES an export/reply-carrier agent for the issuance-declared walkthrough (never mis-attach)", async () => {
    for (const carrier of ["export", "reply"]) {
      const h = harness();
      const pending = connectAwBridgeSession(h.deps);
      const ws = await until(() => h.sockets[0]);
      ws.receive({ ...ANNOUNCEMENT, carrier });
      expect(await pending).toEqual({ ok: false, reason: "carrier-mismatch", announcedCarrier: carrier });
      expect(ws.closedByClient).toBe(true);
    }
  });

  it("frames START_RUN / REQUEST_STEP_RECHECK outbound and unwraps aw_view inbound as opaque v2 carriers", async () => {
    const h = harness();
    const { session, ws } = await connected(h);

    // Outbound: a v2 issuance START_RUN rides inside {type:"aw", payload}.
    session.transport.send({
      kind: "aw_command",
      command: {
        protocolVersion: 2,
        commandId: "c1",
        runId: RUN_ID,
        expectedRevision: 0,
        type: "START_RUN",
        payload: { channelCode: "coupang", intent: "API_ISSUANCE_GUIDANCE" },
      },
    } as never);
    const carrier = JSON.parse(ws.sent[ws.sent.length - 1]!) as { type: string; payload: string };
    expect(carrier.type).toBe("aw");
    expect(deserializeFrame(carrier.payload)).toMatchObject({ kind: "aw_command", command: { type: "START_RUN" } });

    // Inbound: a coupang aw_view is unwrapped; status-channel noise is ignored.
    const received: AwServerFrame[] = [];
    session.transport.subscribe((f) => received.push(f));
    const view = coupangView();
    ws.receive({ type: "aw", payload: serializeFrame({ kind: "aw_view", view }) });
    ws.receive({ type: "snapshot", snapshot: { connections: [] } }); // status channel — ignored
    ws.receive({ type: "aw", payload: "{malformed" }); // dropped
    expect(received).toEqual([{ kind: "aw_view", view }]);
    session.close();
  });

  it("reconnects after a drop with a FRESH single-use ticket and resyncs from zero (refresh / agent restart)", async () => {
    const h = harness();
    const { session } = await connected(h);
    expect(h.ticketCalls).toBe(1);

    h.sockets[0]!.drop();
    const ws2 = await until(() => h.sockets[1]);
    expect(h.ticketCalls).toBe(2); // a NEW ticket, same stored pairing token
    ws2.receive(ANNOUNCEMENT);
    await until(() => ws2.sent.length >= 1);
    const carrier = JSON.parse(ws2.sent[0]!) as { type: string; payload: string };
    expect(deserializeFrame(carrier.payload)).toEqual({ kind: "aw_resync", runId: RUN_ID, sinceSequence: 0 });
    session.close();
  });

  it("goes dormant instead of splicing when the agent comes back hosting a DIFFERENT run", async () => {
    const h = harness();
    const { session } = await connected(h);
    h.sockets[0]!.drop();
    const ws2 = await until(() => h.sockets[1]);
    ws2.receive({ ...ANNOUNCEMENT, runId: "run_other" });
    await until(() => ws2.closedByClient);
    expect(ws2.sent).toHaveLength(0); // never resynced into a different run
    session.close();
  });
});
