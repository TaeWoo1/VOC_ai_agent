/**
 * The guided API-issuance walk, end to end, offline.
 *
 * Every branch — both app populations, each barrier, the recoverable parks, the operator abort — is pinned
 * here, where it is free. A live rehearsal costs the seller a real login + API-center sitting.
 */
import { describe, expect, it } from "vitest";
import {
  validateEventEnvelope,
  validateRunView,
  findProhibitedFields,
  type ActionWindowRunView,
} from "../../../../contracts/action-window/v2/index";
import { createLoopbackChannel, type AwClientFrame, type AwServerFrame, type AwServerTransport } from "../../../../contracts/action-window/v2/transport";
import { IssuanceEngine, makeIssuanceClock } from "../../../src/action-window/api-issuance/issuance-engine";
import { IssuanceFixtureDriver, type IssuanceFixtureScript } from "../../../src/action-window/api-issuance/issuance-fixture-driver";
import { IssuanceGuidanceSession } from "../../../src/action-window/api-issuance/issuance-session";

const RUN_ID = "run_issuance01";

/** A loopback transport that records everything the runtime published. */
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

function build(script: IssuanceFixtureScript = {}) {
  const io = loopback();
  const engine = new IssuanceEngine({ runId: RUN_ID, channelCode: "naver" }, { clock: makeIssuanceClock() });
  const driver = new IssuanceFixtureDriver(script);
  const session = new IssuanceGuidanceSession(engine, driver, io.transport, { rearmDelayMs: 1 });
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
      payload: { channelCode: "naver", intent: "API_ISSUANCE_GUIDANCE" },
    },
  });
}

function command(io: ReturnType<typeof loopback>, type: string, revision: number, id = "cx") {
  io.send({
    kind: "aw_command",
    command: { protocolVersion: 2, commandId: id, runId: RUN_ID, expectedRevision: revision, type: type as never },
  });
}

/** existing → 1 entry row; empty → 0 rows. */
const EXISTING: IssuanceFixtureScript = { applications: { census: emptyCensus(), applicationEntryRowCount: 1 } };
const EMPTY: IssuanceFixtureScript = { applications: { census: emptyCensus(), applicationEntryRowCount: 0 } };
function emptyCensus() {
  return { passwordFieldPresent: false, submitAffordancePresent: false, formCount: 0, editableTextInputCount: 0, readonlyFieldCount: 0, listLikeContainerCount: 1 };
}

describe("issuance session — the app-exists path", () => {
  it("walks read → open-app guidance → VERIFY app_detail → api group → credentials → return → complete, never clicking", async () => {
    const { io, engine, driver, session } = build(EXISTING);
    startRun(io);
    await session.whenSettled();

    expect(engine.currentStage()).toBe("guidance_complete");
    expect(io.lastView()?.status).toBe("COMPLETED");
    // Step 2 (open the existing app) is guidance + an OBSERVED navigation: after the seller opens their app
    // (wait:open_app), the runtime RE-PROBES (probeSurface) to verify the app_detail landing before reusing the
    // calibrated api_group highlight. No control is "clicked" by the runtime.
    expect(driver.calls).toEqual([
      "probeSurface",
      "readApplications",
      "locate:open_app",
      "highlight:open_app",
      "observe:open_app",
      "wait:open_app",
      "probeSurface", // VERIFY_OPEN: confirm the seller reached app_detail
      "locate:api_group",
      "highlight:api_group",
      "observe:api_group",
      "wait:api_group",
      "locate:credentials",
      "highlight:credentials",
      "observe:credentials",
      "wait:credentials",
      "locate:return",
      "highlight:return",
      "observe:return",
      "wait:return",
      "cleanup",
    ]);
    // Step 2 used the OPEN copy/target for an existing application.
    const step2 = io.views().find((v) => v.currentStep?.stepNumber === 2)?.currentStep;
    expect(step2?.copyKey).toBe("actionWindow.issuance.openApp");
    expect(step2?.copyParams?.targetKind).toBe("open_app");
  });

  it("keeps totalSteps a fixed 5 for the whole run, carrying the issuance intent on every view", async () => {
    const { io, session } = build(EXISTING);
    startRun(io);
    await session.whenSettled();
    const totals = new Set(io.views().map((v) => v.currentStep!.totalSteps));
    expect(totals).toEqual(new Set([5]));
    for (const v of io.views()) expect(v.intent).toBe("API_ISSUANCE_GUIDANCE");
    for (const v of io.views()) expect(v.channelCode).toBe("naver");
  });
});

