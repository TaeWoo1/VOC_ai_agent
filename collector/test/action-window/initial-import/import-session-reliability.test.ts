/**
 * **Guided Acquisition Reliability — the session's failure parks and their recovery, offline.**
 *
 * Every one of these was a place a guided run used to go silent or freeze: the guidance pack was rejected, the
 * surface never settled, the overlay painted nothing, the window would not open, the seller closed it, or
 * PREPARE never produced a result. Each is pinned here as a VISIBLE, recoverable `SURFACE_BLOCKED` park with one
 * recovery action — and, where it applies, that a re-check re-runs PREPARE and the run proceeds.
 */
import { describe, expect, it } from "vitest";
import type { AwClientFrame, AwServerFrame, AwServerTransport } from "../../../../contracts/action-window/v2/transport";
import { ImportSegmentEngine, makeImportClock } from "../../../src/action-window/initial-import/import-engine";
import { ImportFixtureDriver, type ImportFixtureScript } from "../../../src/action-window/initial-import/import-fixture-driver";
import { ImportSegmentSession, type ImportSessionOptions } from "../../../src/action-window/initial-import/import-session";
import type { ActionWindowRunView } from "../../../../contracts/action-window/v2/index";

const REF = "9f2a1c7b4e6d0835";
const REQUIRED = { start: "2026-01-01", end: "2026-01-31" };

function loopback() {
  const sent: AwServerFrame[] = [];
  let listener: ((frame: AwClientFrame) => void) | null = null;
  const transport: AwServerTransport = {
    send: (frame) => void sent.push(frame),
    subscribe: (l) => {
      listener = l;
      return () => void (listener = null);
    },
  };
  return {
    transport,
    send: (frame: AwClientFrame) => listener?.(frame),
    lastView: (): ActionWindowRunView | undefined => {
      const all = sent.filter((f) => f.kind === "aw_view");
      return (all[all.length - 1] as { view: ActionWindowRunView } | undefined)?.view;
    },
    blockerCodes: () =>
      sent
        .filter((f) => f.kind === "aw_event")
        .map((f) => (f as { event: { type: string; payload: { code?: string; recoverable?: boolean } } }).event)
        .filter((e) => e.type === "RUN_BLOCKED")
        .map((e) => e.payload),
  };
}

function build(script: ImportFixtureScript = {}, opts?: ImportSessionOptions) {
  const io = loopback();
  const engine = new ImportSegmentEngine(
    { runId: "run_import01", channelCode: "naver", importRef: REF, required: REQUIRED },
    { clock: makeImportClock() },
  );
  const driver = new ImportFixtureDriver(script);
  // Disable the PREPARE watchdog by default so a real timer never fires under a hand-driven test.
  const session = new ImportSegmentSession(engine, driver, io.transport, REQUIRED, { prepareStartGuardMs: 0, ...opts });
  session.attach();
  return { io, engine, driver, session };
}

function startRun(io: ReturnType<typeof loopback>) {
  io.send({
    kind: "aw_command",
    command: {
      protocolVersion: 2,
      commandId: "c1",
      runId: "run_import01",
      expectedRevision: 0,
      type: "START_RUN",
      payload: { channelCode: "naver", intent: "INITIAL_REVIEW_IMPORT_SEGMENT", importRef: REF },
    },
  });
}

function recheck(io: ReturnType<typeof loopback>, expectedRevision: number) {
  io.send({
    kind: "aw_command",
    command: { protocolVersion: 2, commandId: `rc-${expectedRevision}`, runId: "run_import01", expectedRevision, type: "REQUEST_STEP_RECHECK" },
  });
}

const VALID_PACK = {
  chrome: { product: "SellerOps 안내", stepCounter: "{total}단계 중 {step}", requiredRange: "{start} ~ {end}", blockedLabel: "잠깐 멈췄어요" },
  steps: {},
  blockers: {},
  commands: {},
  recheck: { byBlocker: {}, byStep: {}, fallback: "다시 확인" },
};

