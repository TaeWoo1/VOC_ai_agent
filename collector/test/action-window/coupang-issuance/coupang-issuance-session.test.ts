/**
 * The guided Coupang WING API-issuance walk, end to end, offline — the core deliverable.
 *
 * Every branch is pinned here, where it is free: the FULL walkthrough (reach transition → 자체개발 → 업체명 →
 * 호출 IP → 발급 checkpoint → copy keys → return → complete), TARGET RE-FIND after a navigation race, the
 * recoverable parks (login / target_not_found / page_mismatch) each recovering via REQUEST_STEP_RECHECK, the
 * 발급 human checkpoint that never auto-advances, and the contract/privacy invariants on the wire.
 */
import { describe, expect, it } from "vitest";
import {
  validateEventEnvelope,
  validateRunView,
  findProhibitedFields,
  type ActionWindowRunView,
} from "../../../../contracts/action-window/v2/index";
import { createLoopbackChannel, type AwClientFrame, type AwServerFrame, type AwServerTransport } from "../../../../contracts/action-window/v2/transport";
import { CoupangIssuanceEngine, makeCoupangIssuanceClock } from "../../../src/action-window/coupang-issuance/coupang-issuance-engine";
import { CoupangIssuanceFixtureDriver, type CoupangIssuanceFixtureScript } from "../../../src/action-window/coupang-issuance/coupang-issuance-fixture-driver";
import { CoupangIssuanceGuidanceSession } from "../../../src/action-window/coupang-issuance/coupang-issuance-session";

const RUN_ID = "run_coupang01";

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

