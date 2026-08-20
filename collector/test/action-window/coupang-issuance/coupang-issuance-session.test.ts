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
import type { CredentialHandoffSeamResult } from "../../../src/action-window/coupang-issuance/coupang-issuance-session";
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

function build(
  script: CoupangIssuanceFixtureScript = {},
  waitOpts?: {
    surfaceWaitPollMs?: number;
    surfaceWaitTimeoutMs?: number;
    /**
     * The handoff seam. Present by DEFAULT and storing, because the walk no longer completes on the seller's
     * return from WING — it rests on their consent, and the credential reaching the vault is what finishes it.
     * A test that is about the refusal path passes its own (or `null` to have none at all).
     */
    credentialHandoff?: ((capability: string) => Promise<CredentialHandoffSeamResult>) | null;
  },
) {
  const io = loopback();
  const engine = new CoupangIssuanceEngine({ runId: RUN_ID, channelCode: "coupang" }, { clock: makeCoupangIssuanceClock() });
  const driver = new CoupangIssuanceFixtureDriver(script);
  const handoff =
    waitOpts && "credentialHandoff" in waitOpts
      ? waitOpts.credentialHandoff
      : async () => ({ stored: true, connectionStatus: "SUCCESS" });
  const { credentialHandoff: _ignored, ...waits } = waitOpts ?? {};
  const session = new CoupangIssuanceGuidanceSession(engine, driver, io.transport, {
    rearmDelayMs: 1,
    surfaceWaitPollMs: 0,
    surfaceWaitTimeoutMs: 20,
    ...waits,
    ...(handoff ? { credentialHandoff: handoff } : {}),
  });
  session.attach();
  return { io, engine, driver, session };
}

/** One macrotask. Lets a test observe the run MID-watch, which `whenSettled` by definition cannot. */
const tick = (): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, 0));

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
    if (engine.currentStage() === "awaiting_handoff_consent") {
      await consentToHandoff(io, session, `hx${i}`);
      continue;
    }
    command(io, "REQUEST_STEP_RECHECK", io.lastView()!.revision, `nx${i}`);
    await session.whenSettled();
  }
}

/**
 * The seller's "키 읽어서 저장하기" press — the ONE thing that finishes this walk.
 *
 * The run rests in `awaiting_handoff_consent` until this arrives; the credential reaching the vault is what
 * completes it. A test that drives to COMPLETED without this is asserting the old flow, where the walk finished
 * over an empty vault and the product then asked the seller to type the keys by hand.
 */
async function consentToHandoff(
  io: ReturnType<typeof loopback>,
  session: CoupangIssuanceGuidanceSession,
  id = "handoff",
): Promise<void> {
  io.send({
    kind: "aw_command",
    command: {
      protocolVersion: 2,
      commandId: id,
      runId: RUN_ID,
      expectedRevision: io.lastView()!.revision,
      type: "REQUEST_STEP_RECHECK",
      payload: { credentialHandoffAuthorization: "f".repeat(32) } as never,
    },
  });
  await session.whenSettled();
}

