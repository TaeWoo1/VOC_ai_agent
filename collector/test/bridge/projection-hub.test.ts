import { describe, it, expect } from "vitest";
import { ProjectionHub, type ProjectionSource, type ViewerSink } from "../../src/bridge/projection-hub";
import { ProjectionRegistry } from "../../src/bridge/projection-session";
import type { AdapterFrame } from "../../src/bridge/projection-adapter";
import type { ProjectionCapabilities, ProjectionServerMessage } from "../../src/bridge/projection-protocol";
import { decodeFrameHeader } from "../../src/bridge/projection-protocol";
import { fixedClock } from "./helpers";

const CAPS: ProjectionCapabilities = { view: true, control: true, format: "jpeg", fps: 10 };

class FakeSource implements ProjectionSource {
  started = false;
  inputs: unknown[] = [];
  accept = true;
  starts = 0;
  stops = 0;
  get isStarted(): boolean { return this.started; }
  get viewport(): { width: number; height: number } { return { width: 1280, height: 720 }; }
  async start(): Promise<void> { this.started = true; this.starts++; }
  async stop(): Promise<void> { this.started = false; this.stops++; }
  async dispatchInput(input: unknown): Promise<{ accepted: boolean; reason?: string }> {
    this.inputs.push(input);
    return this.accept ? { accepted: true } : { accepted: false, reason: "forbidden_input" };
  }
}

class FakeSink implements ViewerSink {
  texts: ProjectionServerMessage[] = [];
  frames: Buffer[] = [];
  pendingFlush: Array<() => void> = [];
  closed = false;
  autoFlush = true;
  sendText(json: string): void { this.texts.push(JSON.parse(json) as ProjectionServerMessage); }
  sendFrame(frame: Buffer, onFlushed: () => void): void {
    this.frames.push(frame);
    if (this.autoFlush) onFlushed(); else this.pendingFlush.push(onFlushed);
  }
  close(): void { this.closed = true; }
  types(): string[] { return this.texts.map((t) => t.type); }
  last(): ProjectionServerMessage | undefined { return this.texts[this.texts.length - 1]; }
}

function makeHub(leaseIdleMs = 120_000) {
  const clock = fixedClock();
  const reg = new ProjectionRegistry({ now: clock.now, leaseIdleMs });
  const source = new FakeSource();
  const switched: string[] = [];
  const hub = new ProjectionHub({ registry: reg, source, capabilities: CAPS, initialTargetHandle: "aaaa1111bbbb2222", onTargetSwitchRequested: (h) => switched.push(h) });
  return { hub, reg, source, clock, switched };
}