function build(script: CoupangIssuanceFixtureScript = {}) {
  const io = loopback();
  const engine = new CoupangIssuanceEngine({ runId: RUN_ID, channelCode: "coupang" }, { clock: makeCoupangIssuanceClock() });
  const driver = new CoupangIssuanceFixtureDriver(script);
  const session = new CoupangIssuanceGuidanceSession(engine, driver, io.transport, { rearmDelayMs: 1, surfaceWaitPollMs: 0, surfaceWaitTimeoutMs: 20 });
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

/** Press SellerOps's "다음" (a REQUEST_STEP_RECHECK) through every remaining checkpoint until the run completes.
 * At a recoverable park a REQUEST_STEP_RECHECK also re-probes/re-guides, so this drives those recoveries too. */
async function pressNextToComplete(io: ReturnType<typeof loopback>, engine: CoupangIssuanceEngine, session: CoupangIssuanceGuidanceSession): Promise<void> {
  for (let i = 0; i < 12 && engine.currentStage() !== "guidance_complete"; i++) {
    command(io, "REQUEST_STEP_RECHECK", io.lastView()!.revision, `nx${i}`);
    await session.whenSettled();
  }
}

describe("coupang issuance session — the full linear walkthrough (offline)", () => {
  it("reach → verify → 발급 → 확인 → terms → key → … → return → complete on WING-resident advances ALONE (a single START_RUN, no FE 다음)", async () => {
    const { io, engine, driver, session } = build();
    startRun(io);
    await session.whenSettled();
    // The WHOLE walk drives to completion from a single START_RUN: the reach_open_api navigation is observed, then
    // every same-page checkpoint advances when the driver reports the seller pressed its WING-RESIDENT advance
    // button (the fixture's default action) — no REQUEST_STEP_RECHECK from the FE is ever sent.

    expect(engine.currentStage()).toBe("guidance_complete");
    expect(io.lastView()?.status).toBe("COMPLETED");
    expect(driver.calls).toEqual([
      "probeSurface", // initial probe → wing_home
      "locate:reach_open_api",
      "highlight:reach_open_api",
      "observe:reach_open_api", // transition-observe: arm the navigation watch
      "wait:reach_open_api",
      "probeSurface", // VERIFY_REACH: confirm the seller reached the open-API issuance page
      // The MEASURED order since 2026-08-10: 발급 opens the purpose screen, 확인 opens the terms screen, and the
      // key is created on the terms screen. The old sequence guided 자체개발 / 업체명 / 호출 IP here — one control
      // that is not on the screen, and two whose screens this flow never shows.
      "locate:issue",
      "highlight:issue", // 'API Key 발급 받기' — highlighted, the seller presses it; it opens the purpose screen
      "observe:issue", // WING-resident: arm the on-page advance-button observation
      "wait:issue", // …and advance when the seller presses it
      "locate:confirm_purpose",
      "highlight:confirm_purpose",
      "observe:confirm_purpose",
      "wait:confirm_purpose",
      "locate:terms_consent",
      "highlight:terms_consent",
      "observe:terms_consent",
      "wait:terms_consent",
      "locate:issue_final",
      "highlight:issue_final", // ⚠ THE KEY-CREATION CONTROL — highlighted, never pressed by SellerOps
      "observe:issue_final",
      "wait:issue_final", // …the seller reports pressing it; only now can a credential exist
      "locate:credentials",
      "highlight:credentials", // copy the Access Key / Secret Key / 업체코드
      "observe:credentials",
      "wait:credentials",
      "locate:return",
      "highlight:return",
      "observe:return",
      "wait:return",
      "cleanup",
    ]);
    // PROOF the FE never drove a step: the ONLY command the session received was the single START_RUN.
    const commandResults = io.sent.filter((f) => f.kind === "aw_command_result");
    expect(commandResults).toHaveLength(1);
  });

  it("keeps totalSteps a fixed 7, carrying the coupang channel + issuance intent + NO appBranch on every view", async () => {
    const { io, session } = build();
    startRun(io);
    await session.whenSettled();
    const totals = new Set(io.views().map((v) => v.currentStep!.totalSteps));
    expect(totals).toEqual(new Set([7]));
    for (const v of io.views()) {
      expect(v.intent).toBe("API_ISSUANCE_GUIDANCE");
      expect(v.channelCode).toBe("coupang");
      expect(v.runCopyKey).toBe("actionWindow.coupangIssuance.run");
      expect(v.appBranch).toBeUndefined(); // linear flow — never a branch signal
    }
  });

  it("skips the reach transition when the seller starts ALREADY on the open-API issuance page", async () => {
    const { io, engine, driver, session } = build({ probe: { ok: true, pageCategory: "open_api_issuance" } });
    startRun(io);
    await session.whenSettled();
    // No reach_open_api guidance at all — step 1 auto-completed; the first guided control is 발급.
    expect(driver.calls).not.toContain("locate:reach_open_api");
    expect(driver.calls[1]).toBe("locate:issue");
    await pressNextToComplete(io, engine, session);
    expect(engine.currentStage()).toBe("guidance_complete");
  });
});

describe("coupang issuance session — the 발급 (issue) human checkpoint", () => {
  it("rests at checkpoint_before_issue with the KEY-CREATING control highlighted, arms the WING-resident observer, and advances only on the seller's press", async () => {
    // The seller has NOT yet pressed the WING-resident advance button on the KEY-CREATION step — model that with
    // action:issue_final=false so the run reaches that checkpoint and RESTS there.
    //
    // MEASURED 2026-08-10: this checkpoint is no longer the 발급 press. 발급 opens the purpose screen and 확인
    // opens the terms screen; the control that creates the key is `약관 동의 및 Key 발급받기`, and THAT is what
    // `checkpoint_before_issue` now guards — the name was right all along and the target was not.
    const { io, engine, driver, session } = build({ action: { issue_final: false } });
    startRun(io);
    await session.whenSettled();
    expect(engine.currentStage()).toBe("checkpoint_before_issue");
    expect(io.lastView()?.status).toBe("WAITING_FOR_HUMAN");
    expect(io.lastView()?.currentStep?.stepNumber).toBe(5);
    // The key-creating control was highlighted (opaque 16-hex), and a WING-resident observation WAS armed — the
    // run waits for the seller's own on-page press. It never auto-advances, and never presses that button.
    const ref = io.events().find((e) => e.type === "TARGET_HIGHLIGHTED" && e.payload.stepId === "aw.coupang_issuance_issue_checkpoint")!.payload.targetRef;
    expect(ref).toMatch(/^[0-9a-f]{16}$/);
    expect(driver.calls).toContain("highlight:issue_final");
    expect(driver.calls).toContain("observe:issue_final");
    // It has NOT completed the issue step while the seller has not pressed the button.
    expect(io.eventTypes().filter((_t) => true)).not.toContain("RUN_COMPLETED");

    // The seller issues the key themselves, then presses the WING-resident advance button → the driver observes it.
    driver.setAction("issue_final", true);
    for (let i = 0; i < 100 && engine.currentStage() === "checkpoint_before_issue"; i++) {
      await new Promise<void>((r) => setTimeout(r, 2));
    }
    await session.whenSettled();
    // Advancing the checkpoint runs the rest of the walk (copy keys → return) on the same WING-resident presses.
    expect(engine.currentStage()).toBe("guidance_complete");
    expect(io.lastView()?.status).toBe("COMPLETED");
  });
});

describe("coupang issuance session — TARGET RE-FIND after a navigation race", () => {
  it("a checkpoint locate that throws recovers IN PLACE by itself and the walk completes", async () => {
    // Model the wing_home→open_api race hitting the vendor_info locate: it throws once (execution-context-destroyed).
    // self_dev advances on its own WING-resident press and drives straight into the vendor_info guide, which races
    // and throws → recoverable page_mismatch park (no FE 다음 was needed to get here).
    const { io, engine, driver, session } = build({ locateThrows: { confirm_purpose: 1 } });
    startRun(io);
    await session.whenSettled();
    // The park is entered AND cleared without anyone pressing anything: the session issues the recheck the
    // frontend button would have sent, re-locates the SAME section in place, and the walk finishes.
    expect(io.blockers()).toContainEqual({ code: "UI_DRIFT", recoverable: true });
    expect(io.eventTypes()).not.toContain("RUN_FAILED");
    expect(engine.currentStage()).toBe("guidance_complete");
    // Re-located (target re-find) — more than the one throwing attempt.
    expect(driver.calls.filter((c) => c === "locate:confirm_purpose").length).toBeGreaterThan(1);
    // …and the recovery added NO surface probe: exactly the two the walk always does (the opening read and
    // the reach verification). The seller never left the issuance page, so re-reading it would be wasted work.
    expect(driver.calls.filter((c) => c === "probeSurface").length).toBe(2);
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

describe("coupang issuance session — recoverable parks each recover via REQUEST_STEP_RECHECK", () => {
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
    const { io, engine, driver, session } = build({ probe: { ok: true, pageCategory: "open_api_issuance" }, locate: { confirm_purpose: { count: 0 } } });
    startRun(io);
    await session.whenSettled();
    expect(engine.currentStage()).toBe("target_not_found");
    expect(io.blockers()).toContainEqual({ code: "TARGET_NOT_FOUND", recoverable: true });
    const probesBefore = driver.calls.filter((c) => c === "probeSurface").length;

    command(io, "REQUEST_STEP_RECHECK", io.lastView()!.revision);
    await session.whenSettled();
    // Re-guided IN PLACE (re-located the control that was missing), never re-probed; still recoverable, no
    // dead-end, no RUN_FAILED. The park is on `confirm_purpose` — the target the fixture makes unfindable.
    expect(driver.calls.filter((c) => c === "locate:confirm_purpose").length).toBeGreaterThan(1);
    expect(driver.calls.filter((c) => c === "probeSurface").length).toBe(probesBefore);
    expect(io.eventTypes()).not.toContain("RUN_FAILED");
  });

  it("a wrong reach landing WAITS and re-probes itself — no re-check from the SellerOps tab", async () => {
    const { io, engine, session } = build({ reachLanding: { ok: true, pageCategory: "unknown" } });
    startRun(io);
    await session.whenSettled();
    // A wait, not a park: no blocker is raised, nothing asks the seller to do anything, and the run keeps
    // re-reading WING until they get to the issuance page.
    expect(engine.currentStage()).toBe("awaiting_wing_surface");
    expect(io.blockers()).not.toContainEqual({ code: "UI_DRIFT", recoverable: true });
    expect(io.eventTypes()).not.toContain("RUN_FAILED");
  });
});

describe("coupang issuance session — operator control", () => {
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

describe("coupang issuance session — contract validity + privacy", () => {
  it("emits only contract-VALID v2 events and views, with no prohibited fields, across every path", async () => {
    for (const script of [
      {},
      { probe: { ok: true, pageCategory: "open_api_issuance" as const } },
      { probe: { ok: false, pageCategory: "login" as const, blockerCode: "LOGIN_REQUIRED" as const } },
      { locate: { confirm_purpose: { count: 0 } }, probe: { ok: true, pageCategory: "open_api_issuance" as const } },
      { reachLanding: { ok: true, pageCategory: "unknown" as const } },
      { locateThrows: { confirm_purpose: 1 } },
    ]) {
      const { io, session } = build(script as CoupangIssuanceFixtureScript);
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

  it("never puts a selector, url, or credential-shaped value on the wire", async () => {
    const { io, session } = build();
    startRun(io);
    await session.whenSettled();
    const wire = JSON.stringify(io.sent);
    expect(wire).not.toContain("data-aw-target");
    expect(wire).not.toContain("coupang.com");
    expect(wire).not.toContain("http");
  });
});

describe("coupang issuance session — loopback E2E over the real v2 transport", () => {
  it("drives the happy path to a COMPLETED view the client receives", async () => {
    const { client, server } = createLoopbackChannel();
    const engine = new CoupangIssuanceEngine({ runId: RUN_ID, channelCode: "coupang" }, { clock: makeCoupangIssuanceClock() });
    const driver = new CoupangIssuanceFixtureDriver();
    const session = new CoupangIssuanceGuidanceSession(engine, driver, server, { rearmDelayMs: 1, surfaceWaitPollMs: 0, surfaceWaitTimeoutMs: 20 });
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

/**
 * The observed waits — the reason a seller never has to go back to the SellerOps tab mid-walk. Both used to be
 * parks that sat until a `REQUEST_STEP_RECHECK` arrived from exactly the tab they had been told to leave.
 */
describe("coupang issuance session — observed waits recover inside WING", () => {
  const BLANK = { ok: true, pageCategory: "unknown" } as const;
  const LOGIN = { ok: false, pageCategory: "login", blockerCode: "LOGIN_REQUIRED" } as const;
  const ISSUANCE = { ok: true, pageCategory: "open_api_issuance" } as const;

  it("starts on a blank tab and drives itself once the seller reaches the issuance page", async () => {
    // The dedicated window always opens blank, so the first reading of EVERY run is `unknown`.
    const { engine, io, session } = build({ probeSequence: [BLANK, BLANK, ISSUANCE] });
    startRun(io);
    await session.whenSettled();
    // No command was sent from SellerOps — the wait noticed the page change by itself, and the walk then ran to
    // the end on the fixture seller's own advances.
    expect(engine.currentStage()).toBe("guidance_complete");
    expect(engine.view().blocker).toBeUndefined();
  });

  it("holds no blocker while merely waiting — 'not there yet' is not drift", async () => {
    const { engine, io, session } = build({ probeSequence: [BLANK] });
    startRun(io);
    await session.whenSettled();
    expect(engine.currentStage()).toBe("awaiting_wing_surface");
    expect(engine.view().blocker).toBeUndefined();
  });

  it("waits through a login and picks the run up afterwards, with no command from the frontend", async () => {
    const { engine, io, session } = build({ probeSequence: [LOGIN, LOGIN, ISSUANCE] });
    startRun(io);
    await session.whenSettled();
    expect(engine.currentStage()).toBe("guidance_complete");
    // The seller WAS told to log in — that blocker is real and must have been surfaced once.
    expect(io.blockers().map((b) => b.code)).toContain("LOGIN_REQUIRED");
  });

  it("re-reading the same page does not spam the frontend — a poll is not an event stream", async () => {
    const { io, session } = build({ probeSequence: [LOGIN] });
    startRun(io);
    await session.whenSettled();
    expect(io.blockers().filter((b) => b.code === "LOGIN_REQUIRED").length).toBe(1);
  });

  it("a zero-delay cadence terminates — an elapsed-time accumulator would have looped forever", async () => {
    const { io, session } = build({ probeSequence: [BLANK] });
    startRun(io);
    await session.whenSettled();
  });
});
