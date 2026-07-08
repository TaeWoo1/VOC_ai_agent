import { describe, it, expect } from "vitest";
import { ProjectionClient, type ProjectionWebSocketLike, type StorageLike } from "./projectionClient";
import type { DecodedFrameHeader } from "./projectionProtocol";

function fakeStorage(seed: Record<string, string> = {}): StorageLike {
  const m = new Map(Object.entries(seed));
  return { getItem: (k) => m.get(k) ?? null, removeItem: (k) => void m.delete(k) };
}

function fakeFetch(routes: Record<string, (init?: RequestInit) => { status: number; body: unknown }>) {
  return ((url: string, init?: RequestInit) => {
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) throw new TypeError("network error");
    const { status, body } = routes[key]!(init);
    return Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });
  }) as unknown as typeof fetch;
}

class FakeWs implements ProjectionWebSocketLike {
  binaryType = "";
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string | ArrayBuffer }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];
  constructor(public url: string) {}
  send(data: string) { this.sent.push(data); }
  close() { this.onclose?.(); }
  emitText(msg: unknown) { this.onmessage?.({ data: JSON.stringify(msg) }); }
  emitFrame(seq: number, dw = 1280, dh = 720, payloadLen = 50) {
    const buf = new Uint8Array(10 + payloadLen);
    const dv = new DataView(buf.buffer);
    buf[0] = 0x01; dv.setUint32(1, seq, false); dv.setUint16(5, dw, false); dv.setUint16(7, dh, false); buf[9] = 1;
    this.onmessage?.({ data: buf.buffer });
  }
  lastSent(): unknown { return this.sent.length ? JSON.parse(this.sent[this.sent.length - 1]!) : undefined; }
}

const TICKET_OK = { "/projection/ticket": () => ({ status: 200, body: { ticket: "tk", expiresInMs: 10000 } }) };

function make(opts: {
  routes?: Record<string, (init?: RequestInit) => { status: number; body: unknown }>;
  storage?: StorageLike;
  isDesktop?: boolean;
  frames?: Array<{ header: DecodedFrameHeader; len: number }>;
}) {
  let lastWs: FakeWs | null = null;
  const framesSeen: DecodedFrameHeader[] = [];
  const client = new ProjectionClient({
    httpBase: "http://127.0.0.1:47615",
    wsBase: "ws://127.0.0.1:47615",
    isDesktop: opts.isDesktop ?? true,
    fetchFn: fakeFetch(opts.routes ?? TICKET_OK),
    wsFactory: (url) => (lastWs = new FakeWs(url)),
    storage: opts.storage ?? fakeStorage({ sellerops_bridge_token: "tok" }),
    onFrame: (h) => framesSeen.push(h),
  });
  return { client, ws: () => lastWs, framesSeen };
}

async function reachActive(m: ReturnType<typeof make>) {
  await m.client.start();
  m.ws()!.emitText({ type: "hello_projection", protocolVersion: 1, capabilities: { view: true, control: true, format: "jpeg", fps: 10 } });
  m.ws()!.emitText({ type: "session_started", sessionRef: "aaaa1111bbbb2222", targetHandle: "aaaa1111bbbb2222" });
}

