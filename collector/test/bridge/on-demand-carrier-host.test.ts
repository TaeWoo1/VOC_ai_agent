/**
 * **The resident helper's on-demand carrier host — unit.** Idle announces nothing; an `aw_attach` for a servable
 * pair activates and announces; the same pair re-announces; another pair is ignored; release follows the
 * "seller is done with the window" rule and never fires while a tab is attached.
 */
import { describe, expect, it } from "vitest";
import type { WebSocket } from "ws";
import { OnDemandCarrierHost, type ActivatedCarrier } from "../../src/bridge/on-demand-carrier-host";
import type { AwCarrierEndpoint } from "../../src/bridge/aw-carrier";

/** Let the handover's `release().then(activate)` chain settle — it is sequenced, so it spans several turns. */
async function flush(): Promise<void> {
  for (let i = 0; i < 8; i++) await new Promise<void>((r) => setTimeout(r, 0));
}

function fakeWs(): WebSocket {
  return { readyState: 1, send: () => undefined } as unknown as WebSocket;
}

function fakeCarrier(): ActivatedCarrier & { connected: WebSocket[]; payloads: string[]; closed: number; disposed: number; settled: boolean; surface: boolean; servesOneRun: boolean } {
  const c = {
    servesOneRun: false,
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

/** A host that can serve TWO different pairs — what a seller moving between connect screens actually meets. */
function twoCarrierHost(
  first: ReturnType<typeof fakeCarrier>,
  second: ReturnType<typeof fakeCarrier>,
  clock: { t: number },
) {
  const h = new OnDemandCarrierHost({
    activate: (req) => {
      if (req.carrier === "issuance" && req.channelCode === "coupang") return first;
      if (req.carrier === "locate" && req.channelCode === "coupang") return second;
      return null;
    },
    windowGraceMs: 1_000,
    pollMs: 10_000,
    setTimer: () => ({}),
    clearTimer: () => undefined,
    now: () => clock.t,
  });
  return h;
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
    // Another world asks while this one is BUSY and WATCHED: one slot, refused.
    h.onClientAttachRequest(fakeWs(), { carrier: "import", channelCode: "naver" });
    expect(h.state().carrier).toBe("issuance");
  });

  /**
   * **The one-run carrier is rebuilt, not re-announced** — the store-identity confirmation's whole shape.
   *
   * Live on 2026-09-13: the bootstrap run ended UNRESOLVED with a candidate and PARKED (blocker
   * `STORE_UNRESOLVED`, which is `WAITING_FOR_HUMAN` and therefore not settled), so the release rule was
   * correctly keeping it. Two seconds later the seller pressed 「이 스토어를 연결하고 리뷰 가져오기」, the
   * card remounted asking for the same carrier, and the host re-announced the parked run — whose engine
   * refuses a second `START_RUN`. The seller read 「판매자센터 화면을 준비하지 못했습니다」 twice and only
   * a helper restart got past it.
   *
   * Note what is NOT required here: the run is deliberately left un-settled, because that was the live
   * shape and because a spent single-use run does not have to reach a terminal stage to be spent.
   */
  it("a one-run carrier with no tab on it is released and rebuilt for the same pair", async () => {
    const first = fakeCarrier();
    const second = fakeCarrier();
    first.servesOneRun = true;
    second.servesOneRun = true;
    let built = 0;
    const h = new OnDemandCarrierHost({
      activate: (req) =>
        req.carrier === "acquire" && req.channelCode === "coupang" ? (built++, built === 1 ? first : second) : null,
      windowGraceMs: 1_000,
      pollMs: 10_000,
      setTimer: () => ({}),
      clearTimer: () => undefined,
      now: () => 0,
    });
    const tab = fakeWs();
    h.onClientConnected(tab);
    h.onClientAttachRequest(tab, { carrier: "acquire", channelCode: "coupang" });
    expect(built).toBe(1);

    // The card remounts: the old socket goes, a new one asks for the same pair.
    h.onClientDisconnected(tab);
    const tab2 = fakeWs();
    h.onClientConnected(tab2);
    h.onClientAttachRequest(tab2, { carrier: "acquire", channelCode: "coupang" });
    await flush();

    expect(built).toBe(2);
    // The spent run was settled and torn down BEFORE the new one was built — never two at once.
    expect(first.disposed).toBe(1);
    expect(first.closed).toBe(1);
    expect(h.state()).toEqual({ active: true, carrier: "acquire", channelCode: "coupang", attachedClients: 1 });
    expect(second.connected).toContain(tab2);
  });

  /**
   * **A spent one-run carrier says nothing to a socket that has just arrived.**
   *
   * Live on 2026-09-14, this is what turned a correct recycle into a failure on screen: the fresh socket
   * was announced the SPENT run, the frontend adopted that session and sent its `START_RUN` against it,
   * and the swap dropped the command. The tab is owed the announcement of the carrier it is about to get,
   * which arrives from `activateFor` a few milliseconds later — not the one being torn down.
   */
  it("does not announce a spent one-run carrier to a newly connected socket", async () => {
    const first = fakeCarrier();
    const second = fakeCarrier();
    first.servesOneRun = true;
    second.servesOneRun = true;
    let built = 0;
    const h = new OnDemandCarrierHost({
      activate: () => (built++, built === 1 ? first : second),
      windowGraceMs: 1_000,
      pollMs: 10_000,
      setTimer: () => ({}),
      clearTimer: () => undefined,
      now: () => 0,
    });
    const tab = fakeWs();
    h.onClientConnected(tab);
    h.onClientAttachRequest(tab, { carrier: "acquire", channelCode: "coupang" });
    h.onClientDisconnected(tab);

    const tab2 = fakeWs();
    h.onClientConnected(tab2);
    // Nothing from the carrier that is about to be replaced.
    expect(first.connected).not.toContain(tab2);

    h.onClientAttachRequest(tab2, { carrier: "acquire", channelCode: "coupang" });
    await flush();
    // …and everything from the one it actually got.
    expect(second.connected).toContain(tab2);
  });

  it("a one-run carrier with a tab still on it re-announces, exactly as before", () => {
    const carrier = fakeCarrier();
    carrier.servesOneRun = true;
    let built = 0;
    const h = new OnDemandCarrierHost({
      activate: () => (built++, carrier),
      windowGraceMs: 1_000,
      pollMs: 10_000,
      setTimer: () => ({}),
      clearTimer: () => undefined,
      now: () => 0,
    });
    const tab = fakeWs();
    h.onClientConnected(tab);
    h.onClientAttachRequest(tab, { carrier: "acquire", channelCode: "coupang" });
    // A SECOND tab of the same run, while the first is still attached: one slot, one run, re-announced.
    const tab2 = fakeWs();
    h.onClientConnected(tab2);
    h.onClientAttachRequest(tab2, { carrier: "acquire", channelCode: "coupang" });
    expect(built).toBe(1);
    expect(carrier.disposed).toBe(0);
    expect(h.state().attachedClients).toBe(2);
  });

  it("a carrier that does NOT serve one run is re-announced even with no tab on it — the key-copying return", () => {
    const carrier = fakeCarrier();
    const { h, activations } = host(carrier, { t: 0 });
    const tab = fakeWs();
    h.onClientConnected(tab);
    h.onClientAttachRequest(tab, { carrier: "issuance", channelCode: "coupang" });
    carrier.settled = true;
    carrier.surface = true;   // WING is showing the secret key
    h.onClientDisconnected(tab);
    const tab2 = fakeWs();
    h.onClientConnected(tab2);
    h.onClientAttachRequest(tab2, { carrier: "issuance", channelCode: "coupang" });
    expect(activations()).toBe(1);
    expect(carrier.disposed).toBe(0);
  });

  /**
   * **The handover** — a finished, unwatched walk gives the slot up instead of making the next screen wait.
   *
   * Live on 2026-08-20: a seller started the Coupang renewal walk, left the screen, and pressed
   * `[쿠팡에서 보기]` on 리뷰. The renewal run was settled and had no tab on it, but its WING window was still
   * open, so the release rule was correctly waiting out the grace — and the locate request was refused for the
   * whole of it. On the product default that is FIFTEEN MINUTES of "SellerOps 도우미가 지금 다른 작업을 하고
   * 있어…" from a walk the seller had already abandoned.
   */
  it("hands the slot over when the active carrier is settled and unwatched — window closed first, then the new one", async () => {
    const first = fakeCarrier();
    const second = fakeCarrier();
    const clock = { t: 0 };
    const h = twoCarrierHost(first, second, clock);
    const tab = fakeWs();
    h.onClientConnected(tab);
    h.onClientAttachRequest(tab, { carrier: "issuance", channelCode: "coupang" });
    // The walk finished and its WING window is still up — exactly the state the grace protects.
    first.settled = true;
    first.surface = true;
    h.onClientDisconnected(tab);
    expect(h.state().carrier).toBe("issuance");

    const other = fakeWs();
    h.onClientConnected(other);
    h.onClientAttachRequest(other, { carrier: "locate", channelCode: "coupang" });
    // The handover is sequenced through `release()`, so let its promise chain settle.
    await flush();

    expect(h.state().carrier).toBe("locate");
    // The previous carrier's window was CLOSED before the new one was built — two carriers must never
    // hold a browser at the same moment.
    expect(first.disposed).toBe(1);
    expect(first.closed).toBe(1);
    expect(second.connected).toContain(other);
    expect(h.state().attachedClients).toBe(1);
  });

  /**
   * **The one-slot guarantee, and now the ONLY thing that refuses.** A tab on the screen is the only
   * evidence that a human is in the middle of that walk — settled or not, watched means kept.
   */
  it("does NOT hand over while a tab is still attached — settled or mid-walk alike", async () => {
    for (const settled of [true, false]) {
      const first = fakeCarrier();
      const second = fakeCarrier();
      const h = twoCarrierHost(first, second, { t: 0 });
      const tab = fakeWs();
      h.onClientConnected(tab);
      h.onClientAttachRequest(tab, { carrier: "issuance", channelCode: "coupang" });
      first.settled = settled;
      h.onClientAttachRequest(fakeWs(), { carrier: "locate", channelCode: "coupang" });
      await flush();
      expect(h.state().carrier, `settled=${settled}`).toBe("issuance");
      expect(first.disposed, `settled=${settled}`).toBe(0);
    }
  });

  /**
   * An ABANDONED mid-walk run hands over too, and this is the case the first cut of the fix got wrong.
   *
   * Live on 2026-08-20: the seller pressed 시작 on the renewal walk (so the run was started and NOT
   * settled) and then left the screen. Gating the handover on settledness declined exactly there, and the
   * locate request was refused again. A run with no tab on it is not being driven by anyone — the frontend
   * is the only thing that sends commands — and `maybeRelease` already releases it as
   * `ABANDONED_GRACE_ELAPSED`. The handover only stops the next screen waiting out that grace.
   */
  it("hands over an ABANDONED mid-walk run — no tab means nobody is driving it", async () => {
    const first = fakeCarrier();
    const second = fakeCarrier();
    const h = twoCarrierHost(first, second, { t: 0 });
    const tab = fakeWs();
    h.onClientConnected(tab);
    h.onClientAttachRequest(tab, { carrier: "issuance", channelCode: "coupang" });
    first.settled = false; // mid-walk
    first.surface = true; // …with its marketplace window open
    h.onClientDisconnected(tab); // …and the seller's tab is gone

    h.onClientAttachRequest(fakeWs(), { carrier: "locate", channelCode: "coupang" });
    await flush();

    expect(h.state().carrier).toBe("locate");
    expect(first.disposed).toBe(1);
  });

  it("a handover to an UNSERVABLE pair releases the old one and lands idle — never a half-swapped slot", async () => {
    const first = fakeCarrier();
    const second = fakeCarrier();
    const h = twoCarrierHost(first, second, { t: 0 });
    const tab = fakeWs();
    h.onClientConnected(tab);
    h.onClientAttachRequest(tab, { carrier: "issuance", channelCode: "coupang" });
    first.settled = true;
    first.surface = true;
    h.onClientDisconnected(tab);

    h.onClientAttachRequest(fakeWs(), { carrier: "reply", channelCode: "naver" });
    await flush();

    expect(h.state().active).toBe(false);
    expect(first.disposed).toBe(1);
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
