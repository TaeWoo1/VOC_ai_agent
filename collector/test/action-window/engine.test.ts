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