describe("projection client state machine", () => {
  it("shows desktop_only on a non-desktop browser", async () => {
    const m = make({ isDesktop: false });
    await m.client.start();
    expect(m.client.getState().phase).toBe("desktop_only");
  });

  it("is unpaired when no pairing token is stored", async () => {
    const m = make({ storage: fakeStorage() });
    await m.client.start();
    expect(m.client.getState().phase).toBe("unpaired");
  });

  it("reaches active with negotiated capabilities and a local-only indicator", async () => {
    const m = make({});
    await reachActive(m);
    expect(m.ws()!.url).toContain("ticket=tk");
    expect(m.client.getState().phase).toBe("active");
    expect(m.client.getState().capabilities).toMatchObject({ view: true, control: true });
    expect(m.client.getState().localOnly).toBe(true);
  });

  it("surfaces an incompatible projection version (409 and hello mismatch)", async () => {
    const m1 = make({ routes: { "/projection/ticket": () => ({ status: 409, body: { error: "incompatible_version" } }) } });
    await m1.client.start();
    expect(m1.client.getState().phase).toBe("incompatible");

    const m2 = make({});
    await m2.client.start();
    m2.ws()!.emitText({ type: "hello_projection", protocolVersion: 999, capabilities: { view: true, control: true, format: "jpeg", fps: 10 } });
    expect(m2.client.getState().phase).toBe("incompatible");
  });

  it("acquires control, holds one owner, and reflects held_by_other", async () => {
    const m = make({});
    await reachActive(m);
    m.client.requestControl();
    expect(m.client.getState().control).toBe("requesting");
    expect(m.ws()!.lastSent()).toEqual({ type: "request_control" });
    m.ws()!.emitText({ type: "control_granted", expiresInMs: 120000 });
    expect(m.client.getState().control).toBe("owned");

    // A separate broadcast that another tab holds control.
    m.ws()!.emitText({ type: "control_held_by_other" });
    expect(m.client.getState().control).toBe("held_by_other");
  });

  it("only sends input while controlling, and never sends a forbidden input", async () => {
    const m = make({});
    await reachActive(m);
    // Not controlling → refused locally, nothing sent.
    m.client.sendInput({ kind: "pointer_move", x: 0.5, y: 0.5 });
    expect(m.client.getState().lastRejection).toBe("no_control_lease");
    const before = m.ws()!.sent.length;
    // Acquire control.
    m.client.requestControl();
    m.ws()!.emitText({ type: "control_granted", expiresInMs: 120000 });
    // Forbidden input (F12) is never sent.
    m.client.sendInput({ kind: "key_down", key: "F12" });
    expect(m.client.getState().lastRejection).toBe("forbidden_input");
    // Allowed input is sent.
    m.client.sendInput({ kind: "pointer_move", x: 0.25, y: 0.75 });
    expect(m.ws()!.lastSent()).toEqual({ type: "input", input: { kind: "pointer_move", x: 0.25, y: 0.75 } });
    expect(m.ws()!.sent.length).toBeGreaterThan(before);
  });

  it("delivers frames with bounded drop-old (depth ≤ 2)", async () => {
    const m = make({});
    await reachActive(m);
    // Three frames with no render completion between them: 1 delivered, 1 pending, 1 dropped.
    m.ws()!.emitFrame(1);
    m.ws()!.emitFrame(2);
    m.ws()!.emitFrame(3);
    expect(m.framesSeen.map((f) => f.seq)).toEqual([1]);
    expect(m.client.getState().droppedFrames).toBe(1);
    // Rendering completion pumps the pending (latest) frame.
    m.client.frameRendered();
    expect(m.framesSeen.map((f) => f.seq)).toEqual([1, 3]);
  });

  it("reconnect restores view only — control resets to available, never owned", async () => {
    const m = make({});
    await reachActive(m);
    m.client.requestControl();
    m.ws()!.emitText({ type: "control_granted", expiresInMs: 120000 });
    expect(m.client.getState().control).toBe("owned");
    m.ws()!.close();
    expect(m.client.getState().phase).toBe("disconnected");
    expect(m.client.getState().control).toBe("available");
    // Reconnect.
    await reachActive(m);
    expect(m.client.getState().phase).toBe("active");
    expect(m.client.getState().control).toBe("available");
  });

  it("goes to revoked on a pairing-revoked terminal error and target_closed on target close", async () => {
    const m = make({});
    await reachActive(m);
    m.ws()!.emitText({ type: "terminal_error", reason: "pairing_revoked" });
    expect(m.client.getState().phase).toBe("revoked");

    const m2 = make({});
    await reachActive(m2);
    m2.ws()!.emitText({ type: "target_changed", targetHandle: "x", state: "closed" });
    expect(m2.client.getState().phase).toBe("target_closed");
  });

  it("announces a popup target and switches only on an explicit request", async () => {
    const m = make({});
    await reachActive(m);
    m.ws()!.emitText({ type: "target_changed", targetHandle: "cccc3333dddd4444", state: "popup_available" });
    expect(m.client.getState().popupHandle).toBe("cccc3333dddd4444");
    m.client.requestTargetSwitch();
    expect(m.ws()!.lastSent()).toEqual({ type: "request_target_switch", targetHandle: "cccc3333dddd4444" });
  });
});
