/**
 * Hermetic unit tests for the ISOLATED reply-submission engine (v2). No browser, no network. Every
 * emitted event and every view is validated against the normative v2 contract, and the honesty
 * invariants are pinned: observation ≠ completion, the terminal is OPERATOR_REPORTED (never
 * COMPLETED), outcome and verification are separate, and the runtime never submits.
 */
import { describe, it, expect } from "vitest";
import {
  validateEventEnvelope,
  validateRunView,
  findProhibitedFields,
} from "../../../../contracts/action-window/v2/index";
import {
  ReplyEngine,
  makeReplyClock,
  type LocateComposerResult,
  type LocateRowResult,
  type SurfaceProbeResult,
} from "../../../src/action-window/reply-submission/reply-engine";
import { REPLY_FIXTURE_CANARIES, REPLY_FIXTURE_HINT } from "../../../src/action-window/reply-submission/reply-fixture";
import type { ReplyRunMode } from "../../../src/action-window/reply-submission/reply-stages";

function newEngine() {
  return new ReplyEngine(
    { runId: "run_reply_0001", channelCode: "naver", submissionRef: "a1b2c3d4e5f60718" },
    { clock: makeReplyClock() },
  );
}

const ROW_SIG = "aaaabbbbccccdddd";
const COMPOSER_SIG = "1111222233334444";

function newGuidedEngine(mode: ReplyRunMode = "FULL_SUBMIT") {
  return new ReplyEngine(
    { runId: "run_reply_guided", channelCode: "naver", submissionRef: "a1b2c3d4e5f60718", targetHint: REPLY_FIXTURE_HINT, mode },
    { clock: makeReplyClock() },
  );
}

/** Drive the guided chain to the composer submit barrier via the row barrier + operator open. */
function toGuidedSubmitBarrier(engine: ReplyEngine, row: LocateRowResult = { count: 1, sig: ROW_SIG }) {
  engine.command({ type: "START_RUN", expectedRevision: 0 }); // → PREPARE
  engine.onSurfaceReady(true); // → LOCATE_ROW (hint present)
  engine.onRowLocated(row); // → HIGHLIGHT_ROW
  engine.onRowHighlighted(row); // → WAIT_FOR_ROW_OPEN (row barrier)
  engine.onRowOpened(); // → LOCATE_COMPOSER
  engine.onLocated({ count: 1, sig: COMPOSER_SIG }); // → HIGHLIGHT_COMPOSER
  engine.onHighlighted(); // → WAIT_FOR_SUBMIT (composer barrier)
}

/** Drive the automatic prep chain to the human barrier (no session; call the callbacks directly). */
function toBarrier(engine: ReplyEngine, surface: SurfaceProbeResult = true, locate: LocateComposerResult = { count: 1, sig: "beefbeefbeefbeef" }) {
  engine.command({ type: "START_RUN", expectedRevision: 0 }); // → PREPARE
  engine.onSurfaceReady(surface); // → LOCATE
  engine.onLocated(locate); // → HIGHLIGHT
  engine.onHighlighted(); // → OBSERVE (barrier)
}

function assertAllValid(engine: ReplyEngine) {
  for (const e of engine.events()) {
    expect(validateEventEnvelope(e), `event ${e.type}`).toEqual({ ok: true });
  }
  expect(validateRunView(engine.view())).toEqual({ ok: true });
  expect(findProhibitedFields({ events: engine.events(), view: engine.view() })).toEqual([]);
}

describe("reply engine — reaching the human barrier", () => {
  it("drives prepare → locate → highlight to WAITING_FOR_HUMAN with a REPLY_SUBMISSION view", () => {
    const engine = newEngine();
    toBarrier(engine);
    const view = engine.view();
    expect(view.status).toBe("WAITING_FOR_HUMAN");
    expect(view.intent).toBe("REPLY_SUBMISSION");
    expect(view.progress.totalSteps).toBe(2);
    expect(view.currentStep?.status).toBe("AWAITING_USER");
    assertAllValid(engine);
  });

  it("emits no download/verify events — there is no downstream chain", () => {
    const engine = newEngine();
    toBarrier(engine);
    const types = engine.events().map((e) => e.type);
    expect(types).not.toContain("DOWNLOAD_DETECTED");
    expect(types).not.toContain("STEP_COMPLETED");
  });
});

describe("reply engine — observation is not completion", () => {
  it("USER_ACTION_OBSERVED does not terminate the run", () => {
    const engine = newEngine();
    toBarrier(engine);
    engine.onUserActionObserved();
    expect(engine.currentStage()).toBe("WAIT_FOR_SUBMIT");
    expect(engine.view().status).toBe("WAITING_FOR_HUMAN"); // still awaiting the operator's REPORT
    expect(engine.events().map((e) => e.type)).toContain("USER_ACTION_OBSERVED");
    assertAllValid(engine);
  });
});

