import { describe, it, expect } from "vitest";
import { BridgeClient, type StorageLike, type WebSocketLike } from "./bridgeClient";

function fakeStorage(seed: Record<string, string> = {}): StorageLike {
  const m = new Map(Object.entries(seed));
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

/** Build a fetch-like fn routing by URL substring; each route is a (init) => {status, body}. */
function fakeFetch(routes: Record<string, (init?: RequestInit) => { status: number; body: unknown }>) {
  return ((url: string, init?: RequestInit) => {
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) throw new TypeError("network error");
    const { status, body } = routes[key]!(init);
    return Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });
  }) as unknown as typeof fetch;
}

class FakeWs implements WebSocketLike {
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];
  closed = false;
  constructor(public url: string) {}
  send(data: string) { this.sent.push(data); }
  close() { this.closed = true; this.onclose?.(); }
  emit(msg: unknown) { this.onmessage?.({ data: JSON.stringify(msg) }); }
}

function make(opts: {
  routes: Record<string, (init?: RequestInit) => { status: number; body: unknown }>;
  storage?: StorageLike;
  secureNonLoopback?: boolean;
}) {
  let lastWs: FakeWs | null = null;
  const client = new BridgeClient({
    httpBase: "http://127.0.0.1:47615",
    wsBase: "ws://127.0.0.1:47615",
    workspaceLabel: "테스트",
    isSecureNonLoopbackOrigin: opts.secureNonLoopback ?? false,
    fetchFn: fakeFetch(opts.routes),
    wsFactory: (url) => (lastWs = new FakeWs(url)),
    storage: opts.storage ?? fakeStorage(),
  });
  return { client, ws: () => lastWs };
}

const HEALTH_OK = { "/bridge/health": () => ({ status: 200, body: { ok: true, service: "sellerops-local-agent", agentVersion: "t", protocolVersion: 1 } }) };

