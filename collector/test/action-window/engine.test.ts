/**
 * Pure unit tests for the Action Window Runtime engine (R1). No browser. Drives the engine with
 * fake probe results and asserts the state table, command semantics, contract event/view validity,
 * sanitization, and the structural "Runtime never clicks" invariant (source scan).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

import {
  ACTION_WINDOW_PROTOCOL_VERSION,
  EXECUTION_MODES,
  validateCommandEnvelope,
  validateEventEnvelope,
  validateRunView,
  findProhibitedFields,
  type CommandEnvelope,
  type CommandType,
} from "../../../contracts/action-window/v1/index";
import { ActionWindowEngine } from "../../src/action-window/engine";

const SIG = "a1b2c3d4e5f60718";
const ARTIFACT = "0f1e2d3c4b5a6978";
const fixedClock = () => "2026-01-01T00:00:00.5Z";

function newEngine() {
  return new ActionWindowEngine(
    { runId: "run_t1", channelCode: "synthetic", runCopyKey: "actionWindow.run.synthetic" },
    { clock: fixedClock },
  );
}
let cmdN = 0;
function cmd(engine: ActionWindowEngine, type: CommandType, payload?: Record<string, unknown>, expectedRevision?: number): CommandEnvelope {
  return {
    protocolVersion: ACTION_WINDOW_PROTOCOL_VERSION,
    commandId: `run_t1-c${++cmdN}`,
    runId: "run_t1",
    expectedRevision: expectedRevision ?? engine.currentRevision(),
    type,
    ...(payload ? { payload: payload as CommandEnvelope["payload"] } : {}),
  };
}
/** Drive the engine to the verified human step via fake probe results (downstream not yet run). */
function driveToVerified(engine: ActionWindowEngine) {
  engine.command(cmd(engine, "START_RUN"));
  engine.onSurfaceReady(true);
  engine.onLocated({ count: 1, sig: SIG });
  engine.onHighlighted();
  engine.onUserActionObserved();
  engine.command(cmd(engine, "REQUEST_STEP_RECHECK"));
  engine.onVerified({ verified: true, drift: false });
}
/** Drive the engine to a verified COMPLETE via fake probe results (incl. the downstream chain). */
function driveHappyPath(engine: ActionWindowEngine) {
  driveToVerified(engine);
  engine.onDownloadDetected({ detected: true, artifactRef: ARTIFACT });
  engine.onArtifactValidated({ valid: true });
  return engine.onIngested({ ok: true, processed: 1 });
}
/** Drive the engine to the ingest handoff — validated, decision pending. */
function driveToIngestHandoff(engine: ActionWindowEngine) {
  driveToVerified(engine);
  engine.onDownloadDetected({ detected: true, artifactRef: ARTIFACT });
  engine.onArtifactValidated({ valid: true });
}

/**
 * `declineIngest` (D-027) — the executor's `--no-ingest` policy, recorded by the engine. The engine
 * never decides to decline; it only records that the decision was made above it.
 */