describe("reply engine — the operator report terminates at OPERATOR_REPORTED (never COMPLETED)", () => {
  it("REQUEST_STEP_RECHECK reports SUBMITTED and terminates operator-reported + unverified", () => {
    const engine = newEngine();
    toBarrier(engine);
    engine.onUserActionObserved();
    const out = engine.command({ type: "REQUEST_STEP_RECHECK", expectedRevision: engine.view().revision });
    expect(out.ok).toBe(true);

    const view = engine.view();
    expect(view.status).toBe("OPERATOR_REPORTED");
    expect(view.status).not.toBe("COMPLETED");
    expect(view.currentStep?.status).toBe("OPERATOR_REPORTED");
    expect(view.progress.completedSteps).toBe(2);

    const reported = engine.events().find((e) => e.type === "SUBMISSION_REPORTED");
    expect(reported?.payload.operatorOutcome).toBe("OPERATOR_REPORTED_SUBMITTED");
    expect(reported?.payload.verification).toBe("UNVERIFIED");
    const terminal = engine.events().find((e) => e.type === "RUN_OPERATOR_REPORTED");
    expect(terminal?.payload.status).toBe("OPERATOR_REPORTED");

    // No event ever claims completion.
    expect(engine.events().map((e) => e.type)).not.toContain("RUN_COMPLETED");
    assertAllValid(engine);
  });

  it("SWITCH_TO_MANUAL reports an ABORT as an outcome, not a fault", () => {
    const engine = newEngine();
    toBarrier(engine);
    engine.command({ type: "SWITCH_TO_MANUAL", expectedRevision: engine.view().revision });
    const reported = engine.events().find((e) => e.type === "SUBMISSION_REPORTED");
    expect(reported?.payload.operatorOutcome).toBe("SUBMISSION_ABORTED");
    expect(reported?.payload.verification).toBe("UNVERIFIED");
    expect(engine.view().status).toBe("OPERATOR_REPORTED");
    // An abort is NOT a blocker/failure.
    expect(engine.view().status).not.toBe("FAILED");
    expect(engine.events().map((e) => e.type)).not.toContain("RUN_FAILED");
    assertAllValid(engine);
  });
});

describe("reply engine — fail closed", () => {
  it("no composer → TARGET_NOT_FOUND", () => {
    const engine = newEngine();
    engine.command({ type: "START_RUN", expectedRevision: 0 });
    engine.onSurfaceReady(true);
    engine.onLocated({ count: 0 });
    expect(engine.view().status).toBe("FAILED");
    expect(engine.view().blocker?.code).toBe("TARGET_NOT_FOUND");
    assertAllValid(engine);
  });

  it("ambiguous composer → TARGET_AMBIGUOUS, zero highlight", () => {
    const engine = newEngine();
    engine.command({ type: "START_RUN", expectedRevision: 0 });
    engine.onSurfaceReady(true);
    engine.onLocated({ count: 2, sig: "beefbeefbeefbeef" });
    expect(engine.view().blocker?.code).toBe("TARGET_AMBIGUOUS");
    expect(engine.events().map((e) => e.type)).not.toContain("TARGET_HIGHLIGHTED");
  });

  it("a login-required surface blocks recoverably", () => {
    const engine = newEngine();
    engine.command({ type: "START_RUN", expectedRevision: 0 });
    engine.onSurfaceReady({ ok: false, code: "LOGIN_REQUIRED" });
    expect(engine.view().status).toBe("FAILED");
    expect(engine.view().blocker).toEqual({ code: "LOGIN_REQUIRED", recoverable: true });
    assertAllValid(engine);
  });
});

describe("reply engine — pause/resume never auto-submits", () => {
  it("resume re-enters the human barrier rather than re-driving a submit", () => {
    const engine = newEngine();
    toBarrier(engine);
    engine.command({ type: "PAUSE_RUN", expectedRevision: engine.view().revision });
    expect(engine.view().status).toBe("PAUSED");
    engine.command({ type: "RESUME_RUN", expectedRevision: engine.view().revision });
    expect(engine.currentStage()).toBe("WAIT_FOR_SUBMIT"); // back at the barrier, nothing submitted
    expect(engine.reportedOutcome()).toBeNull();
    assertAllValid(engine);
  });
});