describe("bridge client state machine", () => {
  it("reports unreachable when the agent is absent (+ LNA hint on a deployed origin)", async () => {
    const { client } = make({ routes: {}, secureNonLoopback: true });
    await client.refresh();
    expect(client.getState().phase).toBe("unreachable");
    expect(client.getState().maybeNeedsLocalNetworkAccess).toBe(true);
  });

  it("does not show the LNA hint on a loopback (dev) origin", async () => {
    const { client } = make({ routes: {}, secureNonLoopback: false });
    await client.refresh();
    expect(client.getState().maybeNeedsLocalNetworkAccess).toBe(false);
  });

  it("clears a stale LNA hint once health recovers (it must not linger into a reachable state)", async () => {
    // A mutable route table: unreachable first (LNA hint set on a deployed origin), then the agent comes back.
    const routes: Record<string, () => { status: number; body: unknown }> = {};
    const { client } = make({ routes, secureNonLoopback: true });
    await client.refresh();
    expect(client.getState()).toMatchObject({ phase: "unreachable", maybeNeedsLocalNetworkAccess: true });

    // Health now succeeds (no token → unpaired). The hint must reset — LNA is provably not the blocker anymore.
    Object.assign(routes, HEALTH_OK);
    await client.refresh();
    expect(client.getState().phase).toBe("unpaired");
    expect(client.getState().maybeNeedsLocalNetworkAccess).toBe(false);
  });

  it("is unpaired when the agent is reachable but no token is stored", async () => {
    const { client } = make({ routes: HEALTH_OK });
    await client.refresh();
    expect(client.getState().phase).toBe("unpaired");
  });

  it("runs the full pairing flow and reaches paired on snapshot", async () => {
    const { client, ws } = make({
      routes: {
        ...HEALTH_OK,
        "/bridge/pair/request": () => ({ status: 200, body: { requestId: "r1", confirmationCode: "ABC-123" } }),
        "/bridge/pair/poll": () => ({ status: 200, body: { status: "paired", pairingToken: "tok" } }),
        "/bridge/ws-ticket": () => ({ status: 200, body: { ticket: "tk", expiresInMs: 10000 } }),
      },
    });
    await client.requestPairing();
    expect(client.getState().phase).toBe("pairing_pending");
    expect(client.getState().confirmationCode).toBe("ABC-123");

    await client.pollPairingOnce();
    expect(ws()!.url).toContain("ticket=tk");
    ws()!.emit({ type: "hello", protocolVersion: 1, agentVersion: "t", capabilities: [] });
    ws()!.emit({ type: "snapshot", snapshot: { agentVersion: "t", protocolVersion: 1, capabilities: [], connections: [] } });
    expect(client.getState().phase).toBe("paired");
  });

  it("records the agent's supported event categories from the hello (capability negotiation)", async () => {
    const { client, ws } = make({
      routes: { ...HEALTH_OK, "/bridge/ws-ticket": () => ({ status: 200, body: { ticket: "tk" } }) },
      storage: fakeStorage({ sellerops_bridge_token: "tok" }),
    });
    await client.refresh();
    ws()!.emit({ type: "hello", protocolVersion: 1, agentVersion: "t", capabilities: [], supportedEvents: ["connection_lifecycle", "agent_lifecycle"] });
    expect(client.getState().supportedEvents).toEqual(["connection_lifecycle", "agent_lifecycle"]);
  });

  it("surfaces pairing denial", async () => {
    const { client } = make({
      routes: {
        ...HEALTH_OK,
        "/bridge/pair/request": () => ({ status: 200, body: { requestId: "r1", confirmationCode: "X-Y" } }),
        "/bridge/pair/poll": () => ({ status: 200, body: { status: "denied" } }),
      },
    });
    await client.requestPairing();
    await client.pollPairingOnce();
    expect(client.getState().phase).toBe("pairing_denied");
  });

  it("surfaces an incompatible protocol version at ticket mint", async () => {
    const { client } = make({
      routes: {
        ...HEALTH_OK,
        "/bridge/ws-ticket": () => ({ status: 409, body: { error: "incompatible_version", agentProtocolVersion: 2 } }),
      },
      storage: fakeStorage({ sellerops_bridge_token: "tok" }),
    });
    await client.refresh();
    expect(client.getState().phase).toBe("incompatible_version");
    expect(client.getState().agentProtocolVersion).toBe(2);
  });

  it("treats a 401 ticket mint as revoked and clears the token", async () => {
    const storage = fakeStorage({ sellerops_bridge_token: "tok" });
    const { client } = make({
      routes: { ...HEALTH_OK, "/bridge/ws-ticket": () => ({ status: 401, body: { error: "unpaired" } }) },
      storage,
    });
    await client.refresh();
    expect(client.getState().phase).toBe("revoked");
    expect(storage.getItem("sellerops_bridge_token")).toBeNull();
  });

  it("reconnects after refresh and restores the snapshot", async () => {
    const { client, ws } = make({
      routes: { ...HEALTH_OK, "/bridge/ws-ticket": () => ({ status: 200, body: { ticket: "tk" } }) },
      storage: fakeStorage({ sellerops_bridge_token: "tok" }),
    });
    await client.refresh(); // fresh mount with a stored token → reconnect
    ws()!.emit({ type: "snapshot", snapshot: { agentVersion: "t", protocolVersion: 1, capabilities: [], connections: [{ ref: "aaaa1111bbbb2222", state: "ready", pendingUserAction: null, browserOpen: false }] } });
    expect(client.getState().phase).toBe("paired");
    expect(client.getState().snapshot?.connections[0]?.ref).toBe("aaaa1111bbbb2222");
  });

  it("goes to disconnected when the socket drops while paired", async () => {
    const { client, ws } = make({
      routes: { ...HEALTH_OK, "/bridge/ws-ticket": () => ({ status: 200, body: { ticket: "tk" } }) },
      storage: fakeStorage({ sellerops_bridge_token: "tok" }),
    });
    await client.refresh();
    ws()!.emit({ type: "snapshot", snapshot: { agentVersion: "t", protocolVersion: 1, capabilities: [], connections: [] } });
    expect(client.getState().phase).toBe("paired");
    ws()!.onclose?.();
    expect(client.getState().phase).toBe("disconnected");
  });

  it("applies a live connection_lifecycle event onto the snapshot", async () => {
    const { client, ws } = make({
      routes: { ...HEALTH_OK, "/bridge/ws-ticket": () => ({ status: 200, body: { ticket: "tk" } }) },
      storage: fakeStorage({ sellerops_bridge_token: "tok" }),
    });
    await client.refresh();
    ws()!.emit({ type: "snapshot", snapshot: { agentVersion: "t", protocolVersion: 1, capabilities: [], connections: [] } });
    ws()!.emit({ type: "event", category: "connection_lifecycle", ref: "ref00001111", payload: { state: "syncing" } });
    expect(client.getState().snapshot?.connections.find((c) => c.ref === "ref00001111")?.state).toBe("syncing");
  });

  it("revoke clears the token and returns to unpaired", async () => {
    const storage = fakeStorage({ sellerops_bridge_token: "tok" });
    const { client } = make({
      routes: { ...HEALTH_OK, "/bridge/ws-ticket": () => ({ status: 200, body: { ticket: "tk" } }), "/bridge/revoke": () => ({ status: 200, body: { ok: true } }) },
      storage,
    });
    await client.refresh();
    await client.revoke();
    expect(client.getState().phase).toBe("unpaired");
    expect(storage.getItem("sellerops_bridge_token")).toBeNull();
  });
});
