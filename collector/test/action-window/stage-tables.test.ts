/**
 * **Stage-table completeness (A2-B).** The `Stage` union is mapped in several places, and only SOME of
 * those mappings break the build when a stage is added:
 *
 *  - `stageToRunStatus` / `stageToStepStatus` / `allowedCommands` — exhaustive switches, non-nullable
 *    returns ⇒ a new stage IS a compile error. Safe on their own.
 *  - `stageStepIndex` — has a `default`, so a new stage silently returns the wrong step.
 *  - `operation-run.ts`'s private `STAGES` allow-list — a plain `readonly Stage[]`, which accepts a
 *    SUBSET, so a missing entry compiles and then fails at runtime. Not loudly, either: the save path
 *    re-parses and throws from inside the session's drive chain, where the throw is swallowed into
 *    `fatalCleanup` — the run parks in memory, nothing reaches disk, and no error surfaces.
 *
 * This file is the net under the silent ones. `ALL_STAGES` is a `Record<Stage, …>`, so it is itself
 * compile-exhaustive: a new stage cannot be added to the union without being declared here, and it is
 * then automatically dragged through every check below.
 */
import { describe, it, expect } from "vitest";
import { EXECUTION_MODES, validateRunView } from "../../../contracts/action-window/v1/index";
import { projectRunView, type EngineSnapshot } from "../../src/action-window/view";
import { parseOperationRun, type OperationRun, OPERATION_RUN_SCHEMA_VERSION } from "../../src/action-window/operation-run";
import { STEP_PLAN, stageStepIndex, stageToRunStatus, type Stage } from "../../src/action-window/stages";

/**
 * Every stage, with a COHERENT active step — the index the engine actually holds when it is in that
 * stage. Adding a `Stage` without adding it here is a compile error. That is the point.
 */
const ALL_STAGES: Record<Stage, { activeStepIndex: number; resumeStage?: Stage }> = {
  PREPARE_SESSION: { activeStepIndex: 1 },
  OPEN_TARGET_SURFACE: { activeStepIndex: 1 },
  LOCATE_TARGET: { activeStepIndex: 2 },
  HIGHLIGHT_TARGET: { activeStepIndex: 2 },
  WAIT_FOR_USER_ACTION: { activeStepIndex: 2 },
  VERIFY_TRANSITION: { activeStepIndex: 2 },
  DETECT_DOWNLOAD: { activeStepIndex: 3 },
  VALIDATE_ARTIFACT: { activeStepIndex: 3 },
  INGEST_HANDOFF: { activeStepIndex: 3 },
  // The recovery park always resets to step 1: it waits on a step-1 session probe regardless of how
  // far the run had previously got (a resumed downstream failure re-enters through PREPARE_SESSION).
  AWAIT_SESSION_RECOVERY: { activeStepIndex: 1 },
  COMPLETE: { activeStepIndex: 3 },
  FAILED: { activeStepIndex: 2 },
  CANCELLED: { activeStepIndex: 2 },
  PAUSED: { activeStepIndex: 2, resumeStage: "WAIT_FOR_USER_ACTION" },
};

const STAGES = Object.keys(ALL_STAGES) as Stage[];