describe("engine — declined ingest handoff", () => {
  it("at INGEST_HANDOFF → CANCELLED with effect CLEANUP", () => {
    const engine = newEngine();
    driveToIngestHandoff(engine);
    expect(engine.currentStage()).toBe("INGEST_HANDOFF");

    const effect = engine.declineIngest();

    expect(effect).toBe("CLEANUP");
    expect(engine.currentStage()).toBe("CANCELLED");
    expect(engine.view().status).toBe("CANCELLED");
  });

  it("sets NO blocker — nothing failed, so nothing may claim to have", () => {
    // Every reserved blocker code would be a lie here. This is the invariant that stops a future
    // reader from "improving" the diagnostic by inventing one.
    const engine = newEngine();
    driveToIngestHandoff(engine);
    engine.declineIngest();

    expect(engine.view().blocker).toBeUndefined();
    expect(engine.events().map((e) => e.type)).not.toContain("RUN_BLOCKED");
    expect(engine.events().map((e) => e.type)).not.toContain("RUN_FAILED");
  });

  it("never yields COMPLETED — a declined run cannot report the ingest it declined", () => {
    const engine = newEngine();
    driveToIngestHandoff(engine);
    engine.declineIngest();

    expect(engine.view().status).not.toBe("COMPLETED");
    expect(engine.events().map((e) => e.type)).not.toContain("RUN_COMPLETED");
    // Step 3 is SKIPPED, not completed: the downstream chain genuinely did not finish.
    expect(engine.view().progress).toEqual({ completedSteps: 2, totalSteps: 3 });
    expect(engine.view().currentStep?.status).toBe("SKIPPED");
  });

  it("is a terminal stop: no command is accepted afterwards", () => {
    const engine = newEngine();
    driveToIngestHandoff(engine);
    engine.declineIngest();

    expect(engine.view().allowedCommands).toEqual([]);
  });

  it("is invalid outside INGEST_HANDOFF — it records a decision, it does not make one", () => {
    const atBarrier = newEngine();
    driveToVerified(atBarrier);
    expect(() => atBarrier.declineIngest()).toThrow(/expected stage INGEST_HANDOFF/);

    const completed = newEngine();
    driveHappyPath(completed);
    expect(() => completed.declineIngest()).toThrow(/expected stage INGEST_HANDOFF/);
  });
});

describe("engine — happy path", () => {
  it("completes the loop and emits a valid, ordered, sanitized event sequence", () => {
    const engine = newEngine();
    const effect = driveHappyPath(engine);
    expect(engine.currentStage()).toBe("COMPLETE");
    expect(effect).toBe("CLEANUP");

    const view = engine.view();
    expect(view.status).toBe("COMPLETED");
    expect(view.progress).toEqual({ completedSteps: 3, totalSteps: 3 });
    expect(view.blocker).toBeUndefined();
    expect(validateRunView(view)).toEqual({ ok: true });

    const events = engine.events();
    const types = events.map((e) => e.type);
    expect(types).toEqual([
      "RUN_STARTED", "RUN_STATUS_CHANGED", "RUN_STATUS_CHANGED", "STEP_READY",
      "HUMAN_ACTION_REQUIRED", "TARGET_HIGHLIGHTED", "RUN_STATUS_CHANGED",
      "USER_ACTION_OBSERVED", "RUN_STATUS_CHANGED", "STEP_COMPLETED",
      "RUN_STATUS_CHANGED", "DOWNLOAD_DETECTED", "STEP_COMPLETED", "RUN_COMPLETED",
    ]);
    // monotonic sequence 1..n, non-decreasing revision, unique eventIds
    expect(events.map((e) => e.sequence)).toEqual(events.map((_, i) => i + 1));
    for (let i = 1; i < events.length; i++) expect(events[i]!.revision).toBeGreaterThanOrEqual(events[i - 1]!.revision);
    expect(new Set(events.map((e) => e.eventId)).size).toBe(events.length);
    // every event valid + sanitized
    for (const e of events) {
      expect(validateEventEnvelope(e), e.type).toEqual({ ok: true });
      expect(findProhibitedFields(e), e.type).toEqual([]);
    }
    // the highlighted target ref is an opaque 16-hex, never a selector
    const hi = events.find((e) => e.type === "TARGET_HIGHLIGHTED")!;
    expect(hi.payload.targetRef).toMatch(/^[0-9a-f]{16}$/);
    // the detected artifact ref is an opaque 16-hex, never a filename/path
    const dl = events.find((e) => e.type === "DOWNLOAD_DETECTED")!;
    expect(dl.payload.artifactRef).toMatch(/^[0-9a-f]{16}$/);
  });

  it("the waiting view satisfies the human-action contract invariant", () => {
    const engine = newEngine();
    engine.command(cmd(engine, "START_RUN"));
    engine.onSurfaceReady(true);
    engine.onLocated({ count: 1, sig: SIG });
    engine.onHighlighted();
    const view = engine.view();
    expect(view.status).toBe("WAITING_FOR_HUMAN");
    expect(view.executionMode).toBe("ACTION_WINDOW");
    expect(view.currentStep?.status).toBe("AWAITING_USER");
    expect(view.currentStep?.stepNumber).toBe(2);
    expect(view.currentStep?.totalSteps).toBe(view.progress.totalSteps);
    expect(validateRunView(view)).toEqual({ ok: true });
  });
});