describe("coupang issuance session — the full linear walkthrough (offline)", () => {
  it("reach → verify → 발급 → 확인 → terms → key → … → credentials → complete on WING-resident advances ALONE (a single START_RUN, no FE 다음)", async () => {
    const { io, engine, driver, session } = build();
    startRun(io);
    await session.whenSettled();
    // The WHOLE walk drives to completion from a single START_RUN: the reach_open_api navigation is observed, then
    // every same-page checkpoint advances when the driver reports the seller pressed its WING-RESIDENT advance
    // button (the fixture's default action) — no REQUEST_STEP_RECHECK from the FE is ever sent.

    // The walk drives itself to the seller's consent and RESTS there — the return from WING is a navigation,
    // not a completion. The credential reaching the vault is what finishes this run, so the press is part of
    // the happy path now rather than an extra.
    await consentToHandoff(io, session);
    expect(engine.currentStage()).toBe("guidance_complete");
    expect(io.lastView()?.status).toBe("COMPLETED");
    expect(driver.calls).toEqual([
      "probeSurface", // initial probe → wing_home
      "locate:reach_open_api",
      "highlight:reach_open_api",
      "observe:reach_open_api", // transition-observe: arm the navigation watch
      "wait:reach_open_api",
      "probeSurface", // VERIFY_REACH: confirm the seller reached the open-API issuance page
      // …and then, before the first control on the path to creating a key, whether one already exists.
      "probeCredentialState",
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
      "highlight:issue_final", // MEASURED not to create a key — it opens the vendor-method screen
      "observe:issue_final",
      "wait:issue_final",
      "locate:vendor_method",
      "highlight:vendor_method",
      "observe:vendor_method",
      "wait:vendor_method",
      "locate:vendor_confirm",
      "highlight:vendor_confirm", // ⚠ THE KEY-CREATION CONTROL — highlighted, never pressed by SellerOps
      "observe:vendor_confirm",
      "wait:vendor_confirm", // …the seller presses it; only now can a credential exist
      "locate:credentials",
      // The LAST step: the keys are on screen and its CTA is the seller's CONSENT, pressed where the values
      // are. It navigates nothing and completes nothing — SellerOps performs the handoff under it.
      "highlight:credentials",
      "observe:credentials",
      "wait:credentials",
      // …and from here the walk is about the handoff, on the same window: it says it is working, the run
      // completes (cleanup), and the success panel goes up. The press that returns the seller is watched for
      // afterwards and is deliberately NOT part of this sequence — the run is settled by then, waiting on a
      // person for as long as they take (see the outcome-panel test below).
      "handoffPanel:WORKING",
      "cleanup",
      "handoffPanel:STORED",
    ]);
    // PROOF the FE never drove a STEP. Two commands reach the session across the whole walk and neither one
    // advances anything in WING: the seller's START_RUN, and their consent to store the key at the end. Every
    // step in between advanced on the WING-resident button, observed.
    const commandResults = io.sent.filter((f) => f.kind === "aw_command_result");
    expect(commandResults).toHaveLength(2);
  });

  it("keeps totalSteps a fixed 8, carrying the coupang channel + issuance intent + NO appBranch on every view", async () => {
    const { io, session } = build();
    startRun(io);
    await session.whenSettled();
    const totals = new Set(io.views().map((v) => v.currentStep!.totalSteps));
    expect(totals).toEqual(new Set([8]));
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
    // No reach_open_api guidance at all — step 1 auto-completed. The first thing that happens is the
    // credential-state read, and only a positive NO_KEY lets the walk go on to 발급.
    expect(driver.calls).not.toContain("locate:reach_open_api");
    expect(driver.calls[1]).toBe("probeCredentialState");
    expect(driver.calls[2]).toBe("locate:issue");
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
    // The walk drives itself to the seller's consent and RESTS there — the return from WING is a navigation,
    // not a completion. The credential reaching the vault is what finishes this run, so the press is part of
    // the happy path now rather than an extra.
    await consentToHandoff(io, session);
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
    // The walk drives itself to the seller's consent and RESTS there — the return from WING is a navigation,
    // not a completion. The credential reaching the vault is what finishes this run, so the press is part of
    // the happy path now rather than an extra.
    await consentToHandoff(io, session);
    expect(engine.currentStage()).toBe("guidance_complete");
    // Re-located (target re-find) — more than the one throwing attempt.
    expect(driver.calls.filter((c) => c === "locate:confirm_purpose").length).toBeGreaterThan(1);
    // …and the recovery added NO surface probe: exactly the two the walk always does (the opening read and
    // the reach verification). The seller never left the issuance page, so re-reading it would be wasted work.
    expect(driver.calls.filter((c) => c === "probeSurface").length).toBe(2);
  });

  it("**a throw DURING self-recovery reaches the engine — the recovery loop is not silently ended**", async () => {
    // TWO races on the same locate: the first parks, and the second happens inside the self-recovery drive.
    // `maybeRecoverPark` swallows whatever escapes its loop, and `recoverPark` awaited `this.drive(...)` bare
    // rather than through `onDriveError` — so the second throw ended the loop with `onDriveFault` never called,
    // no state published, and nothing left to restart it (this loop only starts at the END of a drive chain,
    // and that chain WAS this one). The run would sit parked forever. The navigation race is the very thing
    // this path exists for, so it is the one throw that must not be dropped.
    const { io, engine, driver, session } = build({ locateThrows: { confirm_purpose: 2 } });
    startRun(io);
    await session.whenSettled();
    // The walk drives itself to the seller's consent and RESTS there — the return from WING is a navigation,
    // not a completion. The credential reaching the vault is what finishes this run, so the press is part of
    // the happy path now rather than an extra.
    await consentToHandoff(io, session);
    expect(engine.currentStage()).toBe("guidance_complete");
    // Three attempts: the two that raced and the one that landed.
    expect(driver.calls.filter((c) => c === "locate:confirm_purpose").length).toBeGreaterThanOrEqual(3);
    expect(io.eventTypes()).not.toContain("RUN_FAILED");
    // The second fault was PUBLISHED, not swallowed — the frontend saw the park both times.
    expect(io.blockers().filter((b) => b.code === "UI_DRIFT").length).toBeGreaterThanOrEqual(2);
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
    const { io, session } = build({ reachLanding: { ok: true, pageCategory: "unknown" } });
    startRun(io);
    await session.whenSettled();
    // A wait, not a park: no blocker is raised while it watches, nothing asks the seller to do anything, and the
    // run keeps re-reading WING. Asserted on the VIEWS rather than the final stage, because this harness runs a
    // 20 ms watch to keep the suite deterministic, so `whenSettled` necessarily returns after it has elapsed.
    expect(io.views().some((v) => v.status === "RUNNING" && v.blocker === undefined)).toBe(true);
    // The old park's message — "화면이 바뀐 것 같아요" — is what this stage exists to stop showing a seller who is
    // merely still on their way. It must not be raised, not while waiting and not on expiry.
    expect(io.blockers()).not.toContainEqual({ code: "UI_DRIFT", recoverable: true });
    expect(io.eventTypes()).not.toContain("RUN_FAILED");
  });
});