describe("Guided Acquisition Reliability — the session parks silent failures visibly", () => {
  it("a rejected guidance pack parks the run on GUIDANCE_PACK_REJECTED instead of dropping it in silence", async () => {
    // Rest at the first barrier so the run is still active when the malformed pack arrives (a terminal run is
    // deliberately never re-parked).
    const { io, session } = build({ action: { start_date: false } });
    startRun(io);
    await session.whenSettled();
    io.send({ kind: "aw_guidance_pack", pack: { chrome: { product: "" } } as never });
    const view = io.lastView();
    expect(view?.status).toBe("WAITING_FOR_HUMAN");
    expect(view?.blocker).toEqual({ code: "GUIDANCE_PACK_REJECTED", recoverable: true });
    // Recoverable → the seller is offered a re-check.
    expect(view?.allowedCommands).toContain("REQUEST_STEP_RECHECK");
  });

  it("a stalled surface settle parks on SURFACE_SETTLE_TIMEOUT, and a re-check re-runs PREPARE and proceeds", async () => {
    const { io, driver, session } = build({ prepareFail: ["SURFACE_SETTLE_TIMEOUT", null] });
    startRun(io);
    await session.whenSettled();
    const blocked = io.lastView();
    expect(blocked?.blocker).toEqual({ code: "SURFACE_SETTLE_TIMEOUT", recoverable: true });
    expect(driver.prepareCalls()).toBe(1);

    recheck(io, blocked!.revision);
    await session.whenSettled();
    // Re-check re-ran PREPARE (a second prepare), and the run moved off the park.
    expect(driver.prepareCalls()).toBe(2);
    expect(io.lastView()?.blocker).toBeUndefined();
  });

  it("an overlay that painted nothing parks on OVERLAY_NOT_VISIBLE, and a re-check recovers", async () => {
    const { io, driver, session } = build({ highlightFail: { start_date: "OVERLAY_NOT_VISIBLE" } });
    startRun(io);
    await session.whenSettled();
    expect(io.lastView()?.blocker).toEqual({ code: "OVERLAY_NOT_VISIBLE", recoverable: true });

    recheck(io, io.lastView()!.revision);
    await session.whenSettled();
    // The re-check re-ran PREPARE (the whole surface prep), and the highlight — which fails only once —
    // succeeded the second time, so the run is no longer parked.
    expect(driver.prepareCalls()).toBe(2);
    expect(io.lastView()?.blocker).toBeUndefined();
  });

  it("a window that would not open parks on SURFACE_OPEN_FAILED", async () => {
    const { io, session } = build({ prepareFail: ["SURFACE_OPEN_FAILED"] });
    startRun(io);
    await session.whenSettled();
    expect(io.lastView()?.blocker).toEqual({ code: "SURFACE_OPEN_FAILED", recoverable: true });
  });
});

describe("Guided Acquisition Reliability — the seller closing the window", () => {
  it("parks on SURFACE_CLOSED instead of stranding the run, and a re-check re-opens and re-runs PREPARE", async () => {
    // The seller acts on nothing until we say so, so the run rests at the first date barrier.
    const { io, driver, session } = build({ action: { start_date: false } });
    startRun(io);
    await session.whenSettled();
    expect(io.lastView()?.status).toBe("WAITING_FOR_HUMAN");
    expect(driver.prepareCalls()).toBe(1);

    driver.closeSurface();
    await Promise.resolve();
    await Promise.resolve();
    const closed = io.lastView();
    expect(closed?.blocker).toEqual({ code: "SURFACE_CLOSED", recoverable: true });

    recheck(io, closed!.revision);
    await session.whenSettled();
    // The re-check re-opened the window: a second PREPARE ran.
    expect(driver.prepareCalls()).toBe(2);
    expect(io.lastView()?.blocker).toBeUndefined();
  });

  it("ignores a close from a window it has already recovered past (no double-park)", async () => {
    const { io, driver, session } = build({ action: { start_date: false } });
    startRun(io);
    await session.whenSettled();
    driver.closeSurface();
    await Promise.resolve();
    await Promise.resolve();
    recheck(io, io.lastView()!.revision);
    await session.whenSettled();
    const afterRecover = io.lastView();
    // The OLD window's close cannot fire again — its resolver was consumed — so the recovered run stays clean.
    expect(afterRecover?.blocker).toBeUndefined();
  });
});

describe("Guided Acquisition Reliability — the PREPARE watchdog", () => {
  it("parks on PREPARE_NOT_STARTED when PREPARE never produces a result", async () => {
    const { io } = build({ prepareHang: true }, { prepareStartGuardMs: 30 });
    startRun(io);
    // Let the real watchdog fire.
    await new Promise((r) => setTimeout(r, 80));
    const view = io.lastView();
    expect(view?.status).toBe("WAITING_FOR_HUMAN");
    expect(view?.blocker).toEqual({ code: "PREPARE_NOT_STARTED", recoverable: true });
  });
});
