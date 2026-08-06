/**
 * The guided Coupang WING credential-RENEWAL walk, end to end, offline — the core deliverable.
 *
 * Pins the FULL walkthrough (reach transition → check `유효기간` → `재발급` checkpoint → copy the new keys →
 * return → complete), TARGET RE-FIND after a navigation race, the recoverable parks (login / target_not_found /
 * page_mismatch) each recovering via REQUEST_STEP_RECHECK, the `재발급` human checkpoint that never auto-advances,
 * the pinned `actionWindow.coupangRenewal.*` copy keys / step ids, and the contract/privacy invariants.
 */
import { describe, expect, it } from "vitest";
import {
  validateEventEnvelope,
  validateRunView,
  findProhibitedFields,
  type ActionWindowRunView,
} from "../../../../contracts/action-window/v2/index";
import { createLoopbackChannel, type AwClientFrame, type AwServerFrame, type AwServerTransport } from "../../../../contracts/action-window/v2/transport";
import { CoupangRenewalEngine, makeCoupangRenewalClock } from "../../../src/action-window/coupang-renewal/coupang-renewal-engine";
import { CoupangRenewalFixtureDriver, type CoupangRenewalFixtureScript } from "../../../src/action-window/coupang-renewal/coupang-renewal-fixture-driver";
import { CoupangRenewalGuidanceSession } from "../../../src/action-window/coupang-renewal/coupang-renewal-session";
import { coupangRenewalStepPlan } from "../../../src/action-window/coupang-renewal/coupang-renewal-stages";

const RUN_ID = "run_coupangrenew01";

function loopback() {
  const sent: AwServerFrame[] = [];
  let listener: ((frame: AwClientFrame) => void) | null = null;
  const transport: AwServerTransport = {
    send: (frame) => {
      sent.push(frame);
    },
    subscribe: (l) => {
      listener = l;
      return () => {
        listener = null;
      };
    },
  };
  return {
    transport,
    sent,
    send: (frame: AwClientFrame) => listener?.(frame),
    views: () => sent.filter((f) => f.kind === "aw_view").map((f) => (f as { view: ActionWindowRunView }).view),
    lastView: () => {
      const all = sent.filter((f) => f.kind === "aw_view");
      return (all[all.length - 1] as { view: ActionWindowRunView } | undefined)?.view;
    },
    events: () => sent.filter((f) => f.kind === "aw_event").map((f) => (f as unknown as { event: { type: string; payload: Record<string, unknown> } }).event),
    eventTypes: () => sent.filter((f) => f.kind === "aw_event").map((f) => (f as { event: { type: string } }).event.type),
    blockers: () =>
      sent
        .filter((f) => f.kind === "aw_event")
        .map((f) => (f as { event: { type: string; payload: { code?: string; recoverable?: boolean } } }).event)
        .filter((e) => e.type === "RUN_BLOCKED")
        .map((e) => e.payload),
  };
}

function build(script: CoupangRenewalFixtureScript = {}) {
  const io = loopback();
  const engine = new CoupangRenewalEngine({ runId: RUN_ID, channelCode: "coupang" }, { clock: makeCoupangRenewalClock() });
  const driver = new CoupangRenewalFixtureDriver(script);
  const session = new CoupangRenewalGuidanceSession(engine, driver, io.transport, { rearmDelayMs: 1 });
  session.attach();
  return { io, engine, driver, session };
}

function startRun(io: ReturnType<typeof loopback>, expectedRevision = 0) {
  io.send({
    kind: "aw_command",
    command: {
      protocolVersion: 2,
      commandId: "c1",
      runId: RUN_ID,
      expectedRevision,
      type: "START_RUN",
      payload: { channelCode: "coupang", intent: "API_ISSUANCE_GUIDANCE" },
    },
  });
}

function command(io: ReturnType<typeof loopback>, type: string, revision: number, id = "cx") {
  io.send({
    kind: "aw_command",
    command: { protocolVersion: 2, commandId: id, runId: RUN_ID, expectedRevision: revision, type: type as never },
  });
}

async function pressNextToComplete(io: ReturnType<typeof loopback>, engine: CoupangRenewalEngine, session: CoupangRenewalGuidanceSession): Promise<void> {
  for (let i = 0; i < 12 && engine.currentStage() !== "guidance_complete"; i++) {
    command(io, "REQUEST_STEP_RECHECK", io.lastView()!.revision, `nx${i}`);
    await session.whenSettled();
  }
}