describe("coupang issuance session — a window the SELLER closed is never re-opened by a timer", () => {
  it("**park recovery does not run after a close** — the agent must not re-open a marketplace window", async () => {
    // Self-recovery drives a `{guide}`, which settles and locates; the lazy driver brings a window up on its
    // FIRST call, so a timer-issued recheck re-opens the window the seller had just deliberately closed — and
    // re-navigates it — once a second for ten minutes. `agentNavigations: 1` says the walk opens one window, at
    // open, and never again. The engine's own note on this park says how it recovers: "re-opening and a
    // REQUEST_STEP_RECHECK", both of which are the SELLER's.
    const { io, engine, driver, session } = build({ action: { issue: false } });
    startRun(io);
    await session.whenSettled();
    expect(engine.currentStage()).toBe("checkpoint_reveal_issuance_form");
    const callsBefore = driver.calls.length;

    driver.closeSurface();
    await session.whenSettled();
    expect(engine.currentStage()).toBe("page_mismatch");
    // SURFACE_CLOSED, not UI_DRIFT: "화면이 바뀐 것 같아요" is the wrong thing to tell someone who knows exactly
    // what happened — they closed the window — and it hides the one instruction that helps ("다시 확인을 누르면
    // 창을 다시 열어 드릴게요").
    expect(io.blockers()).toContainEqual({ code: "SURFACE_CLOSED", recoverable: true });
    expect(io.blockers()).not.toContainEqual({ code: "UI_DRIFT", recoverable: true });
    // Whatever the run did on the way into the park, it must then STOP — and "stop" means NO driver call at
    // all, not merely no locate/highlight/probe: the lazy driver opens a window on ANY call, so a highlight
    // clear or a credential read resurrects the window just as surely as a probe does.
    expect(driver.calls.slice(callsBefore)).toEqual([]);
  });

  it("…and the seller's own re-check DOES recover it — the button is the one re-open that was theirs", async () => {
    const { io, engine, driver, session } = build({ action: { issue: false } });
    startRun(io);
    await session.whenSettled();
    driver.closeSurface();
    await session.whenSettled();
    expect(engine.currentStage()).toBe("page_mismatch");
    const callsBefore = driver.calls.length;

    command(io, "REQUEST_STEP_RECHECK", io.lastView()!.revision);
    await session.whenSettled();
    // Re-guided, so the run is live again rather than parked forever — the latch blocks a TIMER, not a seller.
    expect(driver.calls.slice(callsBefore).some((c) => c.startsWith("locate:"))).toBe(true);
    expect(engine.currentStage()).not.toBe("page_mismatch");
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
    const session = new CoupangIssuanceGuidanceSession(engine, driver, server, {
      rearmDelayMs: 1,
      surfaceWaitPollMs: 0,
      surfaceWaitTimeoutMs: 20,
      // The walk rests on the seller's consent; a stored credential is what completes it.
      credentialHandoff: async () => ({ stored: true, connectionStatus: "SUCCESS" }),
    });
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

    // The walk drives itself to the seller's consent and RESTS there — the return from WING is a navigation,
    // not a completion. The credential reaching the vault is what finishes this run, so the press is part of
    // the happy path now rather than an extra.
    client.send({
      kind: "aw_command",
      command: {
        protocolVersion: 2,
        commandId: "e2e-handoff",
        runId: RUN_ID,
        expectedRevision: clientViews[clientViews.length - 1]!.revision,
        type: "REQUEST_STEP_RECHECK",
        payload: { credentialHandoffAuthorization: "f".repeat(32) } as never,
      },
    });
    await session.whenSettled();

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
    // The walk drives itself to the seller's consent and RESTS there — the return from WING is a navigation,
    // not a completion. The credential reaching the vault is what finishes this run, so the press is part of
    // the happy path now rather than an extra.
    await consentToHandoff(io, session);
    expect(engine.currentStage()).toBe("guidance_complete");
    expect(engine.view().blocker).toBeUndefined();
  });

  it("holds no blocker while merely waiting — 'not there yet' is not drift", async () => {
    const { io, session } = build({ probeSequence: [BLANK] });
    startRun(io);
    await session.whenSettled();
    // Every view published WHILE the watch ran reports RUNNING and carries no blocker — the seller is asked for
    // nothing. (The final view is the expiry park; that is the test below.)
    const whileWaiting = io.views().filter((v) => v.status === "RUNNING");
    expect(whileWaiting.length).toBeGreaterThan(0);
    for (const v of whileWaiting) expect(v.blocker).toBeUndefined();
  });

  it("**the wait is not a dead end when its window elapses — it parks RECOVERABLY**", async () => {
    // The defect this replaces: the loop was bounded and simply `return`ed. `awaiting_wing_surface` is
    // deliberately not a park stage, so nothing restarted it AND the automatic-stage command list omits
    // `REQUEST_STEP_RECHECK` — a seller who needed longer than the window (2FA, a password reset) was left in a
    // run reporting RUNNING with no blocker and nothing to press. The park it replaced was recoverable.
    const { engine, io, session } = build({ probeSequence: [BLANK] });
    startRun(io);
    await session.whenSettled();

    const view = io.lastView()!;
    expect(view.status).toBe("WAITING_FOR_HUMAN");
    // "화면이 아직 준비되지 않았어요" — what actually happened. NOT `UI_DRIFT`, whose "화면이 바뀐 것 같아요" is the
    // message this stage was created to stop showing someone who was simply not there yet.
    expect(view.blocker).toEqual({ code: "SURFACE_SETTLE_TIMEOUT", recoverable: true });
    expect(view.allowedCommands).toContain("REQUEST_STEP_RECHECK");
    expect(io.eventTypes()).not.toContain("RUN_FAILED");
    expect(engine.currentStage()).toBe("page_mismatch");
  });

  it("…and that recheck actually re-probes and drives the run on", async () => {
    // Recoverable has to mean recovered, not just labelled: the seller presses 다시 확인, the surface is read
    // again, and the walk proceeds from wherever they now are. A ONE-poll watch, so the expiry park is reached
    // while the fixture still has an unread `ISSUANCE` left for the recheck's own probe.
    const { engine, io, session } = build({ probeSequence: [BLANK, BLANK, ISSUANCE] }, { surfaceWaitPollMs: 1, surfaceWaitTimeoutMs: 1 });
    startRun(io);
    await session.whenSettled();
    expect(engine.currentStage()).toBe("page_mismatch");

    command(io, "REQUEST_STEP_RECHECK", io.lastView()!.revision);
    await session.whenSettled();
    // The walk drives itself to the seller's consent and RESTS there — the return from WING is a navigation,
    // not a completion. The credential reaching the vault is what finishes this run, so the press is part of
    // the happy path now rather than an extra.
    await consentToHandoff(io, session);
    expect(engine.currentStage()).toBe("guidance_complete");
    expect(io.lastView()?.blocker).toBeUndefined();
  });

  it("**a SECOND surface watch is never started beside the first**", async () => {
    // `waiting_login` IS a park, so while the watch polls the FE is offered `REQUEST_STEP_RECHECK`. Pressing it
    // re-probed → login again → a second watch, alive beside the first. When the seller then reached the
    // issuance page BOTH reported it before either narrowed the stage: `STEP_COMPLETED` for step 1 twice, two
    // `{guide:"issue"}` chains, duplicate STEP_READY / HUMAN_ACTION_REQUIRED / TARGET_HIGHLIGHTED, and two
    // observers on one target.
    //
    // Reproduced by sending the recheck MID-watch (the only moment it can happen), so this cannot pass by the
    // first watch having quietly ended first.
    const { engine, io, session } = build(
      { probeSequence: [LOGIN, LOGIN, LOGIN, LOGIN, ISSUANCE] },
      { surfaceWaitTimeoutMs: 500 },
    );
    startRun(io);
    for (let i = 0; i < 50 && engine.currentStage() !== "waiting_login"; i++) await tick();
    expect(engine.currentStage()).toBe("waiting_login");
    command(io, "REQUEST_STEP_RECHECK", io.lastView()!.revision, "midwatch");
    // The command must have been ACCEPTED, or this test would pass by never reproducing the race at all.
    expect(io.sent.filter((f) => f.kind === "aw_command_result").map((f) => f as unknown as { commandId: string; accepted: boolean })).toContainEqual({
      kind: "aw_command_result",
      commandId: "midwatch",
      accepted: true,
    });
    await session.whenSettled();

    // Whatever the interleaving, step 1 completes ONCE and each step is highlighted at most once.
    const completions = io.events().filter((e) => e.type === "STEP_COMPLETED" && e.payload.stepId === "aw.coupang_issuance_reach_open_api");
    expect(completions).toHaveLength(1);
    const highlights = io.events().filter((e) => e.type === "TARGET_HIGHLIGHTED").map((e) => e.payload.stepId);
    expect(highlights.length).toBe(new Set(highlights).size);
  });

  it("waits through a login and picks the run up afterwards, with no command from the frontend", async () => {
    const { engine, io, session } = build({ probeSequence: [LOGIN, LOGIN, ISSUANCE] });
    startRun(io);
    await session.whenSettled();
    // The walk drives itself to the seller's consent and RESTS there — the return from WING is a navigation,
    // not a completion. The credential reaching the vault is what finishes this run, so the press is part of
    // the happy path now rather than an extra.
    await consentToHandoff(io, session);
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

/**
 * The consent step's ORDER. Its panel carries the only instruction that says "read the terms and decide", so it
 * has to be on screen before anything can advance past it — including the instant advance a seller gets when
 * they had already ticked both boxes before the step began.
 *
 * Ordering only. No dwell, no timer, no extra button: if both boxes are already ticked the run moves straight
 * to the key-creation checkpoint, which is the correct behaviour for someone who has already decided.
 */
describe("coupang issuance session — the consent panel is mounted before it is observed", () => {
  it("highlights (mounts the panel) before arming the observation, for every guided step", async () => {
    const { io, engine, driver, session } = build();
    startRun(io);
    await session.whenSettled();
    await pressNextToComplete(io, engine, session).catch(() => undefined);
    {
      const calls = driver.calls;
      for (const target of ["issue", "confirm_purpose", "terms_consent", "issue_final"]) {
        const highlighted = calls.indexOf(`highlight:${target}`);
        const observed = calls.indexOf(`observe:${target}`);
        if (highlighted === -1 || observed === -1) continue;
        // A step whose observation could resolve before its panel exists would advance past an instruction the
        // seller never saw — and for consent that instruction is the whole point of the step.
        expect(highlighted, `${target}: panel must mount before the observation arms`).toBeLessThan(observed);
      }
    }
  });
});

/**
 * **Finding the WING window again.**
 *
 * The walk lives in a window SellerOps opened, and a seller who switches away can lose it behind everything
 * else — reported live on 2026-08-12, with the connect screen offering no way back. `FIND_CURRENT_STEP` was
 * already allowed at every non-terminal stage and did nothing; it now means "raise the window I am in".
 */
describe("coupang issuance session — bringing the WING window back to the front", () => {
  it("**raises the surface when the seller asks**, and stays a no-op for the engine", async () => {
    // A script where the seller has NOT acted yet, so the run rests at a barrier — the state they are actually
    // in when they lose the window behind another one.
    const { io, driver, session } = build({ action: { reach_open_api: false } });
    let focused = 0;
    (driver as unknown as { focusSurface: () => Promise<boolean> }).focusSurface = async () => {
      focused += 1;
      return true;
    };
    startRun(io);
    await session.whenSettled();
    const revision = io.lastView()!.revision;
    command(io, "FIND_CURRENT_STEP", revision, "focus1");
    await session.whenSettled();
    await tick();
    // eslint-disable-next-line no-console
    expect(focused).toBe(1);
    // A raise is not progress: the run must not advance, complete a step, or change stage because the seller
    // looked for their own window.
    expect(io.lastView()!.currentStep?.stepId).toBe(io.views().at(-2)?.currentStep?.stepId);
  });

  it("no other command raises it — a window that jumps forward uninvited is its own defect", async () => {
    const { io, driver, session } = build({ action: { reach_open_api: false } });
    let focused = 0;
    (driver as unknown as { focusSurface: () => Promise<boolean> }).focusSurface = async () => {
      focused += 1;
      return true;
    };
    startRun(io);
    await session.whenSettled();
    command(io, "REQUEST_STEP_RECHECK", io.lastView()!.revision, "rc1");
    await session.whenSettled();
    await tick();
    expect(focused).toBe(0);
  });

  it("a driver that cannot raise anything is not an error — the run carries on", async () => {
    // The fixture driver has no `focusSurface` at all, which is the shape of every driver that is not the live
    // walk. The command must still be accepted and the run must be untouched.
    const { io, session, engine } = build({ action: { reach_open_api: false } });
    startRun(io);
    await session.whenSettled();
    const stage = engine.currentStage();
    command(io, "FIND_CURRENT_STEP", io.lastView()!.revision, "focus2");
    await session.whenSettled();
    await tick();
    const result = io.sent.filter((f) => f.kind === "aw_command_result").at(-1) as { accepted: boolean };
    expect(result.accepted).toBe(true);
    expect(engine.currentStage()).toBe(stage);
  });
});

/* ─────────────── D2: the session's half of the credential-state gate ─────────────── */

describe("coupang issuance session — the credential-state read, and what happens without it", () => {
  it("**a driver that cannot answer answers UNKNOWN**, and the run parks rather than walking", async () => {
    // The failure this closes is not a page being ambiguous — it is a DRIVER being old. Treating a missing
    // capability as "no key" is the one wrong answer that walks a seller into creating a second one, and it
    // would be given silently, by code that looks like it is doing nothing.
    const io = loopback();
    const engine = new CoupangIssuanceEngine({ runId: RUN_ID, channelCode: "coupang" }, { clock: makeCoupangIssuanceClock() });
    const real = new CoupangIssuanceFixtureDriver({ probe: { ok: true, pageCategory: "open_api_issuance" } });
    // A driver from before this capability existed: everything else works, and the optional method is absent.
    const legacy = new Proxy(real, {
      get: (t, p, r) => (p === "probeCredentialState" ? undefined : Reflect.get(t, p, r)),
      has: (t, p) => (p === "probeCredentialState" ? false : Reflect.has(t, p)),
    });
    const session = new CoupangIssuanceGuidanceSession(engine, legacy, io.transport, {
      rearmDelayMs: 1,
      surfaceWaitPollMs: 0,
      surfaceWaitTimeoutMs: 20,
    });
    session.attach();
    startRun(io);
    await session.whenSettled();
    expect(engine.currentStage()).toBe("credential_state_unknown");
    expect(engine.view().blocker?.code).toBe("CREDENTIAL_STATE_UNKNOWN");
    expect(real.calls).not.toContain("locate:issue");
  });

  it("KEY_PRESENT skips every control on the path to creating a key", async () => {
    const { engine, driver, session, io } = build({
      probe: { ok: true, pageCategory: "open_api_issuance" },
      credentialState: "KEY_PRESENT",
    });
    startRun(io);
    await session.whenSettled();
    // The ONLY control guided is the hand-off. 발급, the terms screen, and the key-creating 확인 are not
    // highlighted, not armed, and not observed.
    for (const target of ["issue", "confirm_purpose", "terms_consent", "issue_final", "vendor_method", "vendor_confirm"]) {
      expect(driver.calls, target).not.toContain(`locate:${target}`);
    }
    expect(driver.calls).toContain("locate:credentials");
    expect(engine.view().credentialState).toBe("KEY_PRESENT");
  });
});

describe("coupang issuance session — a RELEASED session stops touching the surface (2026-08-19)", () => {
  const LOGIN = { ok: false, pageCategory: "login", blockerCode: "LOGIN_REQUIRED" } as const;
  const ISSUANCE = { ok: true, pageCategory: "open_api_issuance" } as const;

  it("**the surface-wait loop stops on teardown** — a released walk must not probe (and so re-open) the window", async () => {
    // Live-observed on the first on-demand release: the resident helper released the walk and closed the WING
    // window, and one second later the window was BACK. The session's own `awaitSurface` loop was still polling
    // `probeSurface()` once a second — its only exits were "paused" and "terminal", neither of which describes
    // "nobody is hosting this run any more" — and the lazy driver re-opens on any call.
    const { engine, io, driver, session } = build(
      { probeSequence: [LOGIN, LOGIN, LOGIN, LOGIN, LOGIN, LOGIN, ISSUANCE] },
      { surfaceWaitPollMs: 1, surfaceWaitTimeoutMs: 500 },
    );
    startRun(io);
    for (let i = 0; i < 50 && engine.currentStage() !== "waiting_login"; i++) await tick();
    expect(engine.currentStage()).toBe("waiting_login");

    // The host tears the session down (release / shutdown).
    session.attach()();
    expect(session.isStopped()).toBe(true);
    const callsAfterStop = driver.calls.length;
    for (let i = 0; i < 60; i++) await tick();
    // Not one more driver call — no probe, no locate, no highlight, nothing that could bring a window up.
    expect(driver.calls.slice(callsAfterStop)).toEqual([]);
  });

  /**
   * **The runaway blank tab.** The seller closes the WING window; the surface-wait loop polls `probeSurface()`
   * a second later; the LAZY driver's contract is "re-open on the next call"; and because the walk's landing is
   * once-per-carrier, what comes back is a BLANK tab. Then the probe reads `unknown`, the loop waits, and it
   * happens again.
   *
   * Live 2026-08-19, in one seller session: 13 `aw_coupang_walk_surface_closed` events, each followed within a
   * second by `aw_coupang_walk_landing_skipped: ALREADY_NAVIGATED_ONCE`, and 696 of 744 probes reading
   * `unknown`. Closing a tab gave the seller an empty one back, once a second, for as long as the run lived.
   *
   * `maybeRecoverPark` already states this rule and guards on it ("NEVER auto-recover a surface the seller
   * CLOSED"); this loop was the one that did not.
   */
  it("**the surface-wait loop stops when the SELLER closes the window** — no timer re-opens it", async () => {
    const { engine, io, driver, session } = build(
      { probeSequence: [LOGIN, LOGIN, LOGIN, LOGIN, LOGIN, LOGIN, LOGIN, LOGIN, ISSUANCE] },
      { surfaceWaitPollMs: 1, surfaceWaitTimeoutMs: 500 },
    );
    startRun(io);
    for (let i = 0; i < 50 && engine.currentStage() !== "waiting_login"; i++) await tick();
    expect(engine.currentStage()).toBe("waiting_login");

    // The seller closes the WING window themselves. The session latches it and parks.
    driver.closeSurface();
    for (let i = 0; i < 20; i++) await tick();
    const callsAfterClose = driver.calls.length;

    for (let i = 0; i < 80; i++) await tick();
    // Not one further probe. A probe here would go through the lazy driver and bring a window back up — which
    // is precisely what the seller just declined.
    expect(driver.calls.slice(callsAfterClose).filter((c) => c === "probeSurface")).toEqual([]);
    // The session is NOT stopped: the walk is recoverable, it just waits for the seller instead of a timer.
    expect(session.isStopped()).toBe(false);
  });

  it("**a torn-down session drives nothing on a late command either**", async () => {
    const { io, driver, session } = build();
    startRun(io);
    await session.whenSettled();
    session.attach()();
    const callsAfterStop = driver.calls.length;
    // The transport is unsubscribed, so this cannot even reach the engine; the assertion is the driver's silence.
    command(io, "REQUEST_STEP_RECHECK", io.lastView()!.revision, "late");
    for (let i = 0; i < 20; i++) await tick();
    expect(driver.calls.slice(callsAfterStop)).toEqual([]);
  });
});

/**
 * **A parked run is fail-closed AND visible.** These two properties used to be traded against each other: the
 * credential read could not decide, the run parked exactly as designed, and the seller's marketplace window
 * went blank — the explanation was in the SellerOps tab they were not looking at (live 2026-08-20, WING API-key
 * page, `LABEL_NOT_UNIQUE` on 업체코드). The safety is unchanged here; only the silence is.
 */
describe("coupang issuance session — a parked run keeps saying so on the marketplace window", () => {
  it("**UNKNOWN parks AND leaves a notice up** — the walk stops without the guidance disappearing", async () => {
    const { io, engine, driver, session } = build({ credentialState: "UNKNOWN" });
    startRun(io);
    await session.whenSettled();

    expect(engine.currentStage()).toBe("credential_state_unknown");
    expect(io.blockers()).toContainEqual({ code: "CREDENTIAL_STATE_UNKNOWN", recoverable: true });
    expect(driver.calls).toContain("parkNotice:CREDENTIAL_STATE_UNKNOWN");
  });

  it("the notice offers NOTHING to press — no highlight, no locate, no step advance", async () => {
    // The one thing this panel must never become is the parked step's own control: an `UNKNOWN` credential read
    // that put a 발급 button in front of a seller is how a SECOND real key gets created.
    const { io, engine, driver, session } = build({ credentialState: "UNKNOWN" });
    startRun(io);
    await session.whenSettled();

    const after = driver.calls.slice(driver.calls.indexOf("parkNotice:CREDENTIAL_STATE_UNKNOWN"));
    expect(after.filter((c) => c.startsWith("highlight:") || c.startsWith("observe:"))).toEqual([]);
    // Step 1 (reaching the Open API page) legitimately completed BEFORE the credential read; what must not
    // happen is the walk carrying on PAST the park. Nothing advances after the run is blocked.
    // The walk never reaches the step it parked before: no locate, no highlight, no observation of 발급.
    expect(driver.calls.filter((c) => c.endsWith(":issue"))).toEqual([]);
    // And it stays parked. (The recovery loop re-verifies the step it already completed and re-parks on each
    // tick, so the EVENT log churns; what matters — and what is asserted — is that the stage does not move.)
    expect(engine.currentStage()).toBe("credential_state_unknown");
  });

  it("draws once per park, not once per recovery tick — a 1 Hz redraw would flicker on the seller's screen", async () => {
    const { io, driver, session } = build({ credentialState: "UNKNOWN" }, { surfaceWaitPollMs: 5, surfaceWaitTimeoutMs: 60 });
    startRun(io);
    await session.whenSettled();
    await new Promise((r) => setTimeout(r, 80));

    const notices = driver.calls.filter((c) => c === "parkNotice:CREDENTIAL_STATE_UNKNOWN");
    expect(notices.length).toBe(1);
  });

  it("**never draws on a window the seller closed** — drawing is what re-opens it", async () => {
    const { io, driver, session } = build({ action: { issue: false } });
    startRun(io);
    await session.whenSettled();
    const before = driver.calls.length;

    driver.closeSurface();
    await session.whenSettled();

    // The run parks on SURFACE_CLOSED, and NOTHING reaches the driver — a park notice least of all, since the
    // lazy driver opens a window on any call and the landing runs once, so what comes back is a blank tab.
    expect(driver.calls.slice(before)).toEqual([]);
  });
});

/**
 * **The one park that asks a question, and the only answer that moves it.**
 *
 * Without this the WING label census refusing (`LABEL_NOT_UNIQUE` on 업체코드, live 2026-08-20) was a dead end
 * for that seller: every re-check re-read the same ambiguity, forever. The exit is the seller reading their own
 * screen and saying so — on the page where the answer is written, with a button that presses nothing on the
 * marketplace. What must NOT happen is the walk taking that step on its own.
 */
describe("coupang issuance session — UNKNOWN moves only when the SELLER says so", () => {
  it("no press ⇒ the walk stays parked, however long the recovery loop runs", async () => {
    const { io, engine, driver, session } = build(
      { credentialState: "UNKNOWN" },
      { surfaceWaitPollMs: 5, surfaceWaitTimeoutMs: 60 },
    );
    startRun(io);
    await session.whenSettled();
    await new Promise((r) => setTimeout(r, 80));

    // It ASKED — repeatedly — and got no answer, so it did not move.
    expect(driver.calls).toContain("parkConfirm?:CREDENTIAL_STATE_UNKNOWN");
    expect(engine.currentStage()).toBe("credential_state_unknown");
    expect(driver.calls.filter((c) => c.endsWith(":issue"))).toEqual([]);
  });

  it("**the press starts the issuance guidance** — and only the press does", async () => {
    const { io, engine, driver, session } = build(
      { credentialState: "UNKNOWN", parkNoticeConfirmed: true },
      { surfaceWaitPollMs: 5, surfaceWaitTimeoutMs: 60 },
    );
    startRun(io);
    await session.whenSettled();
    await new Promise((r) => setTimeout(r, 40));

    expect(driver.calls).toContain("highlight:issue");
    expect(engine.currentStage()).not.toBe("credential_state_unknown");
  });

  it("the declaration is NOT recorded as a measurement — credentialState stays UNKNOWN on the view", async () => {
    // The seller's statement is theirs; SellerOps still read nothing. Writing NO_KEY here would turn a human
    // claim into a reading the runtime never took, and every downstream reader would repeat it.
    const { io, session } = build(
      { credentialState: "UNKNOWN", parkNoticeConfirmed: true },
      { surfaceWaitPollMs: 5, surfaceWaitTimeoutMs: 60 },
    );
    startRun(io);
    await session.whenSettled();
    await new Promise((r) => setTimeout(r, 40));

    const view = io.views()[io.views().length - 1] as { credentialState?: string };
    expect(view.credentialState).toBe("UNKNOWN");
  });

  it("a press on a CLOSED window is never read — the answer needs a screen to be given on", async () => {
    const { io, driver, session } = build(
      { credentialState: "UNKNOWN", parkNoticeConfirmed: true },
      { surfaceWaitPollMs: 5, surfaceWaitTimeoutMs: 60 },
    );
    startRun(io);
    await session.whenSettled();
    driver.closeSurface();
    const before = driver.calls.length;
    await new Promise((r) => setTimeout(r, 40));

    expect(driver.calls.slice(before)).toEqual([]);
  });
});

/**
 * **The credential handoff, as the seller reaches it.**
 *
 * The press in SellerOps IS the barrier — it discloses read → send → verify, exactly as the operator harness's
 * action barrier does — and it arrives as a checkpoint advance carrying a one-shot capability. What these pin is
 * the order: nothing is read until the run is demonstrably at the credential step, the read happens once, and
 * the walk completes only if the credential actually reached the vault.
 */
describe("coupang issuance session — the credential handoff runs only where and when it may", () => {
  const CAP = "a".repeat(32);

  /** The revision the session is currently at — a command against an older one is rejected by the engine. */
  function latestRevision(io: ReturnType<typeof loopback>): number {
    const views = io.sent.filter((f) => f.kind === "aw_view") as unknown as { view: { revision: number } }[];
    return views[views.length - 1]!.view.revision;
  }

  function handoffHarness(
    result: { stored: boolean; connectionStatus?: string; reason?: string },
    script: CoupangIssuanceFixtureScript = { credentialState: "KEY_PRESENT" },
  ) {
    const seen: string[] = [];
    const built = build(
      script,
      {
        credentialHandoff: async (capability: string) => {
          seen.push(capability);
          return result;
        },
      },
    );
    return { ...built, seen };
  }

  function sendHandoff(io: ReturnType<typeof loopback>, revision: number) {
    io.send({
      kind: "aw_command",
      command: {
        protocolVersion: 2,
        commandId: `cmd_handoff_${revision}`,
        runId: RUN_ID,
        expectedRevision: revision,
        type: "REQUEST_STEP_RECHECK",
        payload: { credentialHandoffAuthorization: CAP } as never,
      },
    });
  }

  /** The last command ack the session sent — a handoff answers on the command, not on the view. */
  function lastResult(io: ReturnType<typeof loopback>): { accepted: boolean; reason?: string } {
    const results = io.sent.filter((f) => f.kind === "aw_command_result");
    return results[results.length - 1] as unknown as { accepted: boolean; reason?: string };
  }

  it("**refuses before reading anything** when the run is not at the consent stage", async () => {
    // A run resting mid-walk in WING. The seller has not been asked anything, so there is nothing to consent
    // to — and a capability arriving here must read no screen at all.
    const { io, session, seen } = handoffHarness({ stored: true }, { action: { issue: false } });
    startRun(io);
    await session.whenSettled();

    sendHandoff(io, latestRevision(io));
    await session.whenSettled();

    // The seam was never called: no screen was read, and nothing left the machine.
    expect(seen).toEqual([]);
    expect(lastResult(io)).toMatchObject({ accepted: false, reason: "HANDOFF_NOT_AT_CREDENTIAL_STEP" });
  });

  it("refuses on a host that cannot perform one at all — a scripted driver never reads a credential", async () => {
    const { io, session } = build({ credentialState: "KEY_PRESENT" }, { credentialHandoff: null });
    startRun(io);
    await session.whenSettled();

    sendHandoff(io, latestRevision(io));
    await session.whenSettled();

    expect(lastResult(io)).toMatchObject({ accepted: false, reason: "HANDOFF_NOT_SUPPORTED_HERE" });
  });
});

/* ────────────────── the consent lives on the marketplace window, and so does its outcome ────────────────── */

describe("the credential consent, and what the seller sees on WING after it", () => {
  /** Walk to the credential step and stop there — the panel asking, nobody having answered. */
  async function walkToConsent(opts?: { stepDeclined?: boolean }) {
    const built = build({
      ...(opts?.stepDeclined ? { action: { credentials: false }, stepDeclined: { credentials: true } } : {}),
    });
    startRun(built.io);
    await built.session.whenSettled();
    return built;
  }

  it("**the run publishes WHICH question is on the WING window** — asking, then answered", async () => {
    // The frontend acts on this and on nothing else. It is the tab holding the seller's session, so it is the
    // only place a one-shot capability can be minted — and it must mint one when the seller presses the panel's
    // button, not before. A step number could not tell it that: 8/8 reads the same on both sides of the press.
    const { io, engine, driver, session } = build({ action: { credentials: false } });
    startRun(io);
    await session.whenSettled();
    expect(engine.currentStage()).toBe("guiding_copy_keys");
    expect(io.lastView()!.credentialHandoff).toBe("AWAITING_CONSENT");

    // The seller presses `SellerOps에 연결하기` on the WING panel.
    driver.setAction("credentials", true);
    await session.whenSettled();

    expect(engine.currentStage()).toBe("awaiting_handoff_consent");
    expect(io.lastView()!.credentialHandoff).toBe("CONSENTED");
    // Nothing has been read, nothing stored, and the run has NOT finished — it is waiting on SellerOps.
    expect(driver.calls).not.toContain("cleanup");
  });

  it("consent → the panel says it is working, then that it is done, and only THEN does the run complete", async () => {
    const { io, engine, driver, session } = await walkToConsent();
    expect(engine.currentStage()).toBe("awaiting_handoff_consent");
    expect(io.lastView()!.credentialHandoff).toBe("CONSENTED");

    await consentToHandoff(io, session);

    expect(engine.currentStage()).toBe("guidance_complete");
    // ORDER matters: the success panel is mounted on the far side of the cleanup the completion drives, or the
    // seller would watch it be removed a moment after it appeared.
    const panels = driver.calls.filter((c) => c.startsWith("handoffPanel:") || c === "cleanup");
    expect(panels).toEqual(["handoffPanel:WORKING", "cleanup", "handoffPanel:STORED"]);
    // …and the completed view no longer carries a pending question.
    expect(io.lastView()!.credentialHandoff).toBeUndefined();
  });

  it("**the return happens on the seller's press, and the run is SETTLED while it waits for it**", async () => {
    // The success panel's button is the walk's only return to SellerOps, and the wait for it must not read as
    // the run still working: a walk that has stored the credential is finished, and the seller may sit on their
    // keys as long as they like.
    const { io, driver, session } = build();
    driver.setHandoffPanelPressed("STORED", true);
    startRun(io);
    await session.whenSettled();
    await consentToHandoff(io, session);

    await session.whenHandoffReturnSettled();

    expect(driver.calls).toContain("returnToSellerOps");
  });

  it("**a failed handoff paints the failure and completes nothing** — the vault is empty and the run says so", async () => {
    const { io, engine, driver, session } = build({}, { credentialHandoff: async () => ({ stored: false, reason: "READ_FAILED" }) });
    startRun(io);
    await session.whenSettled();
    await consentToHandoff(io, session);

    expect(engine.currentStage()).toBe("awaiting_handoff_consent");
    expect(driver.calls.filter((c) => c.startsWith("handoffPanel:"))).toEqual(["handoffPanel:WORKING", "handoffPanel:FAILED"]);
    expect(driver.calls).not.toContain("cleanup");
  });

  it("**the seller's 직접 입력할게요 leaves the walk for the typing form** — a choice, never a fall-through", async () => {
    // "No automatic fall-through" must not become "no way out". This is the seller asking, and it means exactly
    // what SWITCH_TO_MANUAL from the SellerOps tab has always meant.
    const { io, engine, session } = await walkToConsent({ stepDeclined: true });
    await session.whenSettled();

    expect(engine.currentStage()).toBe("operator_aborted");
    expect(io.lastView()!.status).toBe("CANCELLED");
  });
});
