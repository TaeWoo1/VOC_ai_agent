import { describe, it, expect } from "vitest";
import { ProjectionAdapter, type CdpLike, type ScreencastFrameEvent, type AdapterFrame } from "../../src/bridge/projection-adapter";
import { PROJECTION_MAX_FRAME_BYTES } from "../../src/bridge/projection-protocol";

class FakeCdp implements CdpLike {
  sent: Array<{ method: string; params?: Record<string, unknown> }> = [];
  private handlers = new Set<(ev: ScreencastFrameEvent) => void>();
  async send(method: string, params?: Record<string, unknown>): Promise<unknown> {
    this.sent.push({ method, params });
    return {};
  }
  on(_e: "Page.screencastFrame", cb: (ev: ScreencastFrameEvent) => void): void { this.handlers.add(cb); }
  off(_e: "Page.screencastFrame", cb: (ev: ScreencastFrameEvent) => void): void { this.handlers.delete(cb); }
  async emit(ev: ScreencastFrameEvent): Promise<void> {
    await Promise.all([...this.handlers].map((h) => h(ev)));
  }
  methods(): string[] { return this.sent.map((s) => s.method); }
}

function frameEvent(bytesLen: number, deviceWidth = 1280, deviceHeight = 720): ScreencastFrameEvent {
  return { data: Buffer.alloc(bytesLen, 1).toString("base64"), metadata: { deviceWidth, deviceHeight }, sessionId: 7 };
}

function makeAdapter(cdp: CdpLike, onFrame: (f: AdapterFrame) => void, onOversizeDropped?: () => void) {
  return new ProjectionAdapter(cdp, { format: "jpeg", quality: 50, everyNthFrame: 6, maxWidth: 1280, maxHeight: 720, onFrame, onOversizeDropped });
}

describe("projection CDP adapter", () => {
  it("starts screencast idempotently and stops idempotently", async () => {
    const cdp = new FakeCdp();
    const a = makeAdapter(cdp, () => {});
    await a.start();
    await a.start(); // no-op
    expect(cdp.methods().filter((m) => m === "Page.startScreencast")).toHaveLength(1);
    expect(a.isStarted).toBe(true);
    await a.stop();
    await a.stop(); // no-op
    expect(cdp.methods().filter((m) => m === "Page.stopScreencast")).toHaveLength(1);
    expect(a.isStarted).toBe(false);
  });

  it("acks every frame and emits decoded bytes with an incrementing seq", async () => {
    const cdp = new FakeCdp();
    const frames: AdapterFrame[] = [];
    const a = makeAdapter(cdp, (f) => frames.push(f));
    await a.start();
    await cdp.emit(frameEvent(1000));
    await cdp.emit(frameEvent(1000));
    expect(cdp.methods().filter((m) => m === "Page.screencastFrameAck")).toHaveLength(2);
    expect(frames.map((f) => f.seq)).toEqual([1, 2]);
    expect(frames[0]!.bytes.length).toBe(1000);
    expect(frames[0]!.deviceWidth).toBe(1280);
  });

  it("drops an oversize frame (acked, not emitted)", async () => {
    const cdp = new FakeCdp();
    const frames: AdapterFrame[] = [];
    let oversize = 0;
    const a = makeAdapter(cdp, (f) => frames.push(f), () => { oversize++; });
    await a.start();
    await cdp.emit(frameEvent(PROJECTION_MAX_FRAME_BYTES + 10));
    expect(oversize).toBe(1);
    expect(frames).toHaveLength(0);
    expect(cdp.methods()).toContain("Page.screencastFrameAck"); // still acked to keep flow
  });

  it("rejects input when not started", async () => {
    const cdp = new FakeCdp();
    const a = makeAdapter(cdp, () => {});
    const r = await a.dispatchInput({ kind: "pointer_move", x: 0.5, y: 0.5 });
    expect(r).toEqual({ accepted: false, reason: "not_started" });
  });

  it("converts normalized input to page CSS px using the latest viewport", async () => {
    const cdp = new FakeCdp();
    const a = makeAdapter(cdp, () => {});
    await a.start();
    await cdp.emit(frameEvent(100, 1280, 720)); // sets viewport
    cdp.sent.length = 0;
    const r = await a.dispatchInput({ kind: "pointer_down", x: 0.5, y: 0.5, button: "left" });
    expect(r).toEqual({ accepted: true });
    const mouse = cdp.sent.find((s) => s.method === "Input.dispatchMouseEvent");
    expect(mouse?.params).toMatchObject({ type: "mousePressed", x: 640, y: 360, button: "left" });
  });

  it("rejects a forbidden input without dispatching to CDP", async () => {
    const cdp = new FakeCdp();
    const a = makeAdapter(cdp, () => {});
    await a.start();
    cdp.sent.length = 0;
    const r = await a.dispatchInput({ kind: "text", text: "a\tb" });
    expect(r.accepted).toBe(false);
    expect(cdp.sent.find((s) => s.method === "Input.insertText")).toBeUndefined();
  });

  it("dispatches reviewed text via Input.insertText", async () => {
    const cdp = new FakeCdp();
    const a = makeAdapter(cdp, () => {});
    await a.start();
    const r = await a.dispatchInput({ kind: "text", text: "sellerops" });
    expect(r.accepted).toBe(true);
    expect(cdp.sent.find((s) => s.method === "Input.insertText")?.params).toEqual({ text: "sellerops" });
  });
});
