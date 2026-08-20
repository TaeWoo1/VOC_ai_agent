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
  /** Default false in tests: most of these exercise DETECTION, and an automatic pairing attempt would
   *  otherwise reach into a route table that is deliberately not serving one. The auto-pair behaviour has
   *  its own describe block below, where it is turned on explicitly. */
  autoPair?: boolean;
  visible?: boolean;
}) {
  let lastWs: FakeWs | null = null;
  const opened: string[] = [];
  const client = new BridgeClient({
    httpBase: "http://127.0.0.1:47615",
    wsBase: "ws://127.0.0.1:47615",
    workspaceLabel: "테스트",
    isSecureNonLoopbackOrigin: opts.secureNonLoopback ?? false,
    fetchFn: fakeFetch(opts.routes),
    openConfirmation: (url) => opened.push(url),
    wsFactory: (url) => (lastWs = new FakeWs(url)),
    storage: opts.storage ?? fakeStorage(),
    autoPair: opts.autoPair ?? false,
    isVisible: () => opts.visible ?? true,
  });
  return { client, ws: () => lastWs, opened };
}

const CONFIRM_URL = "http://127.0.0.1:47615/bridge/confirm?requestId=r1";

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

/**
 * The agent's approval page is where the seller actually allows the pairing. Until this was wired, the URL
 * came back in the pair/request response and went nowhere — reachable only by reading it out of a developer
 * console, which is the developer path this product path replaces.
 */
describe("the agent's approval page", () => {
  const pendingRoutes = (confirmUrl?: string) => ({
    ...HEALTH_OK,
    "/bridge/pair/request": () => ({
      status: 200,
      body: { requestId: "r1", confirmationCode: "ABC-123", ...(confirmUrl ? { confirmUrl } : {}) },
    }),
    "/bridge/pair/poll": () => ({ status: 200, body: { status: "pending" } }),
  });

  it("is opened on the seller's own pairing click and exposed for a blocked pop-up", async () => {
    const { client, opened } = make({ routes: pendingRoutes(CONFIRM_URL) });
    await client.requestPairing();
    expect(opened).toEqual([CONFIRM_URL]);
    expect(client.getState().confirmUrl).toBe(CONFIRM_URL);
  });

  it("refuses a URL that is not this agent's confirm endpoint", async () => {
    for (const hostile of [
      "http://evil.example/bridge/confirm?requestId=r1",
      "http://127.0.0.1:1234/bridge/confirm?requestId=r1",
      "javascript:alert(1)",
      "http://127.0.0.1:47615/bridge/confirm.evil?requestId=r1",
      "http://127.0.0.1:47615/../bridge/confirm?requestId=r1",
    ]) {
      const { client, opened } = make({ routes: pendingRoutes(hostile) });
      await client.requestPairing();
      // Nothing is opened and nothing is offered — the pairing still works, it just never navigates the seller
      // somewhere this client cannot vouch for.
      expect(opened, `must not open ${hostile}`).toEqual([]);
      expect(client.getState().confirmUrl).toBeUndefined();
      expect(client.getState().phase).toBe("pairing_pending");
    }
  });

  it("still pairs when the agent returns no confirm URL at all", async () => {
    const { client, opened } = make({ routes: pendingRoutes() });
    await client.requestPairing();
    expect(opened).toEqual([]);
    expect(client.getState().phase).toBe("pairing_pending");
    expect(client.getState().confirmUrl).toBeUndefined();
  });

  it("drops the URL once the request settles — a dead page reads as a broken pairing", async () => {
    for (const status of ["paired", "denied", "expired"] as const) {
      const { client } = make({
        routes: {
          ...HEALTH_OK,
          "/bridge/pair/request": () => ({
            status: 200,
            body: { requestId: "r1", confirmationCode: "ABC-123", confirmUrl: CONFIRM_URL },
          }),
          "/bridge/pair/poll": () => ({
            status: 200,
            body: status === "paired" ? { status, pairingToken: "tok" } : { status },
          }),
          "/bridge/ws-ticket": () => ({ status: 200, body: { ticket: "tk", expiresInMs: 10000 } }),
        },
      });
      await client.requestPairing();
      expect(client.getState().confirmUrl).toBe(CONFIRM_URL);
      await client.pollPairingOnce();
      expect(client.getState().confirmUrl, `stale after ${status}`).toBeUndefined();
    }
  });
});

/**
 * **The production macOS path**: the agent asks the human in its own native window, and the browser never
 * shows a code. These tests pin the two halves that make that safe to ship — the client must not send the
 * seller to a code screen that has nothing to type into, and it must not be able to raise OS dialogs in a
 * loop or from a tab nobody is looking at.
 */