describe("issuance session — the no-app path", () => {
  it("guides CREATE instead of OPEN when the applications list is empty, then completes", async () => {
    const { io, engine, driver, session } = build(EMPTY);
    startRun(io);
    await session.whenSettled();

    expect(engine.currentStage()).toBe("guidance_complete");
    // The step-2 control is the CREATE control, not OPEN.
    expect(driver.calls).toContain("locate:create_app");
    expect(driver.calls).not.toContain("locate:open_app");
    const step2 = io.views().find((v) => v.currentStep?.stepNumber === 2)?.currentStep;
    expect(step2?.copyKey).toBe("actionWindow.issuance.createApp");
    expect(step2?.copyParams?.targetKind).toBe("create_app");
    // Then it converges on the same api_group → credentials → return tail.
    for (const t of ["api_group", "credentials", "return"]) expect(driver.calls).toContain(`locate:${t}`);
  });
});

describe("issuance session — the API-group barrier", () => {
  it("highlights the api_group control and rests at guiding_api_group until the seller acts", async () => {
    const { io, engine, driver, session } = build({ ...EXISTING, action: { api_group: false } });
    startRun(io);
    await session.whenSettled();

    expect(engine.currentStage()).toBe("guiding_api_group");
    expect(io.lastView()?.status).toBe("WAITING_FOR_HUMAN");
    // The api_group control was highlighted for step 3, and no later control was ever located.
    const highlighted = io.events().filter((e) => e.type === "TARGET_HIGHLIGHTED").map((e) => e.payload.stepId);
    expect(highlighted).toContain("aw.issuance_api_group");
    expect(driver.calls).not.toContain("locate:credentials");
    // The highlighted target ref is an opaque 16-hex, never a selector.
    const ref = io.events().find((e) => e.type === "TARGET_HIGHLIGHTED" && e.payload.stepId === "aw.issuance_api_group")!.payload.targetRef;
    expect(ref).toMatch(/^[0-9a-f]{16}$/);

    // Stop the barrier re-arm loop deterministically.
    command(io, "CANCEL_RUN", io.lastView()!.revision);
    await session.whenSettled();
  });
});

describe("issuance session — login wait", () => {
  it("parks recoverably on a login page, and a re-check after login resolves advances the run", async () => {
    const { io, engine, driver, session } = build({ ...EXISTING, probe: { ok: false, pageCategory: "login", blockerCode: "LOGIN_REQUIRED" } });
    startRun(io);
    await session.whenSettled();

    expect(engine.currentStage()).toBe("waiting_login");
    expect(io.lastView()?.status).toBe("WAITING_FOR_HUMAN");
    expect(io.lastView()?.blocker).toEqual({ code: "LOGIN_REQUIRED", recoverable: true });
    expect(io.lastView()?.allowedCommands).toContain("REQUEST_STEP_RECHECK");
    // A park that recovers by re-probing must NOT offer PAUSE_RUN (matching import's SESSION_BLOCKED).
    expect(io.lastView()?.allowedCommands).not.toContain("PAUSE_RUN");
    expect(io.eventTypes()).not.toContain("RUN_FAILED");

    // The seller logs in on their own screen, then re-checks. Re-probe finds the app list and drives on.
    driver.setProbe({ ok: true, pageCategory: "app_list" });
    command(io, "REQUEST_STEP_RECHECK", io.lastView()!.revision);
    await session.whenSettled();

    expect(engine.currentStage()).toBe("guidance_complete");
    // Three probes: the initial login park, the re-probe after login, and the VERIFY_OPEN app_detail check.
    expect(driver.calls.filter((c) => c === "probeSurface")).toHaveLength(3);
    expect(io.lastView()?.blocker).toBeUndefined();
  });
});