describe("coupang renewal session — the full linear walkthrough (offline)", () => {
  it("reach → verify → check_expiry → reissue → credentials → return → complete, never clicking", async () => {
    const { io, engine, driver, session } = build();
    startRun(io);
    await session.whenSettled();
    await pressNextToComplete(io, engine, session);

    expect(engine.currentStage()).toBe("guidance_complete");
    expect(io.lastView()?.status).toBe("COMPLETED");
    expect(driver.calls).toEqual([
      "probeSurface", // initial probe → wing_home
      "locate:reach_open_api",
      "highlight:reach_open_api",
      "observe:reach_open_api", // transition-observe: arm the navigation watch
      "wait:reach_open_api",
      "probeSurface", // VERIFY_REACH: confirm the seller reached the open-API page
      "locate:check_expiry",
      "highlight:check_expiry", // checkpoint — rest (no observe/wait); 다음 advances
      "locate:reissue",
      "highlight:reissue", // the 재발급 button — highlighted, the seller presses it themselves
      "locate:credentials",
      "highlight:credentials", // copy the NEW Access Key / Secret Key / 업체코드
      "locate:return",
      "highlight:return",
      "cleanup",
    ]);
    // The runtime observed/awaited ONLY the reach transition — never a checkpoint control (incl. 재발급).
    for (const t of ["check_expiry", "reissue", "credentials", "return"]) {
      expect(driver.calls, `observe:${t}`).not.toContain(`observe:${t}`);
      expect(driver.calls, `wait:${t}`).not.toContain(`wait:${t}`);
    }
    // The walk NEVER auto-reads the validity date (the reader seam is for the completion/recorder surface).
    expect(driver.calls).not.toContain("readValidityDate");
  });

  it("keeps totalSteps a fixed 5 and pins the coupangRenewal copy keys / step ids on every view", async () => {
    const { io, session } = build();
    startRun(io);
    await session.whenSettled();
    const totals = new Set(io.views().map((v) => v.currentStep!.totalSteps));
    expect(totals).toEqual(new Set([5]));
    for (const v of io.views()) {
      expect(v.intent).toBe("API_ISSUANCE_GUIDANCE");
      expect(v.channelCode).toBe("coupang");
      expect(v.runCopyKey).toBe("actionWindow.coupangRenewal.run");
      expect(v.appBranch).toBeUndefined(); // linear flow — never a branch signal
    }
    // The pinned plan the FE must match.
    expect(coupangRenewalStepPlan().map((s) => [s.stepId, s.copyKey])).toEqual([
      ["aw.coupang_renewal_reach_open_api", "actionWindow.coupangRenewal.reachOpenApi"],
      ["aw.coupang_renewal_check_expiry", "actionWindow.coupangRenewal.checkExpiry"],
      ["aw.coupang_renewal_reissue_checkpoint", "actionWindow.coupangRenewal.reissueCheckpoint"],
      ["aw.coupang_renewal_copy_keys", "actionWindow.coupangRenewal.copyKeys"],
      ["aw.coupang_renewal_return", "actionWindow.coupangRenewal.return"],
    ]);
  });

  it("skips the reach transition when the seller starts ALREADY on the open-API page", async () => {
    const { io, engine, driver, session } = build({ probe: { ok: true, pageCategory: "open_api_issuance" } });
    startRun(io);
    await session.whenSettled();
    expect(driver.calls).not.toContain("locate:reach_open_api");
    expect(driver.calls[1]).toBe("locate:check_expiry");
    await pressNextToComplete(io, engine, session);
    expect(engine.currentStage()).toBe("guidance_complete");
  });
});

describe("coupang renewal session — the 재발급 (re-issue) human checkpoint", () => {
  it("rests at checkpoint_before_reissue with 재발급 highlighted, arms NO observer, and 다음 advances", async () => {
    const { io, engine, driver, session } = build();
    startRun(io);
    await session.whenSettled();
    // 다음 through check_expiry to land on the reissue checkpoint.
    command(io, "REQUEST_STEP_RECHECK", io.lastView()!.revision);
    await session.whenSettled();
    expect(engine.currentStage()).toBe("checkpoint_before_reissue");
    expect(io.lastView()?.status).toBe("WAITING_FOR_HUMAN");
    expect(io.lastView()?.currentStep?.stepNumber).toBe(3);
    // The 재발급 section was highlighted (opaque 16-hex), and NO click observer was armed for it.
    const ref = io.events().find((e) => e.type === "TARGET_HIGHLIGHTED" && e.payload.stepId === "aw.coupang_renewal_reissue_checkpoint")!.payload.targetRef;
    expect(ref).toMatch(/^[0-9a-f]{16}$/);
    expect(driver.calls).toContain("highlight:reissue");
    expect(driver.calls).not.toContain("observe:reissue");
    expect(driver.calls).not.toContain("wait:reissue");

    // 다음 advances (does not complete the run) — the seller pressed 재발급 themselves, the tool did not.
    command(io, "REQUEST_STEP_RECHECK", io.lastView()!.revision);
    await session.whenSettled();
    expect(engine.currentStage()).toBe("guiding_copy_keys");
  });
});

