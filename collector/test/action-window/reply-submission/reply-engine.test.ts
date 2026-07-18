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
  type SurfaceProbeResult,
} from "../../../src/action-window/reply-submission/reply-engine";

function newEngine() {
  return new ReplyEngine(
    { runId: "run_reply_0001", channelCode: "naver", submissionRef: "a1b2c3d4e5f60718" },
    { clock: makeReplyClock() },
  );
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