describe("projection hub", () => {
  it("starts the source on the first viewer and stops on the last", async () => {
    const { hub, source } = makeHub();
    const s1 = new FakeSink(); const s2 = new FakeSink();
    await hub.addViewer("A", "pair", s1);
    expect(source.starts).toBe(1);
    await hub.addViewer("B", "pair", s2);
    expect(source.starts).toBe(1); // still one active projection
    expect(s1.types()).toContain("hello_projection");
    expect(s1.types()).toContain("session_started");
    await hub.removeViewer("A");
    expect(source.stops).toBe(0);
    await hub.removeViewer("B");
    expect(source.stops).toBe(1);
  });

  it("grants control to one owner and refuses a foreign takeover", async () => {
    const { hub } = makeHub();
    const a = new FakeSink(); const b = new FakeSink();
    await hub.addViewer("A", "pair", a);
    await hub.addViewer("B", "pair", b);
    await hub.onClientMessage("A", { type: "request_control" });
    expect(a.last()).toEqual({ type: "control_granted", expiresInMs: 120_000 });
    expect(b.types()).toContain("control_held_by_other");
    await hub.onClientMessage("B", { type: "request_control" });
    expect(b.last()).toEqual({ type: "control_held_by_other" });
  });

  it("accepts input only from the control owner and renews the lease", async () => {
    const { hub, source, reg, clock } = makeHub(10_000);
    const a = new FakeSink(); const b = new FakeSink();
    await hub.addViewer("A", "pair", a);
    await hub.addViewer("B", "pair", b);
    await hub.onClientMessage("A", { type: "request_control" });
    clock.advance(9_000);
    await hub.onClientMessage("A", { type: "input", input: { kind: "pointer_move", x: 0.5, y: 0.5 } });
    expect(a.last()).toEqual({ type: "input_accepted" });
    expect(source.inputs).toHaveLength(1);
    clock.advance(9_000); // would have expired without the renew above
    expect(reg.hasControl("A")).toBe(true);
    await hub.onClientMessage("B", { type: "input", input: { kind: "pointer_move", x: 0.5, y: 0.5 } });
    expect(b.last()).toEqual({ type: "input_rejected", reason: "no_control_lease" });
  });

  it("emits control_lost(expired) on idle lease expiry via tick", async () => {
    const { hub, clock } = makeHub(120_000);
    const a = new FakeSink();
    await hub.addViewer("A", "pair", a);
    await hub.onClientMessage("A", { type: "request_control" });
    clock.advance(120_001);
    hub.tick();
    expect(a.types()).toContain("control_lost");
    expect((a.texts.find((t) => t.type === "control_lost") as { reason: string }).reason).toBe("expired");
  });

  it("releases control on disconnect and lets another take it (reconnect restores view only)", async () => {
    const { hub, reg } = makeHub();
    const a = new FakeSink(); const b = new FakeSink();
    await hub.addViewer("A", "pair", a);
    await hub.addViewer("B", "pair", b);
    await hub.onClientMessage("A", { type: "request_control" });
    await hub.removeViewer("A"); // A disconnects
    expect(reg.controlOwner()).toBeNull();
    // A "reconnects" as a fresh connection — gets view, NOT control.
    const a2 = new FakeSink();
    await hub.addViewer("A2", "pair", a2);
    expect(a2.types()).toContain("control_available");
    expect(a2.types()).not.toContain("control_granted");
  });

  it("bounds the per-viewer queue at depth 2 and drops old frames", async () => {
    const { hub } = makeHub();
    const s = new FakeSink(); s.autoFlush = false;
    await hub.addViewer("A", "pair", s);
    for (let seq = 1; seq <= 5; seq++) {
      const f: AdapterFrame = { seq, bytes: Buffer.from([seq]), deviceWidth: 1280, deviceHeight: 720 };
      hub.broadcastFrame(f);
    }
    // first frame is in-flight; queue holds at most 2; the rest are drop-old.
    expect(s.frames).toHaveLength(1);
    const stats = hub.dropStats();
    expect(stats.maxQueueDepth).toBeLessThanOrEqual(2);
    expect(stats.totalDrops).toBe(2);
    // draining releases the newest retained frames in order
    s.pendingFlush.shift()!();
    expect(s.frames.length).toBeGreaterThan(1);
    const hdr = decodeFrameHeader(s.frames[0]!);
    expect(hdr).not.toBeNull();
    expect(hdr!.deviceWidth).toBe(1280);
  });

  it("requires an explicit action to switch to an announced popup target", async () => {
    const { hub, switched } = makeHub();
    const a = new FakeSink();
    await hub.addViewer("A", "pair", a);
    hub.announcePopup("cccc3333dddd4444");
    expect(a.texts.find((t) => t.type === "target_changed")).toMatchObject({ state: "popup_available" });
    await hub.onClientMessage("A", { type: "request_target_switch", targetHandle: "cccc3333dddd4444" });
    expect(switched).toEqual(["cccc3333dddd4444"]);
    expect(a.last()).toMatchObject({ type: "target_changed", state: "active" });
  });

  it("pairing revocation stops frames+input and closes that pairing's viewers", async () => {
    const { hub, source } = makeHub();
    const a = new FakeSink();
    await hub.addViewer("A", "pair", a);
    await hub.onClientMessage("A", { type: "request_control" });
    await hub.revokePairing("pair");
    expect(a.types()).toContain("terminal_error");
    expect(a.closed).toBe(true);
    expect(source.stops).toBe(1);
    // input after revocation is impossible — the viewer is gone.
    await hub.onClientMessage("A", { type: "input", input: { kind: "pointer_move", x: 0.1, y: 0.1 } });
    expect(source.inputs).toHaveLength(0);
  });

  it("stopAll terminates viewers and the source (agent shutdown)", async () => {
    const { hub, source } = makeHub();
    const a = new FakeSink();
    await hub.addViewer("A", "pair", a);
    await hub.stopAll("agent_restart");
    expect(a.types()).toContain("stopped");
    expect(a.closed).toBe(true);
    expect(source.stops).toBe(1);
  });
});