describe("engine — fail-closed cases", () => {
  const failAt = (setup: (e: ActionWindowEngine) => void, code: string) => {
    const engine = newEngine();
    setup(engine);
    expect(engine.currentStage()).toBe("FAILED");
    expect(engine.view().status).toBe("FAILED");
    expect(engine.view().blocker).toEqual({ code, recoverable: false });
    const blocked = engine.events().find((e) => e.type === "RUN_BLOCKED")!;
    const failed = engine.events().find((e) => e.type === "RUN_FAILED")!;
    expect(blocked.payload.code).toBe(code);
    expect(failed.payload.code).toBe(code);
    for (const e of engine.events()) expect(validateEventEnvelope(e)).toEqual({ ok: true });
  };

  it("invalid surface → UNSUPPORTED_STATE", () => failAt((e) => { e.command(cmd(e, "START_RUN")); e.onSurfaceReady(false); }, "UNSUPPORTED_STATE"));
  // R4: a driver may report the SEMANTIC cause of a failed surface probe (reserved codes only).
  it("surface probe result without a code → UNSUPPORTED_STATE", () =>
    failAt((e) => { e.command(cmd(e, "START_RUN")); e.onSurfaceReady({ ok: false }); }, "UNSUPPORTED_STATE"));
  // NOTE: SESSION_EXPIRED / LOGIN_REQUIRED deliberately no longer fail closed — they PARK and stay
  // recoverable. Their cases moved to `engine — recovery park (LOGIN_REQUIRED / SESSION_EXPIRED)` below.
  // UNSUPPORTED_STATE remains the only surface-probe cause that is terminal.
  it("a rich OK surface probe proceeds exactly like the boolean form", () => {
    const engine = newEngine();
    engine.command(cmd(engine, "START_RUN"));
    expect(engine.onSurfaceReady({ ok: true })).toBe("LOCATE");
    expect(engine.currentStage()).toBe("LOCATE_TARGET");
  });
  it("zero candidates → TARGET_NOT_FOUND", () => failAt((e) => { e.command(cmd(e, "START_RUN")); e.onSurfaceReady(true); e.onLocated({ count: 0 }); }, "TARGET_NOT_FOUND"));
  it("multiple candidates → TARGET_AMBIGUOUS", () => failAt((e) => { e.command(cmd(e, "START_RUN")); e.onSurfaceReady(true); e.onLocated({ count: 3 }); }, "TARGET_AMBIGUOUS"));
  it("signature changed after highlight → UI_DRIFT", () =>
    failAt((e) => {
      e.command(cmd(e, "START_RUN")); e.onSurfaceReady(true); e.onLocated({ count: 1, sig: SIG }); e.onHighlighted();
      e.onUserActionObserved(); e.command(cmd(e, "REQUEST_STEP_RECHECK")); e.onVerified({ verified: false, drift: true });
    }, "UI_DRIFT"));

  it("no download detected → DOWNLOAD_TIMEOUT", () =>
    failAt((e) => { driveToVerified(e); e.onDownloadDetected({ detected: false }); }, "DOWNLOAD_TIMEOUT"));
  it("detected download with a non-opaque artifact ref → DOWNLOAD_TIMEOUT (never emitted)", () => {
    failAt((e) => { driveToVerified(e); e.onDownloadDetected({ detected: true, artifactRef: "report.xlsx" }); }, "DOWNLOAD_TIMEOUT");
    const engine = newEngine();
    driveToVerified(engine);
    engine.onDownloadDetected({ detected: true, artifactRef: "report.xlsx" });
    // The malformed ref never reaches the event log — nothing non-opaque can be emitted.
    expect(engine.events().some((e) => e.type === "DOWNLOAD_DETECTED")).toBe(false);
    expect(JSON.stringify(engine.events())).not.toContain("report.xlsx");
  });
  it("invalid artifact → ARTIFACT_INVALID (never ingested)", () =>
    failAt((e) => {
      driveToVerified(e);
      e.onDownloadDetected({ detected: true, artifactRef: ARTIFACT });
      e.onArtifactValidated({ valid: false });
    }, "ARTIFACT_INVALID"));
  it("failed ingestion handoff → fails closed (no reserved ingest blocker; generic UNSUPPORTED_STATE)", () => {
    const engine = newEngine();
    driveToVerified(engine);
    engine.onDownloadDetected({ detected: true, artifactRef: ARTIFACT });
    engine.onArtifactValidated({ valid: true });
    engine.onIngested({ ok: false, processed: 0 });
    expect(engine.currentStage()).toBe("FAILED");
    expect(engine.view().blocker?.code).toBe("UNSUPPORTED_STATE");
    expect(engine.events().some((e) => e.type === "RUN_COMPLETED")).toBe(false);
  });
  it("downstream failure never counts step 3 as completed", () => {
    const engine = newEngine();
    driveToVerified(engine);
    engine.onDownloadDetected({ detected: false });
    expect(engine.view().progress).toEqual({ completedSteps: 2, totalSteps: 3 });
    expect(engine.events().filter((e) => e.type === "STEP_COMPLETED")).toHaveLength(1); // step 2 only
  });

  it("UNSUPPORTED_STATE stays TERMINAL even though the surface probe now has a recoverable branch", () => {
    // The exhaustive switch in `onSurfaceReady` is what guarantees this, but assert the outcome too:
    // this is the boundary of the recovery park and a PO-level constraint, not an implementation detail.
    failAt((e) => { e.command(cmd(e, "START_RUN")); e.onSurfaceReady({ ok: false, blockerCode: "UNSUPPORTED_STATE" }); }, "UNSUPPORTED_STATE");
    const engine = newEngine();
    engine.command(cmd(engine, "START_RUN"));
    engine.onSurfaceReady({ ok: false, blockerCode: "UNSUPPORTED_STATE" });
    expect(engine.view().allowedCommands).toEqual([]);
    expect(engine.view().blocker?.recoverable).toBe(false);
  });

  it("unchanged expected state → NO false completion, remains waiting", () => {
    const engine = newEngine();
    engine.command(cmd(engine, "START_RUN"));
    engine.onSurfaceReady(true);
    engine.onLocated({ count: 1, sig: SIG });
    engine.onHighlighted();
    engine.onUserActionObserved();
    engine.command(cmd(engine, "REQUEST_STEP_RECHECK"));
    const eff = engine.onVerified({ verified: false, drift: false });
    expect(eff).toBe("OBSERVE");
    expect(engine.currentStage()).toBe("WAIT_FOR_USER_ACTION");
    expect(engine.events().some((e) => e.type === "STEP_COMPLETED")).toBe(false);
    expect(engine.events().some((e) => e.type === "RUN_COMPLETED")).toBe(false);
    expect(engine.view().status).toBe("WAITING_FOR_HUMAN");
  });
});