describe("reply engine — command guards", () => {
  it("rejects commands before START_RUN and stale revisions", () => {
    const engine = newEngine();
    expect(engine.command({ type: "REQUEST_STEP_RECHECK", expectedRevision: 0 }).ok).toBe(false);
    toBarrier(engine);
    const stale = engine.command({ type: "REQUEST_STEP_RECHECK", expectedRevision: 0 });
    expect(stale.ok).toBe(false);
  });
});

/* ─────────────────────────── Guided review-row locator ─────────────────────────── */

describe("reply engine — guided review-row locator (3-step plan)", () => {
  it("a target hint routes surface → LOCATE_ROW and drives the 3-step guided plan to OPERATOR_REPORTED", () => {
    const engine = newGuidedEngine();
    expect(engine.command({ type: "START_RUN", expectedRevision: 0 })).toMatchObject({ ok: true });
    expect(engine.onSurfaceReady(true)).toBe("LOCATE_ROW"); // guided branch, not "LOCATE"
    expect(engine.onRowLocated({ count: 1, sig: ROW_SIG })).toBe("HIGHLIGHT_ROW");
    expect(engine.onRowHighlighted({ count: 1, sig: ROW_SIG })).toBe("OBSERVE_ROW");

    // At the row-open barrier: step 2 of 3, awaiting the operator's own click; the row is highlighted.
    let view = engine.view();
    expect(view.status).toBe("WAITING_FOR_HUMAN");
    expect(view.progress.totalSteps).toBe(3);
    expect(view.currentStep?.stepNumber).toBe(2);
    expect(view.currentStep?.status).toBe("AWAITING_USER");
    expect(view.currentStep?.copyParams).toMatchObject({ targetKind: "review_row" });
    const rowHi = engine.events().find((e) => e.type === "TARGET_HIGHLIGHTED");
    expect(rowHi?.payload.targetRef).toMatch(/^[0-9a-f]{16}$/);
    assertAllValid(engine);

    // The operator opens the row (observed), rejoining the composer chain → composer submit barrier (step 3).
    expect(engine.onRowOpened()).toBe("LOCATE");
    engine.onLocated({ count: 1, sig: COMPOSER_SIG });
    engine.onHighlighted();
    view = engine.view();
    expect(view.currentStep?.stepNumber).toBe(3);
    expect(view.progress.completedSteps).toBe(2);

    engine.command({ type: "REQUEST_STEP_RECHECK", expectedRevision: engine.view().revision });
    expect(engine.view().status).toBe("OPERATOR_REPORTED");
    expect(engine.view().progress.completedSteps).toBe(3);
    assertAllValid(engine);
  });

  it("no row match → TARGET_NOT_FOUND; ambiguous rows → TARGET_AMBIGUOUS (never highlighted)", () => {
    const miss = newGuidedEngine();
    miss.command({ type: "START_RUN", expectedRevision: 0 });
    miss.onSurfaceReady(true);
    miss.onRowLocated({ count: 0 });
    expect(miss.view().blocker?.code).toBe("TARGET_NOT_FOUND");

    const amb = newGuidedEngine();
    amb.command({ type: "START_RUN", expectedRevision: 0 });
    amb.onSurfaceReady(true);
    amb.onRowLocated({ count: 2, sig: ROW_SIG });
    expect(amb.view().blocker?.code).toBe("TARGET_AMBIGUOUS");
    expect(amb.events().map((e) => e.type)).not.toContain("TARGET_HIGHLIGHTED");
  });

  it("row DRIFT between locate and highlight fails closed — the re-validated match must be the SAME sig", () => {
    const engine = newGuidedEngine();
    engine.command({ type: "START_RUN", expectedRevision: 0 });
    engine.onSurfaceReady(true);
    engine.onRowLocated({ count: 1, sig: ROW_SIG }); // located THIS row…
    engine.onRowHighlighted({ count: 1, sig: "0000ffff0000ffff" }); // …but re-validation sees a different one
    expect(engine.view().status).toBe("FAILED");
    expect(engine.view().blocker?.code).toBe("TARGET_NOT_FOUND");
    expect(engine.events().map((e) => e.type)).not.toContain("TARGET_HIGHLIGHTED");
  });

  it("no hint → the legacy 2-step composer path is unchanged (backward compatible)", () => {
    const engine = newEngine(); // no targetHint
    expect(engine.command({ type: "START_RUN", expectedRevision: 0 })).toMatchObject({ ok: true });
    expect(engine.onSurfaceReady(true)).toBe("LOCATE"); // straight to the composer, not LOCATE_ROW
    expect(engine.view().progress.totalSteps).toBe(2);
  });

  it("the guided run's wire carries no fixture canary and never the bodyFingerprint match key", () => {
    const engine = newGuidedEngine();
    toGuidedSubmitBarrier(engine);
    engine.onUserActionObserved();
    engine.command({ type: "REQUEST_STEP_RECHECK", expectedRevision: engine.view().revision });
    const wire = JSON.stringify({ events: engine.events(), view: engine.view() });
    for (const canary of REPLY_FIXTURE_CANARIES) expect(wire, `leaked ${canary}`).not.toContain(canary);
    expect(wire).not.toContain(REPLY_FIXTURE_HINT.bodyFingerprint);
    assertAllValid(engine);
  });
});

