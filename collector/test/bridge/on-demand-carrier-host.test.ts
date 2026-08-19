/**
 * **The resident helper's on-demand carrier host — unit.** Idle announces nothing; an `aw_attach` for a servable
 * pair activates and announces; the same pair re-announces; another pair is ignored; release follows the
 * "seller is done with the window" rule and never fires while a tab is attached.
 */
import { describe, expect, it } from "vitest";
import type { WebSocket } from "ws";
import { OnDemandCarrierHost, type ActivatedCarrier } from "../../src/bridge/on-demand-carrier-host";
import type { AwCarrierEndpoint } from "../../src/bridge/aw-carrier";

function fakeWs(): WebSocket {
  return { readyState: 1, send: () => undefined } as unknown as WebSocket;
}

function fakeCarrier(): ActivatedCarrier & { connected: WebSocket[]; payloads: string[]; closed: number; disposed: number; settled: boolean; surface: boolean } {
  const c = {
    connected: [] as WebSocket[],
    payloads: [] as string[],
    closed: 0,
    disposed: 0,
    settled: false,
    surface: false,
    endpoint: null as unknown as AwCarrierEndpoint,
    isSettled: () => c.settled,
    isSurfaceOpen: () => c.surface,
    dispose: async () => void c.disposed++,
  };
  c.endpoint = {
    onClientConnected: (ws) => void c.connected.push(ws),
    onClientPayload: (_ws, p) => void c.payloads.push(p),
    onClientDisconnected: () => undefined,
    close: () => void c.closed++,
  };
  return c;
}

function host(carrier: ReturnType<typeof fakeCarrier>, clock: { t: number }) {
  let activations = 0;
  const h = new OnDemandCarrierHost({
    activate: (req) => (req.carrier === "issuance" && req.channelCode === "coupang" ? (activations++, carrier) : null),
    windowGraceMs: 1_000,
    pollMs: 10_000,
    setTimer: () => ({}),
    clearTimer: () => undefined,
    now: () => clock.t,
  });
  return { h, activations: () => activations };
}

describe("OnDemandCarrierHost", () => {
  it("idle: a connected socket gets no announcement and no payload is relayed; an unknown request activates nothing", () => {
    const carrier = fakeCarrier();
    const { h, activations } = host(carrier, { t: 0 });
    const ws = fakeWs();
    h.onClientConnected(ws);
    h.onClientPayload(ws, "{}");
    h.onClientAttachRequest(ws, { carrier: "import", channelCode: "naver" });
    expect(activations()).toBe(0);
    expect(carrier.connected).toHaveLength(0);
    expect(h.state()).toEqual({ active: false, carrier: null, channelCode: null, attachedClients: 0 });
  });

  it("a servable aw_attach activates ONCE, announces to every connected socket, relays payloads, and re-announces on a repeat", () => {
    const carrier = fakeCarrier();
    const { h, activations } = host(carrier, { t: 0 });
    const status = fakeWs();
    const tab = fakeWs();
    h.onClientConnected(status);
    h.onClientConnected(tab);
    h.onClientAttachRequest(tab, { carrier: "issuance", channelCode: "coupang" });
    expect(activations()).toBe(1);
    expect(carrier.connected).toEqual([status, tab]);
    expect(h.state()).toEqual({ active: true, carrier: "issuance", channelCode: "coupang", attachedClients: 1 });
    h.onClientPayload(tab, "p1");
    expect(carrier.payloads).toEqual(["p1"]);
    // A refreshed tab asks again: same carrier → re-announced to it, no second activation.
    const tab2 = fakeWs();
    h.onClientConnected(tab2);
    h.onClientAttachRequest(tab2, { carrier: "issuance", channelCode: "coupang" });
    expect(activations()).toBe(1);
    expect(carrier.connected.filter((w) => w === tab2)).toHaveLength(2); // connect + attach announce
    expect(h.state().attachedClients).toBe(2);
    // Another world asks while this one is active: one slot, ignored.
    h.onClientAttachRequest(fakeWs(), { carrier: "import", channelCode: "naver" });
    expect(h.state().carrier).toBe("issuance");
  });

  it("never releases while a tab is attached; releases at once when settled AND the window is closed", async () => {
    const carrier = fakeCarrier();
    const clock = { t: 0 };
    const { h } = host(carrier, clock);
    const tab = fakeWs();
    h.onClientConnected(tab);
    h.onClientAttachRequest(tab, { carrier: "issuance", channelCode: "coupang" });
    carrier.settled = true;
    carrier.surface = false;
    clock.t = 10 * 60_000;
    expect(await h.maybeRelease()).toBe(false); // attached → keep, no matter how long
    h.onClientDisconnected(tab);
    expect(await h.maybeRelease()).toBe(true);
    expect(carrier.disposed).toBe(1);
    expect(carrier.closed).toBe(1);
    expect(h.state().active).toBe(false);
  });

  it("settled with the window still open: keeps it for the grace (the seller is copying the key), then releases", async () => {
    const carrier = fakeCarrier();
    const clock = { t: 0 };
    const { h } = host(carrier, clock);
    const tab = fakeWs();
    h.onClientConnected(tab);
    h.onClientAttachRequest(tab, { carrier: "issuance", channelCode: "coupang" });
    carrier.settled = true;
    carrier.surface = true;
    clock.t = 100;
    h.onClientDisconnected(tab);
    clock.t = 900;
    expect(await h.maybeRelease()).toBe(false);
    // The seller closes the window themselves → released immediately.
    carrier.surface = false;
    expect(await h.maybeRelease()).toBe(true);
    expect(carrier.disposed).toBe(1);
  });

  it("abandoned mid-walk (not settled, no tab): released only after the grace", async () => {
    const carrier = fakeCarrier();
    const clock = { t: 0 };
    const { h } = host(carrier, clock);
    const tab = fakeWs();
    h.onClientConnected(tab);
    h.onClientAttachRequest(tab, { carrier: "issuance", channelCode: "coupang" });
    carrier.settled = false;
    carrier.surface = true;
    clock.t = 50;
    h.onClientDisconnected(tab);
    clock.t = 1_000;
    expect(await h.maybeRelease()).toBe(false);
    clock.t = 1_050;
    expect(await h.maybeRelease()).toBe(true);
    expect(carrier.disposed).toBe(1);
    // After release the host is idle again and a new request activates afresh.
    expect(h.state().active).toBe(false);
  });

  it("close() / disposeActive() tear the active carrier down (no window outlives the helper)", async () => {
    const carrier = fakeCarrier();
    const { h } = host(carrier, { t: 0 });
    const tab = fakeWs();
    h.onClientConnected(tab);
    h.onClientAttachRequest(tab, { carrier: "issuance", channelCode: "coupang" });
    await h.disposeActive();
    expect(carrier.disposed).toBe(1);
    expect(h.state().active).toBe(false);
    // Closed host refuses further activation.
    h.close();
    h.onClientAttachRequest(tab, { carrier: "issuance", channelCode: "coupang" });
    expect(h.state().active).toBe(false);
  });
});
