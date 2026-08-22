/**
 * **NAVER Review Acquisition Completion Hardening — the guided run must finish, or say why it cannot.**
 *
 * Both contracts here come from one live run (2026-08-23, canonical Demo Org). The scope gate reported
 * `MATCH`, and then the run stopped: the export locate threw, the session tore down silently, the guidance
 * panel vanished from the marketplace page the seller was standing on, and no `RUN_FAILED` was emitted. The
 * seller — with no instruction left on screen — pressed 엑셀 내보내기 themselves. Their own agent's browser
 * received the file. Nothing was listening for it, because the download race was armed one barrier later, at
 * consent. The run stayed a silent PENDING with an unspent ticket and 482 reviews had to be pushed through
 * by hand.
 *
 * So: a run that cannot continue SAYS SO where the seller is, and the listener exists before the seller can
 * produce a download. No marketplace is involved in proving either.
 */
import { describe, expect, it } from "vitest";
import type { AwClientFrame, AwServerFrame, AwServerTransport } from "../../../../contracts/action-window/v2/transport";
import type { ActionWindowRunView } from "../../../../contracts/action-window/v2/index";
import type { GuidancePanelState } from "../../../src/action-window/guidance-panel";
import { ImportSegmentEngine, makeImportClock } from "../../../src/action-window/initial-import/import-engine";
import { ImportFixtureDriver, type ImportFixtureScript } from "../../../src/action-window/initial-import/import-fixture-driver";
import { ImportSegmentSession } from "../../../src/action-window/initial-import/import-session";

const REF = "9f2a1c7b4e6d0835";
const REQUIRED = { start: "2026-08-01", end: "2026-08-22" };

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
    eventTypes: () =>
      sent
        .filter((f) => f.kind === "aw_event")
        .map((f) => (f as { event: { type: string } }).event.type),
  };
}

function build(script: ImportFixtureScript = {}) {
  const io = loopback();
  const engine = new ImportSegmentEngine(
    { runId: "run_import01", channelCode: "naver", importRef: REF, required: REQUIRED },
    { clock: makeImportClock() },
  );
  const driver = new ImportFixtureDriver(script);
  const session = new ImportSegmentSession(engine, driver, io.transport, REQUIRED, { prepareStartGuardMs: 0 });
  session.attach();
  return { io, driver, session };
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

/** The pack the frontend hands over; the runtime authors no sentence of its own. */
const PACK = {
  chrome: { product: "SellerOps 안내", stepCounter: "{total}단계 중 {step}", requiredRange: "{start} ~ {end}", blockedLabel: "잠깐 멈췄어요" },
  steps: {},
  blockers: {},
  commands: {},
  recheck: { byBlocker: {}, byStep: {}, fallback: "다시 확인" },
};

describe("A — a guided run that cannot continue never goes silent", () => {
  it("a driver fault after the scope gate FAILS the run visibly instead of tearing it down", async () => {
    // The live shape exactly: dates fine, scope MATCH, and then the export locate throws something the
    // session cannot classify as a recoverable stall.
    const { io, session } = build({ locateThrow: { export: "boom" } });
    startRun(io);
    io.send({ kind: "aw_guidance_pack", pack: PACK as never });
    await session.whenSettled();

    const view = io.lastView();
    expect(view?.status).toBe("FAILED");
    expect(view?.blocker).toEqual({ code: "RUNTIME_FAULT", recoverable: false });
    expect(io.eventTypes()).toContain("RUN_FAILED");
  });

  it("…and the panel the seller is reading shows that failure rather than disappearing", async () => {
    const { io, driver, session } = build({ locateThrow: { export: "boom" } });
    startRun(io);
    io.send({ kind: "aw_guidance_pack", pack: PACK as never });
    await session.whenSettled();

    const renders = driver.guidanceRenders;
    const last = renders[renders.length - 1] as GuidancePanelState | null;
    expect(last).not.toBeNull();
    // The panel says it is blocked, in the frontend's own words — the runtime writes no sentence, so an
    // unnamed blocker still leaves the chrome's label rather than an invented explanation.
    expect(last?.blocked).not.toBeNull();
    expect(last?.blocked?.label).toBe("잠깐 멈췄어요");
    expect(last?.actions).toEqual([]);
    // Unmounting the panel (a null render) is what made the live run invisible; it must not be the last word.
    expect(renders.filter((r) => r === null)).toHaveLength(0);
  });

  it("the highlight comes off, so nothing points at a control the run stopped waiting for", async () => {
    const { io, driver, session } = build({ locateThrow: { export: "boom" } });
    startRun(io);
    io.send({ kind: "aw_guidance_pack", pack: PACK as never });
    await session.whenSettled();
    await new Promise((r) => setTimeout(r, 0));

    expect(driver.calls).toContain("clearHighlight");
  });

  it("a healthy run is untouched: it still walks scope → export → consent → ingest → COMPLETED", async () => {
    const { io, driver, session } = build();
    startRun(io);
    io.send({ kind: "aw_guidance_pack", pack: PACK as never });
    await session.whenSettled();

    expect(io.lastView()?.status).toBe("COMPLETED");
    expect(driver.calls).toContain("locate:export");
    expect(driver.calls).toContain("detectDownload");
  });
});

describe("A — the download listener exists before the seller can produce a download", () => {
  it("arms detection BEFORE the export barrier is opened to the seller", async () => {
    const { io, driver, session } = build();
    startRun(io);
    io.send({ kind: "aw_guidance_pack", pack: PACK as never });
    await session.whenSettled();

    const armed = driver.calls.indexOf("armDownloadDetection");
    const barrier = driver.calls.indexOf("observe:export");
    const waited = driver.calls.indexOf("wait:export");

    expect(armed).toBeGreaterThanOrEqual(0);
    expect(barrier).toBeGreaterThanOrEqual(0);
    // The ordering IS the contract: the race must exist before the click that would fire it.
    expect(armed).toBeLessThan(barrier);
    expect(armed).toBeLessThan(waited);
  });

  it("arms it once, not once per barrier — two races answer differently and only one wins the event", async () => {
    const { io, driver, session } = build();
    startRun(io);
    io.send({ kind: "aw_guidance_pack", pack: PACK as never });
    await session.whenSettled();

    expect(driver.calls.filter((c) => c === "armDownloadDetection")).toHaveLength(1);
  });

  it("a seller who never exports leaves the run waiting on them, not failed", async () => {
    // The barrier is still a barrier: arming early must not turn "they have not acted yet" into a failure.
    const { io, session } = build({ action: { export: false } });
    startRun(io);
    io.send({ kind: "aw_guidance_pack", pack: PACK as never });
    await session.whenSettled();

    expect(io.lastView()?.status).toBe("WAITING_FOR_HUMAN");
  });
});