function snapshotFor(stage: Stage): EngineSnapshot {
  const { activeStepIndex, resumeStage } = ALL_STAGES[stage];
  return {
    runId: "run_t1",
    channelCode: "synthetic",
    runCopyKey: "actionWindow.run.synthetic",
    stage,
    resumeStage: resumeStage ?? null,
    activeStepIndex,
    revision: 1,
    guidanceEnabled: true,
    // A blocker on every stage is the hostile case: it must never make a view invalid, and COMPLETED
    // must suppress it. The park is the only stage that carries one while non-terminal.
    blocker: { code: "LOGIN_REQUIRED", recoverable: true },
    completedSteps: 0,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("stage tables — every Stage projects a CONTRACT-VALID view", () => {
  it.each(STAGES)("%s projects a valid run view", (stage) => {
    // This is the structural lock for the WAITING_FOR_HUMAN three-way coupling: the contract requires
    // WAITING_FOR_HUMAN ⇒ executionMode ACTION_WINDOW && step AWAITING_USER, and those come from three
    // different tables (stageToRunStatus, stageToStepStatus, and the step plan's mode). Any one of them
    // moving alone produces an invalid view — which the save path turns into a silently lost record.
    expect(validateRunView(projectRunView(snapshotFor(stage)))).toEqual({ ok: true });
  });

  it("the recovery park is ACTION_WINDOW even though its step's plan mode is AUTOMATIC_OPERATION", () => {
    // The override must be scoped to the park: the step's PLAN mode describes how the step normally
    // runs, the run's executionMode describes who must act NOW. They diverge here and nowhere else.
    expect(STEP_PLAN[0]!.mode).toBe("AUTOMATIC_OPERATION");
    expect(projectRunView(snapshotFor("AWAIT_SESSION_RECOVERY")).executionMode).toBe("ACTION_WINDOW");
    expect(projectRunView(snapshotFor("PREPARE_SESSION")).executionMode).toBe("AUTOMATIC_OPERATION");
    expect(projectRunView(snapshotFor("PREPARE_SESSION")).status).toBe("PREPARING");
  });

  it("a COMPLETED view never exposes a blocker, even when the engine still holds one", () => {
    expect(projectRunView(snapshotFor("COMPLETE")).blocker).toBeUndefined();
  });

  it("stageStepIndex agrees with the active step each stage actually runs under", () => {
    // stageStepIndex has a `default`, so it cannot fail the build. This is the only thing standing
    // between a new stage and a silently wrong answer. Terminal/paused stages resolve against the
    // stored active step by design, so they are exempt.
    const resolvesAgainstStoredStep: Stage[] = ["FAILED", "CANCELLED", "PAUSED"];
    for (const stage of STAGES) {
      if (resolvesAgainstStoredStep.includes(stage)) continue;
      expect(stageStepIndex(stage), `stageStepIndex(${stage})`).toBe(ALL_STAGES[stage].activeStepIndex);
    }
  });
});

describe("stage tables — every Stage survives persistence", () => {
  const recordFor = (stage: Stage): OperationRun => {
    const snap = snapshotFor(stage);
    return {
      schemaVersion: OPERATION_RUN_SCHEMA_VERSION,
      runId: snap.runId,
      channelCode: snap.channelCode,
      revision: snap.revision,
      sequence: 0, // no events ⇒ the gapless-audit high-water mark is 0
      executionMode: projectRunView(snap).executionMode,
      resumeState: "RESUME_AT_CHECKPOINT",
      tasks: STEP_PLAN.map((m) => ({ stepNumber: m.stepNumber, stepId: m.stepId, copyKey: m.copyKey, mode: m.mode, status: "PENDING" as const })),
      humanCheckpoint: { stepId: STEP_PLAN[1]!.stepId, copyKey: STEP_PLAN[1]!.copyKey, reached: false, observed: false },
      latestView: projectRunView(snap),
      engine: {
        runId: snap.runId,
        channelCode: snap.channelCode,
        runCopyKey: snap.runCopyKey,
        guidanceEnabled: true,
        started: true,
        stage,
        resumeStage: snap.resumeStage,
        activeStepIndex: snap.activeStepIndex,
        revision: snap.revision,
        targetSig: null,
        observed: false,
        blocker: stage === "COMPLETE" ? null : snap.blocker,
        completedSteps: 0,
        seq: 0,
        appliedCommandIds: [],
        events: [],
      },
    };
  };

  it.each(STAGES)("%s round-trips through the persisted-record parser", (stage) => {
    // Guards the `STAGES` allow-list, which a plain `readonly Stage[]` cannot guard itself. A missing
    // entry here means the record never reaches disk — silently, because the throw is swallowed.
    const parsed = parseOperationRun(JSON.parse(JSON.stringify(recordFor(stage))));
    // Report the parser's own reason: a bare `false` here sends the next reader hunting.
    expect(parsed.ok ? "ok" : parsed.error, `stage ${stage} rejected`).toBe("ok");
  });

  it("the recovery park persists as a live WAITING_FOR_HUMAN run, not a terminal one", () => {
    expect(stageToRunStatus("AWAIT_SESSION_RECOVERY")).toBe("WAITING_FOR_HUMAN");
    const parsed = parseOperationRun(JSON.parse(JSON.stringify(recordFor("AWAIT_SESSION_RECOVERY"))));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.run.latestView.status).toBe("WAITING_FOR_HUMAN");
      expect(parsed.run.latestView.blocker).toEqual({ code: "LOGIN_REQUIRED", recoverable: true });
    }
  });

  // A tampered/corrupt record must be rejected WHOLE — never half-loaded (operation-run.ts contract).
  // These pin the two field checks that were looser than their own siblings in the same parse.
  const clone = (run: OperationRun): Record<string, unknown> => JSON.parse(JSON.stringify(run));

  it("rejects an executionMode outside the contract allow-list (not merely 'a string')", () => {
    const record = clone(recordFor("PREPARE_SESSION"));
    record.executionMode = "NOT_A_REAL_MODE";
    expect(parseOperationRun(record)).toEqual({ ok: false, error: "INVALID_FIELD" });
  });

  it("rejects a top-level channelCode that disagrees with the engine's (identity must be consistent)", () => {
    const record = clone(recordFor("PREPARE_SESSION"));
    record.channelCode = `${(record.engine as { channelCode: string }).channelCode}-tampered`;
    expect(parseOperationRun(record)).toEqual({ ok: false, error: "INVALID_FIELD" });
  });

  it("still accepts every real ExecutionMode — the tightening never rejects a valid record", () => {
    for (const mode of EXECUTION_MODES) {
      const record = clone(recordFor("PREPARE_SESSION"));
      record.executionMode = mode;
      (record.latestView as { executionMode: string }).executionMode = mode;
      expect(parseOperationRun(record).ok, `executionMode ${mode}`).toBe(true);
    }
  });
});