describe("coupang renewal session — TARGET RE-FIND after a navigation race", () => {
  it("a checkpoint locate that throws PARKS recoverably, then 다음 re-guides IN PLACE and the run completes", async () => {
    const { io, engine, driver, session } = build({ locateThrows: { reissue: 1 } });
    startRun(io);
    await session.whenSettled();
    // 다음 from check_expiry tries to guide reissue; the locate races and throws → recoverable page_mismatch park.
    command(io, "REQUEST_STEP_RECHECK", io.lastView()!.revision, "chk-next");
    await session.whenSettled();
    expect(engine.currentStage()).toBe("page_mismatch");
    expect(io.blockers()).toContainEqual({ code: "UI_DRIFT", recoverable: true });
    expect(io.eventTypes()).not.toContain("RUN_FAILED");
    expect(driver.calls).not.toContain("highlight:reissue");

    const probesBefore = driver.calls.filter((c) => c === "probeSurface").length;
    const locatesBefore = driver.calls.filter((c) => c === "locate:reissue").length;
    await pressNextToComplete(io, engine, session);
    expect(engine.currentStage()).toBe("guidance_complete");
    expect(driver.calls.filter((c) => c === "locate:reissue").length).toBeGreaterThan(locatesBefore);
    expect(driver.calls.filter((c) => c === "probeSurface").length).toBe(probesBefore);
  });

  it("settles the surface before EVERY locate (a guide never locates a still-navigating page)", async () => {
    const { io, engine, driver, session } = build();
    startRun(io);
    await session.whenSettled();
    await pressNextToComplete(io, engine, session);
    expect(engine.currentStage()).toBe("guidance_complete");
    expect(driver.settleCount).toBeGreaterThan(0);
    expect(driver.locateSettledFirst.length).toBeGreaterThan(0);
    expect(driver.locateSettledFirst.every(Boolean)).toBe(true);
  });
});

describe("coupang renewal session — recoverable parks each recover via REQUEST_STEP_RECHECK", () => {
  it("login park → the seller logs in → re-check re-probes and drives the run to completion", async () => {
    const { io, engine, driver, session } = build({ probe: { ok: false, pageCategory: "login", blockerCode: "LOGIN_REQUIRED" } });
    startRun(io);
    await session.whenSettled();
    expect(engine.currentStage()).toBe("waiting_login");
    expect(io.lastView()?.blocker).toEqual({ code: "LOGIN_REQUIRED", recoverable: true });
    expect(io.lastView()?.allowedCommands).not.toContain("PAUSE_RUN");
    expect(io.eventTypes()).not.toContain("RUN_FAILED");

    driver.setProbe({ ok: true, pageCategory: "wing_home" });
    await pressNextToComplete(io, engine, session);
    expect(engine.currentStage()).toBe("guidance_complete");
    expect(io.lastView()?.blocker).toBeUndefined();
  });

  it("target_not_found park → re-check re-guides in place until the control appears", async () => {
    const { io, engine, driver, session } = build({ probe: { ok: true, pageCategory: "open_api_issuance" }, locate: { check_expiry: { count: 0 } } });
    startRun(io);
    await session.whenSettled();
    expect(engine.currentStage()).toBe("target_not_found");
    expect(io.blockers()).toContainEqual({ code: "TARGET_NOT_FOUND", recoverable: true });
    const probesBefore = driver.calls.filter((c) => c === "probeSurface").length;

    command(io, "REQUEST_STEP_RECHECK", io.lastView()!.revision);
    await session.whenSettled();
    expect(driver.calls.filter((c) => c === "locate:check_expiry").length).toBeGreaterThan(1);
    expect(driver.calls.filter((c) => c === "probeSurface").length).toBe(probesBefore);
    expect(io.eventTypes()).not.toContain("RUN_FAILED");
  });

  it("page_mismatch park (wrong reach landing) → re-check re-probes from the top", async () => {
    const { io, engine, session } = build({ reachLanding: { ok: true, pageCategory: "unknown" } });
    startRun(io);
    await session.whenSettled();
    expect(engine.currentStage()).toBe("page_mismatch");
    expect(io.blockers()).toContainEqual({ code: "UI_DRIFT", recoverable: true });
    expect(io.eventTypes()).not.toContain("RUN_FAILED");
    expect(io.lastView()?.allowedCommands).toContain("REQUEST_STEP_RECHECK");
  });
});