describe("issuance session — recoverable parks", () => {
  it("parks on target_not_found when a highlighted control cannot be located, and stays recoverable", async () => {
    // The existing-app open step succeeds (guidance + app_detail), then the calibrated api_group control fails
    // to locate → recoverable target_not_found.
    const { io, engine, driver, session } = build({ ...EXISTING, locate: { api_group: { count: 0 } } });
    startRun(io);
    await session.whenSettled();

    expect(engine.currentStage()).toBe("target_not_found");
    expect(io.blockers()).toContainEqual({ code: "TARGET_NOT_FOUND", recoverable: true });
    expect(io.lastView()?.status).toBe("WAITING_FOR_HUMAN");
    expect(io.eventTypes()).not.toContain("RUN_FAILED");
    // Never highlighted (locate failed first).
    expect(driver.calls).not.toContain("highlight:api_group");
  });

  it("parks on page_mismatch when the probed page is not where the tutorial expects", async () => {
    const { io, engine, session } = build({ ...EXISTING, probe: { ok: true, pageCategory: "unknown" } });
    startRun(io);
    await session.whenSettled();

    expect(engine.currentStage()).toBe("page_mismatch");
    expect(io.blockers()).toContainEqual({ code: "UI_DRIFT", recoverable: true });
    expect(io.lastView()?.status).toBe("WAITING_FOR_HUMAN");
    expect(io.eventTypes()).not.toContain("RUN_FAILED");
  });

  it("parks on page_mismatch when the seller opens the WRONG page (open_app verify is not app_detail)", async () => {
    // The seller navigated off the applications list, but did not reach the app detail (a wrong page / multiple
    // transitions). The VERIFY_OPEN re-probe finds a non-detail page → recoverable page_mismatch, step 2 NOT done.
    const { io, engine, session } = build({ ...EXISTING, openAppLanding: { ok: true, pageCategory: "unknown" } });
    startRun(io);
    await session.whenSettled();

    expect(engine.currentStage()).toBe("page_mismatch");
    expect(io.blockers()).toContainEqual({ code: "UI_DRIFT", recoverable: true });
    expect(io.lastView()?.status).toBe("WAITING_FOR_HUMAN");
    expect(io.eventTypes()).not.toContain("RUN_FAILED");
    // Step 2 never completed and api_group was never reached (no premature highlight on the wrong page).
    expect(io.eventTypes().filter((t) => t === "STEP_COMPLETED")).toHaveLength(1); // only step 1 (reach list)
  });

  it("parks on waiting_login when the session expires mid-open (open_app verify is a login page)", async () => {
    const { io, engine, session } = build({
      ...EXISTING,
      openAppLanding: { ok: false, pageCategory: "login", blockerCode: "LOGIN_REQUIRED" },
    });
    startRun(io);
    await session.whenSettled();

    expect(engine.currentStage()).toBe("waiting_login");
    expect(io.blockers()).toContainEqual({ code: "LOGIN_REQUIRED", recoverable: true });
  });

  it("parks on page_mismatch when the unique match drifts between locate and highlight", async () => {
    const { io, engine, session } = build({
      ...EXISTING,
      locate: { api_group: { count: 1, sig: "1111111111111111" } },
      highlight: { api_group: { count: 1, sig: "2222222222222222" } },
    });
    startRun(io);
    await session.whenSettled();

    expect(engine.currentStage()).toBe("page_mismatch");
    expect(io.blockers()).toContainEqual({ code: "UI_DRIFT", recoverable: true });
  });
});