describe("reply engine — ABORT_REHEARSAL mode", () => {
  it("requires a target hint (guided-only) — constructing without one fails closed", () => {
    expect(() => new ReplyEngine({ runId: "run_x", channelCode: "naver", mode: "ABORT_REHEARSAL" })).toThrow();
  });

  it("REQUEST_STEP_RECHECK is unreachable — the submitted terminal is structurally impossible", () => {
    const engine = newGuidedEngine("ABORT_REHEARSAL");
    toGuidedSubmitBarrier(engine);
    expect(engine.view().allowedCommands).not.toContain("REQUEST_STEP_RECHECK");
    expect(engine.view().allowedCommands).toContain("SWITCH_TO_MANUAL");
    const rejected = engine.command({ type: "REQUEST_STEP_RECHECK", expectedRevision: engine.view().revision });
    expect(rejected).toEqual({ ok: false, reason: "INVALID_FOR_STATE" });
    expect(engine.view().status).toBe("WAITING_FOR_HUMAN"); // still open — nothing reported

    engine.command({ type: "SWITCH_TO_MANUAL", expectedRevision: engine.view().revision });
    expect(engine.reportedOutcome()).toBe("SUBMISSION_ABORTED");
    expect(engine.view().status).toBe("OPERATOR_REPORTED");
  });
});

describe("reply engine — abort acceptable from every non-terminal stage, never racing into FAILED", () => {
  const drivers: Record<string, (e: ReplyEngine) => void> = {
    PREPARE_SESSION: (e) => e.command({ type: "START_RUN", expectedRevision: 0 }),
    LOCATE_ROW: (e) => { e.command({ type: "START_RUN", expectedRevision: 0 }); e.onSurfaceReady(true); },
    WAIT_FOR_ROW_OPEN: (e) => { e.command({ type: "START_RUN", expectedRevision: 0 }); e.onSurfaceReady(true); e.onRowLocated({ count: 1, sig: ROW_SIG }); e.onRowHighlighted({ count: 1, sig: ROW_SIG }); },
    WAIT_FOR_SUBMIT: (e) => toGuidedSubmitBarrier(e),
  };
  for (const [stage, drive] of Object.entries(drivers)) {
    it(`SWITCH_TO_MANUAL at ${stage} → SUBMISSION_ABORTED (OPERATOR_REPORTED)`, () => {
      const engine = newGuidedEngine();
      drive(engine);
      const out = engine.command({ type: "SWITCH_TO_MANUAL", expectedRevision: engine.view().revision });
      expect(out.ok).toBe(true);
      expect(engine.reportedOutcome()).toBe("SUBMISSION_ABORTED");
      expect(engine.view().status).toBe("OPERATOR_REPORTED");
    });
  }

  it("PAUSED also accepts abort", () => {
    const engine = newGuidedEngine();
    engine.command({ type: "START_RUN", expectedRevision: 0 });
    engine.command({ type: "PAUSE_RUN", expectedRevision: engine.view().revision });
    expect(engine.view().status).toBe("PAUSED");
    engine.command({ type: "SWITCH_TO_MANUAL", expectedRevision: engine.view().revision });
    expect(engine.view().status).toBe("OPERATOR_REPORTED");
    expect(engine.reportedOutcome()).toBe("SUBMISSION_ABORTED");
  });

  it("anti-race: once aborted, a resolving driver callback no-ops and cannot flip to FAILED", () => {
    const engine = newGuidedEngine();
    engine.command({ type: "START_RUN", expectedRevision: 0 });
    engine.onSurfaceReady(true); // at LOCATE_ROW
    engine.command({ type: "SWITCH_TO_MANUAL", expectedRevision: engine.view().revision }); // abort wins
    expect(engine.view().status).toBe("OPERATOR_REPORTED");
    // A row-locate that was "in flight" resolves AFTER the abort — it must not overwrite the terminal.
    expect(engine.onRowLocated({ count: 2, sig: ROW_SIG })).toBe("NONE");
    expect(engine.view().status).toBe("OPERATOR_REPORTED");
    expect(engine.view().status).not.toBe("FAILED");
  });
});