describe("coupang renewal session — operator control", () => {
  it("aborts to operator_aborted / CANCELLED and cleans up (resting at the reach transition barrier)", async () => {
    const { io, engine, driver, session } = build({ action: { reach_open_api: false } });
    startRun(io);
    await session.whenSettled();
    expect(engine.currentStage()).toBe("reaching_open_api");

    command(io, "CANCEL_RUN", io.lastView()!.revision);
    await session.whenSettled();
    expect(engine.currentStage()).toBe("operator_aborted");
    expect(io.lastView()?.status).toBe("CANCELLED");
    expect(driver.cleanupCount()).toBeGreaterThanOrEqual(1);
    expect(io.eventTypes()).not.toContain("RUN_COMPLETED");
  });
});

describe("coupang renewal session — contract validity + privacy", () => {
  it("emits only contract-VALID v2 events and views, with no prohibited fields, across every path", async () => {
    for (const script of [
      {},
      { probe: { ok: true, pageCategory: "open_api_issuance" as const } },
      { probe: { ok: false, pageCategory: "login" as const, blockerCode: "LOGIN_REQUIRED" as const } },
      { locate: { check_expiry: { count: 0 } }, probe: { ok: true, pageCategory: "open_api_issuance" as const } },
      { reachLanding: { ok: true, pageCategory: "unknown" as const } },
      { locateThrows: { reissue: 1 } },
    ]) {
      const { io, session } = build(script as CoupangRenewalFixtureScript);
      startRun(io);
      await session.whenSettled();
      for (const e of io.events()) {
        expect(validateEventEnvelope(e), `event ${e.type}`).toEqual({ ok: true });
        expect(findProhibitedFields(e)).toEqual([]);
      }
      for (const v of io.views()) {
        expect(validateRunView(v), `view ${v.status}`).toEqual({ ok: true });
        expect(findProhibitedFields(v)).toEqual([]);
      }
    }
  });

  it("never puts a selector, url, credential-shaped value, or validity date on the wire", async () => {
    const { io, session } = build();
    startRun(io);
    await session.whenSettled();
    const wire = JSON.stringify(io.sent);
    expect(wire).not.toContain("data-aw-target");
    expect(wire).not.toContain("coupang.com");
    expect(wire).not.toContain("http");
    // The synthetic default validity date is never emitted — the walk never reads it.
    expect(wire).not.toContain("2027");
  });
});

describe("coupang renewal session — loopback E2E over the real v2 transport", () => {
  it("drives the happy path to a COMPLETED view the client receives", async () => {
    const { client, server } = createLoopbackChannel();
    const engine = new CoupangRenewalEngine({ runId: RUN_ID, channelCode: "coupang" }, { clock: makeCoupangRenewalClock() });
    const driver = new CoupangRenewalFixtureDriver();
    const session = new CoupangRenewalGuidanceSession(engine, driver, server, { rearmDelayMs: 1 });
    session.attach();

    const clientViews: ActionWindowRunView[] = [];
    client.subscribe((frame) => {
      if (frame.kind === "aw_view") clientViews.push(frame.view);
    });

    client.send({
      kind: "aw_command",
      command: { protocolVersion: 2, commandId: "e2e1", runId: RUN_ID, expectedRevision: 0, type: "START_RUN", payload: { channelCode: "coupang", intent: "API_ISSUANCE_GUIDANCE" } },
    });
    await session.whenSettled();
    for (let i = 0; i < 10 && engine.currentStage() !== "guidance_complete"; i++) {
      const rev = clientViews[clientViews.length - 1]!.revision;
      client.send({
        kind: "aw_command",
        command: { protocolVersion: 2, commandId: `e2e-nx${i}`, runId: RUN_ID, expectedRevision: rev, type: "REQUEST_STEP_RECHECK" },
      });
      await session.whenSettled();
    }

    expect(engine.currentStage()).toBe("guidance_complete");
    const last = clientViews[clientViews.length - 1];
    expect(last?.status).toBe("COMPLETED");
    expect(last?.intent).toBe("API_ISSUANCE_GUIDANCE");
    for (const v of clientViews) expect(validateRunView(v)).toEqual({ ok: true });
  });
});