describe("attested approval — the seller answers on their Mac, not in the browser", () => {
  const ATTESTED = {
    "/bridge/pair/request": () => ({ status: 200, body: { requestId: "r1", attested: true } }),
    "/bridge/pair/poll": () => ({ status: 200, body: { status: "paired", pairingToken: "tok" } }),
    "/bridge/ws-ticket": () => ({ status: 200, body: { ticket: "tk", expiresInMs: 10000 } }),
  };

  it("shows no code and opens no confirmation page — the approval already happened", async () => {
    const { client, opened } = make({ routes: { ...HEALTH_OK, ...ATTESTED } });
    await client.requestPairing();

    expect(opened).toEqual([]); // no tab was sent anywhere
    const s = client.getState();
    expect(s.confirmationCode).toBeUndefined();
    expect(s.confirmUrl).toBeUndefined();
  });

  it("collects the token immediately — one seller action, no polling wait", async () => {
    const storage = fakeStorage();
    const { client, ws } = make({ routes: { ...HEALTH_OK, ...ATTESTED }, storage });
    await client.requestPairing();

    expect(storage.getItem("sellerops_bridge_token")).toBe("tok");
    expect(ws()).not.toBeNull(); // it went straight on to the socket
  });

  it("is already pairing_pending while the dialog is still on screen — the page is never blank", async () => {
    // The agent holds this response open for as long as the dialog waits (up to 90s). If the client only set
    // `pairing_pending` on the RESPONSE, the seller would sit on an unchanged screen for a minute and a half
    // while a window waited for them on their own Mac. So the state is set before the request goes out.
    let answer: ((v: { status: number; body: unknown }) => void) | null = null;
    const held = new Promise<{ status: number; body: unknown }>((r) => (answer = r));
    const fetchFn = ((url: string) => {
      if (url.includes("/bridge/pair/request")) {
        return held.then((r) => ({ ok: true, status: r.status, json: async () => r.body }));
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ status: "pending" }) });
    }) as unknown as typeof fetch;

    const client = new BridgeClient({
      httpBase: "http://127.0.0.1:47615",
      wsBase: "ws://127.0.0.1:47615",
      workspaceLabel: "테스트",
      isSecureNonLoopbackOrigin: false,
      fetchFn,
      openConfirmation: () => undefined,
      wsFactory: (url) => new FakeWs(url),
      storage: fakeStorage(),
      autoPair: false,
    });

    const pending = client.requestPairing();
    // The dialog has NOT been answered yet, and the screen already says so.
    expect(client.getState().phase).toBe("pairing_pending");
    expect(client.getState().confirmationCode).toBeUndefined();

    answer!({ status: 200, body: { requestId: "r1", attested: true } });
    await pending;
  });

  it("a refusal is reported as a REFUSAL, not as a missing helper", async () => {
    const { client } = make({
      routes: { ...HEALTH_OK, "/bridge/pair/request": () => ({ status: 403, body: { error: "approval_declined" } }) },
    });
    await client.requestPairing();
    expect(client.getState().phase).toBe("pairing_denied");
  });

  it("an unanswered dialog goes back to unpaired WITH a reason — the helper is demonstrably running", async () => {
    // `unreachable` here would tell the seller to go start a helper that just put a window on their screen.
    const { client } = make({
      routes: { ...HEALTH_OK, "/bridge/pair/request": () => ({ status: 503, body: { error: "approval_no_response" } }) },
    });
    await client.requestPairing();
    expect(client.getState()).toMatchObject({ phase: "unpaired", pairingHint: "no_response" });
  });

  it("an agent that cannot ask anyone is still reported as unreachable", async () => {
    const { client } = make({
      routes: { ...HEALTH_OK, "/bridge/pair/request": () => ({ status: 503, body: { error: "approval_unavailable" } }) },
    });
    await client.requestPairing();
    expect(client.getState().phase).toBe("unreachable");
  });
});

describe("automatic pairing is bounded — an OS dialog must never arrive in a loop", () => {
  let requests = 0;
  const routes = () => ({
    ...HEALTH_OK,
    "/bridge/pair/request": () => {
      requests += 1;
      return { status: 503, body: { error: "approval_no_response" } };
    },
  });

  it("asks once, automatically, when it finds an unpaired agent", async () => {
    requests = 0;
    const { client } = make({ routes: routes(), autoPair: true });
    await client.refresh();
    expect(requests).toBe(1);
  });

  it("never asks a second time, however many times it re-detects the agent", async () => {
    // `useBridge` re-polls every 1.5s. Without this bound, a seller who ignored one dialog would get one
    // every poll for as long as the tab stays open.
    requests = 0;
    const { client } = make({ routes: routes(), autoPair: true });
    await client.refresh();
    await client.refresh();
    await client.refresh();
    expect(requests).toBe(1);
  });

  it("never asks from a tab the seller is not looking at", async () => {
    // A dialog with no visible context is indistinguishable from malware.
    requests = 0;
    const { client } = make({ routes: routes(), autoPair: true, visible: false });
    await client.refresh();
    expect(requests).toBe(0);
  });

  it("does not ask at all when a pairing token is already stored", async () => {
    // The whole point of persistence: a returning seller sees no approval UI of any kind.
    requests = 0;
    const storage = fakeStorage({ sellerops_bridge_token: "tok" });
    const { client } = make({
      routes: { ...routes(), "/bridge/ws-ticket": () => ({ status: 200, body: { ticket: "tk", expiresInMs: 1 } }) },
      storage,
      autoPair: true,
    });
    await client.refresh();
    expect(requests).toBe(0);
    expect(client.getState().phase).not.toBe("pairing_pending");
  });
});