describe("issuance session — post-navigation highlight reliability", () => {
  it("settles the surface before every locate (a guide never locates a still-navigating page)", async () => {
    const { io, engine, driver, session } = build(EXISTING);
    startRun(io);
    await session.whenSettled();

    expect(engine.currentStage()).toBe("guidance_complete");
    // The session settled the surface at the top of each guide, and EVERY locate happened after a settle — so a
    // fixed-label read never fires on a page that is still navigating (the live-proof execution-context race).
    expect(driver.settleCount).toBeGreaterThan(0);
    expect(driver.locateSettledFirst.length).toBeGreaterThan(0);
    expect(driver.locateSettledFirst.every(Boolean)).toBe(true);
  });

  it("reproduces the app_list→app_detail race: a locate that throws PARKS recoverably instead of stranding the run", async () => {
    // The seller opened their app; the very next api_group locate raced the navigation and threw
    // (execution-context-destroyed). The run must PARK recoverably on page_mismatch — never sit idle with no
    // barrier (the live-proof gap), never RUN_FAILED.
    const { io, engine, driver, session } = build({ ...EXISTING, locateThrows: { api_group: 1 } });
    startRun(io);
    await session.whenSettled();

    expect(engine.currentStage()).toBe("page_mismatch");
    expect(io.blockers()).toContainEqual({ code: "UI_DRIFT", recoverable: true });
    expect(io.lastView()?.status).toBe("WAITING_FOR_HUMAN");
    expect(io.lastView()?.blocker).toEqual({ code: "UI_DRIFT", recoverable: true });
    expect(io.lastView()?.allowedCommands).toContain("REQUEST_STEP_RECHECK");
    expect(io.eventTypes()).not.toContain("RUN_FAILED");
    // The throwing locate WAS preceded by a settle (the settle happened; the page still raced) — and the control
    // was never highlighted, so no half-highlight lingers.
    expect(driver.locateSettledFirst.every(Boolean)).toBe(true);
    expect(driver.calls).not.toContain("highlight:api_group");
  });

  it("recovers a raced locate: park → REQUEST_STEP_RECHECK re-guides → highlight succeeds → run completes", async () => {
    const { io, engine, driver, session } = build({ ...EXISTING, locateThrows: { api_group: 1 } });
    startRun(io);
    await session.whenSettled();
    expect(engine.currentStage()).toBe("page_mismatch");

    // "I did it, look again": the recheck re-settles + re-guides the SAME control on the now-stable page.
    command(io, "REQUEST_STEP_RECHECK", io.lastView()!.revision);
    await session.whenSettled();

    expect(engine.currentStage()).toBe("guidance_complete");
    expect(io.lastView()?.status).toBe("COMPLETED");
    // api_group was highlighted and observed EXACTLY ONCE (the failed attempt threw before highlighting; the
    // recovery highlighted once) — no duplicate highlight / observer arm.
    expect(driver.calls.filter((c) => c === "highlight:api_group")).toHaveLength(1);
    expect(driver.calls.filter((c) => c === "observe:api_group")).toHaveLength(1);
  });

  it("recovers a race that throws during HIGHLIGHT too, clearing the half-highlight before it re-guides", async () => {
    // A clean locate, then the highlight read raced the navigation and threw. Same recoverable park; on recovery
    // the engine returns CLEAR_HIGHLIGHT so the half-applied annotation is dropped before the control is re-guided.
    const { io, engine, driver, session } = build({ ...EXISTING, highlightThrows: { api_group: 1 } });
    startRun(io);
    await session.whenSettled();
    expect(engine.currentStage()).toBe("page_mismatch");
    expect(driver.calls).toContain("clearHighlight");

    command(io, "REQUEST_STEP_RECHECK", io.lastView()!.revision);
    await session.whenSettled();
    expect(engine.currentStage()).toBe("guidance_complete");
    expect(io.eventTypes()).not.toContain("RUN_FAILED");
  });

  it("applies the same recovery to a create_app race (the empty-app branch), not only api_group", async () => {
    // Reliability is target-generic: the empty-app step-2 create control gets the same settle + park + re-guide.
    const { io, engine, session } = build({ ...EMPTY, locateThrows: { create_app: 1 } });
    startRun(io);
    await session.whenSettled();
    expect(engine.currentStage()).toBe("page_mismatch");

    command(io, "REQUEST_STEP_RECHECK", io.lastView()!.revision);
    await session.whenSettled();
    expect(engine.currentStage()).toBe("guidance_complete");
  });

  it("drops the re-guide latch when the seller CLOSES the window mid-fault, so a recheck re-probes instead", async () => {
    // A drive fault armed a re-guide of api_group. If the seller then closes the API-center window and reopens it
    // (possibly landing back on the applications list), the recheck must NOT re-guide api_group on the wrong page —
    // a surface close clears the latch so the recovery re-probes from the top.
    const { io, engine, driver, session } = build({ ...EXISTING, locateThrows: { api_group: 1 } });
    startRun(io);
    await session.whenSettled();
    expect(engine.currentStage()).toBe("page_mismatch");
    const locatesBefore = driver.calls.filter((c) => c === "locate:api_group").length; // 1 (the thrown attempt)
    const probesBefore = driver.calls.filter((c) => c === "probeSurface").length;

    driver.closeSurface();
    await session.whenSettled();

    command(io, "REQUEST_STEP_RECHECK", io.lastView()!.revision);
    await session.whenSettled();

    // The recovery re-PROBED (latch dropped) rather than re-running the throwing api_group locate.
    expect(driver.calls.filter((c) => c === "locate:api_group").length).toBe(locatesBefore);
    expect(driver.calls.filter((c) => c === "probeSurface").length).toBeGreaterThan(probesBefore);
    expect(io.eventTypes()).not.toContain("RUN_FAILED");
  });

  it("does NOT retry a PERMANENT locate fault forever — it stops re-guiding after the cap and re-probes", async () => {
    // A page that destroys the execution context on EVERY read. The engine re-guides a bounded number of times
    // (settle + recheck cannot help a genuinely broken page), then stops re-running the throwing locate: a recheck
    // re-probes from the top instead, so an auto-recheck loop cannot spin the fault forever.
    const { io, engine, driver, session } = build({ ...EXISTING, locateThrows: { api_group: 99 } });
    startRun(io);
    await session.whenSettled();
    expect(engine.currentStage()).toBe("page_mismatch");

    const probesBefore = driver.calls.filter((c) => c === "probeSurface").length;
    for (let i = 0; i < 6; i++) {
      command(io, "REQUEST_STEP_RECHECK", io.lastView()!.revision, `rc${i}`);
      await session.whenSettled();
    }

    // The throwing locate ran at most MAX_CONSECUTIVE_DRIVE_FAULTS + 1 times (initial + 3 re-guides), never more,
    // no matter how many rechecks arrive — the permanent fault stopped being re-run.
    expect(driver.calls.filter((c) => c === "locate:api_group")).toHaveLength(4);
    // Past the cap, rechecks re-PROBE the surface instead of re-locating the throwing control.
    expect(driver.calls.filter((c) => c === "probeSurface").length).toBeGreaterThan(probesBefore);
    // Still a recoverable park, never a hard failure.
    expect(engine.currentStage()).toBe("page_mismatch");
    expect(io.eventTypes()).not.toContain("RUN_FAILED");
    expect(io.lastView()?.blocker).toEqual({ code: "UI_DRIFT", recoverable: true });
  });

  it("keeps every reliability-path view + event contract-valid and prohibited-field-free", async () => {
    for (const script of [
      { ...EXISTING, locateThrows: { api_group: 1 } as Partial<Record<string, number>> },
      { ...EXISTING, highlightThrows: { api_group: 1 } as Partial<Record<string, number>> },
      { ...EXISTING, locateThrows: { api_group: 99 } as Partial<Record<string, number>> },
    ]) {
      const { io, session } = build(script as IssuanceFixtureScript);
      startRun(io);
      await session.whenSettled();
      // Push one recovery cycle through as well, so the re-guide views are covered.
      command(io, "REQUEST_STEP_RECHECK", io.lastView()!.revision);
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
});

describe("issuance session — operator control", () => {
  it("aborts to operator_aborted / CANCELLED and cleans up", async () => {
    const { io, engine, driver, session } = build({ ...EXISTING, action: { open_app: false } });
    startRun(io);
    await session.whenSettled();
    expect(engine.currentStage()).toBe("guiding_app_detail");

    command(io, "CANCEL_RUN", io.lastView()!.revision);
    await session.whenSettled();

    expect(engine.currentStage()).toBe("operator_aborted");
    expect(io.lastView()?.status).toBe("CANCELLED");
    expect(driver.cleanupCount()).toBeGreaterThanOrEqual(1);
    expect(io.eventTypes()).not.toContain("RUN_COMPLETED");
  });

  it("leaving for the manual path neither fails nor completes the run", async () => {
    const { io, engine, session } = build({ ...EXISTING, action: { open_app: false } });
    startRun(io);
    await session.whenSettled();

    command(io, "SWITCH_TO_MANUAL", io.lastView()!.revision);
    await session.whenSettled();

    expect(engine.currentStage()).toBe("operator_aborted");
    expect(io.eventTypes()).not.toContain("RUN_COMPLETED");
    expect(io.eventTypes()).not.toContain("RUN_FAILED");
  });

  it("pauses a barrier and resumes onto the same control", async () => {
    const { io, engine, driver, session } = build({ ...EXISTING, action: { open_app: false } });
    startRun(io);
    await session.whenSettled();
    expect(engine.currentStage()).toBe("guiding_app_detail");
    expect(io.lastView()?.allowedCommands).toContain("PAUSE_RUN");

    command(io, "PAUSE_RUN", io.lastView()!.revision);
    await session.whenSettled();
    expect(io.lastView()?.status).toBe("PAUSED");
    expect(io.lastView()?.allowedCommands).toEqual(["RESUME_RUN", "CANCEL_RUN"]);

    // Resume re-arms observation of the SAME control; the seller has still not acted, so it rests there again.
    command(io, "RESUME_RUN", io.lastView()!.revision);
    await session.whenSettled();
    expect(io.lastView()?.status).toBe("WAITING_FOR_HUMAN");
    expect(engine.currentStage()).toBe("guiding_app_detail");

    // Stop the barrier re-arm loop deterministically.
    command(io, "CANCEL_RUN", io.lastView()!.revision);
    await session.whenSettled();
  });

  it("rejects a stale-revision command", async () => {
    const { io, engine, session } = build({ ...EXISTING, action: { open_app: false } });
    startRun(io);
    await session.whenSettled();

    command(io, "PAUSE_RUN", 0, "stale");
    const result = io.sent
      .filter((f) => f.kind === "aw_command_result")
      .map((f) => f as { commandId: string; accepted: boolean; reason?: string })
      .find((r) => r.commandId === "stale");
    expect(result?.accepted).toBe(false);
    expect(result?.reason).toBe("STALE_REVISION");
    expect(engine.currentStage()).toBe("guiding_app_detail");

    command(io, "CANCEL_RUN", io.lastView()!.revision);
    await session.whenSettled();
  });

  it("treats a replayed START_RUN as idempotent and rejects a pre-start command", async () => {
    const { io, engine, session } = build({ ...EXISTING, action: { open_app: false } });
    // Before START: a command is refused.
    command(io, "PAUSE_RUN", 0, "pre");
    const pre = io.sent.filter((f) => f.kind === "aw_command_result").find((f) => (f as { commandId: string }).commandId === "pre");
    expect((pre as { accepted: boolean }).accepted).toBe(false);

    startRun(io);
    await session.whenSettled();
    const rev = engine.view().revision;
    startRun(io, rev); // replay
    await session.whenSettled();
    expect(engine.view().revision).toBe(rev);

    command(io, "CANCEL_RUN", engine.view().revision);
    await session.whenSettled();
  });
});

describe("issuance session — contract validity + privacy", () => {
  it("emits only contract-VALID v2 events and views, with no prohibited fields, across every path", async () => {
    // Each script reaches a settled state (complete, or a non-spinning recoverable park) — no barrier is
    // left open, so no background re-arm loop leaks past the assertions.
    for (const script of [
      EXISTING,
      EMPTY,
      { ...EXISTING, probe: { ok: false, pageCategory: "login" as const, blockerCode: "LOGIN_REQUIRED" as const } },
      { ...EXISTING, locate: { api_group: { count: 0 } } },
      { ...EXISTING, openAppLanding: { ok: true, pageCategory: "unknown" as const } },
      { ...EXISTING, probe: { ok: true, pageCategory: "unknown" as const } },
    ]) {
      const { io, session } = build(script);
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
    const { io, session } = build(EXISTING);
    startRun(io);
    await session.whenSettled();
    const wire = JSON.stringify(io.sent);
    expect(wire).not.toContain("data-aw-target");
    expect(wire).not.toContain("apicenter");
    expect(wire).not.toContain("http");
  });
});

describe("issuance session — loopback E2E over the real v2 transport", () => {
  it("drives the app-exists happy path to a COMPLETED view the client receives", async () => {
    const { client, server } = createLoopbackChannel();
    const engine = new IssuanceEngine({ runId: RUN_ID, channelCode: "naver" }, { clock: makeIssuanceClock() });
    const driver = new IssuanceFixtureDriver(EXISTING);
    const session = new IssuanceGuidanceSession(engine, driver, server, { rearmDelayMs: 1 });
    session.attach();

    const clientViews: ActionWindowRunView[] = [];
    client.subscribe((frame) => {
      if (frame.kind === "aw_view") clientViews.push(frame.view);
    });

    client.send({
      kind: "aw_command",
      command: { protocolVersion: 2, commandId: "e2e1", runId: RUN_ID, expectedRevision: 0, type: "START_RUN", payload: { channelCode: "naver", intent: "API_ISSUANCE_GUIDANCE" } },
    });
    await session.whenSettled();

    expect(engine.currentStage()).toBe("guidance_complete");
    const last = clientViews[clientViews.length - 1];
    expect(last?.status).toBe("COMPLETED");
    expect(last?.intent).toBe("API_ISSUANCE_GUIDANCE");
    // Every view that crossed the real (serialize/deserialize) wire is contract-valid.
    for (const v of clientViews) expect(validateRunView(v)).toEqual({ ok: true });
  });
});