/**
 * The recovery park (A2-B). A surface probe that finds a session the SELLER can fix does NOT fail closed:
 * the run parks alive at WAITING_FOR_HUMAN with `recoverable: true`, and REQUEST_STEP_RECHECK re-probes.
 * These cases used to live in `fail-closed cases` and asserted the opposite — that is the deliberate
 * behavior change of this slice, kept visible by living under a differently-named describe.
 */
describe("engine — recovery park (LOGIN_REQUIRED / SESSION_EXPIRED)", () => {
  const parkAt = (code: "LOGIN_REQUIRED" | "SESSION_EXPIRED") => {
    const engine = newEngine();
    engine.command(cmd(engine, "START_RUN"));
    const effect = engine.onSurfaceReady({ ok: false, blockerCode: code });
    return { engine, effect };
  };

  it.each(["LOGIN_REQUIRED", "SESSION_EXPIRED"] as const)("%s parks alive and recoverable — it never fails closed", (code) => {
    const { engine, effect } = parkAt(code);

    expect(effect).toBe("NONE"); // nothing to drive: we wait on the human
    expect(engine.currentStage()).toBe("AWAIT_SESSION_RECOVERY");
    expect(engine.view().status).toBe("WAITING_FOR_HUMAN");
    expect(engine.view().blocker).toEqual({ code, recoverable: true });
    expect(engine.view().progress).toEqual({ completedSteps: 0, totalSteps: 3 });
    expect(engine.view().allowedCommands).toContain("REQUEST_STEP_RECHECK");
    expect(engine.view().allowedCommands).toContain("CANCEL_RUN");
    // Nothing failed, so no RUN_FAILED — the run is still alive.
    expect(engine.events().map((e) => e.type)).not.toContain("RUN_FAILED");
    expect(validateRunView(engine.view())).toEqual({ ok: true });
    for (const e of engine.events()) expect(validateEventEnvelope(e)).toEqual({ ok: true });
  });

  it("is the first `recoverable: true` the engine has ever emitted, and the event agrees with the view", () => {
    const { engine } = parkAt("LOGIN_REQUIRED");
    const blocked = engine.events().find((e) => e.type === "RUN_BLOCKED")!;
    expect(blocked.payload).toMatchObject({ code: "LOGIN_REQUIRED", recoverable: true });
    expect(engine.view().blocker?.recoverable).toBe(true);
  });

  it("never emits HUMAN_ACTION_REQUIRED — that event means the step-2 export barrier, which was never reached", () => {
    // `operation-run.ts` derives humanCheckpoint.reached from this event. Emitting it here would record
    // that the run reached the export barrier while it never left step 1.
    const { engine } = parkAt("LOGIN_REQUIRED");
    expect(engine.events().map((e) => e.type)).not.toContain("HUMAN_ACTION_REQUIRED");
    expect(engine.events().map((e) => e.type)).not.toContain("TARGET_HIGHLIGHTED");
  });

  it("projects step 1 even when the run parked after resuming from a downstream failure", () => {
    // `resumeStateFor` tests FAILED before activeStepIndex>=3, so a run that failed at DETECT_DOWNLOAD
    // resumes through PREPARE_SESSION still carrying activeStepIndex 3. Parking must reset it, or the FE
    // shows "step 3 of 3 · downstream" while waiting on a step-1 session probe.
    const engine = newEngine();
    driveToVerified(engine);
    engine.onDownloadDetected({ detected: false }); // → FAILED at activeStepIndex 3
    engine.pauseForRestore("PREPARE_SESSION");
    engine.command(cmd(engine, "RESUME_RUN"));
    engine.onSurfaceReady({ ok: false, blockerCode: "LOGIN_REQUIRED" });

    expect(engine.currentStage()).toBe("AWAIT_SESSION_RECOVERY");
    expect(engine.view().currentStep?.stepNumber).toBe(1);
    expect(engine.view().currentStep?.stepId).toBe("aw.prepare_surface");
    expect(validateRunView(engine.view())).toEqual({ ok: true });
  });

  it("REQUEST_STEP_RECHECK re-probes the surface and does NOT clear the blocker by itself", () => {
    // The contract's own rule: a recheck means "the user reports they acted; go observe and verify
    // again" — never "it is done". A human assertion is not evidence.
    const { engine } = parkAt("LOGIN_REQUIRED");
    const outcome = engine.command(cmd(engine, "REQUEST_STEP_RECHECK"));

    expect(outcome.ok).toBe(true);
    expect(outcome.ok && outcome.effect).toBe("PREPARE"); // a REAL fresh prepareSurface probe
    expect(engine.currentStage()).toBe("PREPARE_SESSION");
    expect(engine.view().status).toBe("PREPARING");
    expect(engine.view().blocker).toEqual({ code: "LOGIN_REQUIRED", recoverable: true }); // still blocked
    expect(validateRunView(engine.view())).toEqual({ ok: true });
  });

  it("only a READY probe clears the blocker and advances", () => {
    const { engine } = parkAt("SESSION_EXPIRED");
    engine.command(cmd(engine, "REQUEST_STEP_RECHECK"));
    expect(engine.onSurfaceReady({ ok: true })).toBe("LOCATE");

    expect(engine.view().blocker).toBeUndefined();
    expect(engine.currentStage()).toBe("LOCATE_TARGET");
    expect(engine.view().progress).toEqual({ completedSteps: 1, totalSteps: 3 });
  });

  it("a recheck that finds the session still broken re-parks — the loop closes, it does not drift terminal", () => {
    const { engine } = parkAt("LOGIN_REQUIRED");
    engine.command(cmd(engine, "REQUEST_STEP_RECHECK"));
    const effect = engine.onSurfaceReady({ ok: false, blockerCode: "LOGIN_REQUIRED" });

    expect(effect).toBe("NONE");
    expect(engine.currentStage()).toBe("AWAIT_SESSION_RECOVERY");
    expect(engine.view().status).toBe("WAITING_FOR_HUMAN");
    expect(engine.view().allowedCommands).toContain("REQUEST_STEP_RECHECK"); // still recoverable
  });

  it("a second recheck while the re-probe is in flight is rejected — the race is closed", () => {
    const { engine } = parkAt("LOGIN_REQUIRED");
    engine.command(cmd(engine, "REQUEST_STEP_RECHECK")); // → PREPARE_SESSION
    const second = engine.command(cmd(engine, "REQUEST_STEP_RECHECK"));

    expect(second.ok).toBe(false);
    expect(!second.ok && second.reason).toBe("INVALID_FOR_STATE");
    expect(engine.currentStage()).toBe("PREPARE_SESSION"); // unmoved
  });

  it("⚠ KNOWN LIMITATION: a recovered session on the WRONG surface lands terminal UNSUPPORTED_STATE", () => {
    // The driver never navigates, so a recheck probes whatever page login left the seller on. If that is
    // not the export surface, readiness HALTs → UNSUPPORTED_STATE → terminal, i.e. a *successful* login
    // can still kill the run. "Return to the review page before rechecking" is a guidance-only §4 human
    // precondition (D-028), the same category D-025 ratified for period/scope: observed, never gated.
    // This test exists so that behavior is KNOWN rather than discovered. Its falsifier is a live run.
    const { engine } = parkAt("LOGIN_REQUIRED");
    engine.command(cmd(engine, "REQUEST_STEP_RECHECK"));
    engine.onSurfaceReady({ ok: false, blockerCode: "UNSUPPORTED_STATE" });

    expect(engine.currentStage()).toBe("FAILED");
    expect(engine.view().blocker).toEqual({ code: "UNSUPPORTED_STATE", recoverable: false });
    expect(engine.view().allowedCommands).toEqual([]);
  });

  it("CANCEL_RUN from a park clears the blocker — a cancelled run never claims to be recoverable", () => {
    const { engine } = parkAt("LOGIN_REQUIRED");
    const outcome = engine.command(cmd(engine, "CANCEL_RUN"));

    expect(outcome.ok && outcome.effect).toBe("CLEANUP");
    expect(engine.view().status).toBe("CANCELLED");
    expect(engine.view().blocker).toBeUndefined(); // NOT `recoverable: true` with allowedCommands []
    expect(engine.view().allowedCommands).toEqual([]);
    expect(engine.view().currentStep?.status).toBe("SKIPPED");
    // The audit history keeps the reason; only the live view drops it.
    expect(engine.events().find((e) => e.type === "RUN_BLOCKED")!.payload.code).toBe("LOGIN_REQUIRED");
    expect(validateRunView(engine.view())).toEqual({ ok: true });
  });

  it("a parked run never reaches COMPLETED and never fabricates progress", () => {
    const { engine } = parkAt("SESSION_EXPIRED");
    expect(engine.view().status).not.toBe("COMPLETED");
    expect(engine.events().map((e) => e.type)).not.toContain("RUN_COMPLETED");
    expect(engine.events().map((e) => e.type)).not.toContain("STEP_COMPLETED");
    expect(engine.view().progress.completedSteps).toBe(0);
  });

  it("emits no prohibited content", () => {
    const { engine } = parkAt("LOGIN_REQUIRED");
    expect(findProhibitedFields(engine.view())).toEqual([]);
    for (const e of engine.events()) expect(findProhibitedFields(e)).toEqual([]);
  });
});

describe("engine — command semantics", () => {
  it("duplicate commandId is idempotent (no duplicate RUN_STARTED)", () => {
    const engine = newEngine();
    const c = cmd(engine, "START_RUN");
    const r1 = engine.command(c);
    const before = engine.events().length;
    const r2 = engine.command(c);
    expect(r1.ok && !r1.idempotent).toBe(true);
    expect(r2.ok && r2.idempotent).toBe(true);
    expect(engine.events().length).toBe(before);
  });

  it("stale expectedRevision is rejected without mutation", () => {
    const engine = newEngine();
    engine.command(cmd(engine, "START_RUN")); // revision now 1
    const stale = engine.command(cmd(engine, "PAUSE_RUN", undefined, 0));
    expect(stale.ok).toBe(false);
    expect(stale.ok === false && stale.reason).toBe("STALE_REVISION");
    expect(engine.currentStage()).toBe("PREPARE_SESSION");
  });

  it("command invalid for the current state is rejected without mutation", () => {
    const engine = newEngine();
    engine.command(cmd(engine, "START_RUN"));
    const r = engine.command(cmd(engine, "REQUEST_STEP_RECHECK")); // not valid in PREPARE_SESSION
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toBe("INVALID_FOR_STATE");
    expect(engine.currentStage()).toBe("PREPARE_SESSION");
  });

  it("unsupported protocol version fails closed", () => {
    const engine = newEngine();
    const r = engine.command({ ...cmd(engine, "START_RUN"), protocolVersion: 2 });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toBe("UNSUPPORTED_PROTOCOL_VERSION");
  });

  it("SWITCH_TO_MANUAL returns a sanitized unsupported result (no mutation)", () => {
    const engine = newEngine();
    engine.command(cmd(engine, "START_RUN"));
    engine.onSurfaceReady(true);
    engine.onLocated({ count: 1, sig: SIG });
    engine.onHighlighted();
    const rev = engine.currentRevision();
    const r = engine.command(cmd(engine, "SWITCH_TO_MANUAL"));
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toBe("UNSUPPORTED_MANUAL");
    expect(engine.currentRevision()).toBe(rev);
  });

  it("FIND_CURRENT_STEP is read-only (no new events, no revision bump)", () => {
    const engine = newEngine();
    engine.command(cmd(engine, "START_RUN"));
    const rev = engine.currentRevision();
    const n = engine.events().length;
    const r = engine.command(cmd(engine, "FIND_CURRENT_STEP"));
    expect(r.ok).toBe(true);
    expect(engine.currentRevision()).toBe(rev);
    expect(engine.events().length).toBe(n);
  });

  it("SET_GUIDANCE_ENABLED toggles guidance and bumps revision", () => {
    const engine = newEngine();
    engine.command(cmd(engine, "START_RUN"));
    const rev = engine.currentRevision();
    engine.command(cmd(engine, "SET_GUIDANCE_ENABLED", { enabled: false }));
    expect(engine.view().guidanceEnabled).toBe(false);
    expect(engine.currentRevision()).toBe(rev + 1);
  });

  it("cancel → CANCELLED with cleanup effect and no further commands", () => {
    const engine = newEngine();
    engine.command(cmd(engine, "START_RUN"));
    engine.onSurfaceReady(true);
    engine.onLocated({ count: 1, sig: SIG });
    engine.onHighlighted();
    const r = engine.command(cmd(engine, "CANCEL_RUN"));
    expect(r.ok && r.effect).toBe("CLEANUP");
    expect(engine.currentStage()).toBe("CANCELLED");
    expect(engine.view().status).toBe("CANCELLED");
    expect(engine.view().allowedCommands).toEqual([]);
    expect(validateRunView(engine.view())).toEqual({ ok: true });
  });

  it("pause then resume returns to waiting", () => {
    const engine = newEngine();
    engine.command(cmd(engine, "START_RUN"));
    engine.onSurfaceReady(true);
    engine.onLocated({ count: 1, sig: SIG });
    engine.onHighlighted();
    engine.command(cmd(engine, "PAUSE_RUN"));
    expect(engine.view().status).toBe("PAUSED");
    expect(validateRunView(engine.view())).toEqual({ ok: true });
    const r = engine.command(cmd(engine, "RESUME_RUN"));
    expect(r.ok && r.effect).toBe("OBSERVE");
    expect(engine.currentStage()).toBe("WAIT_FOR_USER_ACTION");
    expect(engine.view().status).toBe("WAITING_FOR_HUMAN");
  });
});

describe("engine — structural no-click invariant", () => {
  it("production Action Window source contains no target-click dispatch", () => {
    const srcDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../src/action-window");
    const files = readdirSync(srcDir).filter((f) => f.endsWith(".ts"));
    const banned = [/\.click\s*\(/, /dispatchEvent\s*\(/, /\.tap\s*\(/, /mouse\s*\.\s*(click|down|up)\s*\(/, /\.dblclick\s*\(/];
    for (const f of files) {
      const body = readFileSync(join(srcDir, f), "utf8");
      for (const re of banned) expect(re.test(body), `${f} :: ${re}`).toBe(false);
    }
  });
});

describe("engine — canonical (post-#214) contract conformance (regression)", () => {
  it("uses the canonical ExecutionMode vocabulary, not the pre-#214 placeholders", () => {
    expect([...EXECUTION_MODES]).toEqual(["AUTOMATIC_OPERATION", "ACTION_WINDOW", "FILE_IMPORT", "INTEGRATION_PENDING"]);
    const engine = newEngine();
    driveHappyPath(engine);
    // every projected view across the run validates AND carries no Runtime prose (title/instruction/channel)
    expect(validateRunView(engine.view())).toEqual({ ok: true });
    expect(findProhibitedFields(engine.view())).toEqual([]);
  });

  it("projects channelCode + dotted copyKey (never a title/instruction)", () => {
    const engine = newEngine();
    engine.command(cmd(engine, "START_RUN", { channelCode: "synthetic" }));
    engine.onSurfaceReady(true);
    engine.onLocated({ count: 1, sig: SIG });
    engine.onHighlighted();
    const view = engine.view();
    expect(view.channelCode).toBe("synthetic");
    expect(view.runCopyKey).toMatch(/^[A-Za-z][A-Za-z0-9]*(\.[A-Za-z0-9]+)+$/);
    expect(view.currentStep?.copyKey).toMatch(/^[A-Za-z][A-Za-z0-9]*(\.[A-Za-z0-9]+)+$/);
    expect((view as unknown as Record<string, unknown>).title).toBeUndefined();
    expect((view.currentStep as unknown as Record<string, unknown>).instruction).toBeUndefined();
    expect(validateRunView(view)).toEqual({ ok: true });
  });

  it("emits a contract-valid START_RUN command envelope (channelCode payload)", () => {
    const c = cmd(newEngine(), "START_RUN", { channelCode: "synthetic" });
    expect(validateCommandEnvelope(c)).toEqual({ ok: true });
  });
});
