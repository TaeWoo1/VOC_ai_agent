import { describe, it, expect } from "vitest";
import { validateRunView, shouldApplyRunView, defaultAllowedCommands } from "./view";
import { RunStatus, CommandType } from "./enums";
import { ACTION_WINDOW_SCENARIOS } from "./fixtures";

describe("run view validation & revision semantics", () => {
  it("terminal states expose no commands (default + validation)", () => {
    for (const s of [RunStatus.COMPLETED, RunStatus.FAILED, RunStatus.CANCELLED]) {
      expect(defaultAllowedCommands(s)).toHaveLength(0);
    }
    const bad = validateRunView({
      ...ACTION_WINDOW_SCENARIOS["completed"],
      allowedCommands: [CommandType.START_RUN],
    });
    expect(bad.ok).toBe(false);
  });

  it("rejects non-1-based step numbers", () => {
    const base = ACTION_WINDOW_SCENARIOS["human-action-required"];
    const step = base.currentStep;
    expect(step).toBeDefined();
    const bad = validateRunView({ ...base, currentStep: { ...step!, stepNumber: 0 } });
    expect(bad.ok).toBe(false);
  });

  it("rejects completedSteps exceeding totalSteps", () => {
    const base = ACTION_WINDOW_SCENARIOS["observing"];
    const bad = validateRunView({ ...base, progress: { completedSteps: 9, totalSteps: 5 } });
    expect(bad.ok).toBe(false);
  });

  it("rejects a blocker on a COMPLETED run", () => {
    const base = ACTION_WINDOW_SCENARIOS["completed"];
    const bad = validateRunView({ ...base, blocker: { code: "UI_DRIFT", recoverable: true } });
    expect(bad.ok).toBe(false);
  });

  it("never applies an older revision over newer state, and never mixes run ids", () => {
    const newer = ACTION_WINDOW_SCENARIOS["processing"]; // revision 7
    const older = ACTION_WINDOW_SCENARIOS["observing"]; // revision 5, same runId
    expect(shouldApplyRunView(newer, older)).toBe(false);
    expect(shouldApplyRunView(older, newer)).toBe(true);
    expect(shouldApplyRunView(undefined, older)).toBe(true);

    const otherRun = { ...newer, runId: "other_run" };
    expect(shouldApplyRunView(older, otherRun)).toBe(false);
  });

  it("distinguishes recoverable from non-recoverable blockers", () => {
    expect(ACTION_WINDOW_SCENARIOS["ui-drift"].blocker?.recoverable).toBe(true);
    expect(ACTION_WINDOW_SCENARIOS["login-required"].blocker?.recoverable).toBe(true);
    expect(ACTION_WINDOW_SCENARIOS["failed"].blocker?.recoverable).toBe(false);
  });
});

describe("copy ownership & exact schema", () => {
  const ready = ACTION_WINDOW_SCENARIOS["ready-to-start"];

  it("uses dotted semantic copy keys / codes, not prose", () => {
    expect(validateRunView(ready).ok).toBe(true);
    expect(ready.runCopyKey.includes(".")).toBe(true);
    expect(ready.currentStep?.copyKey.includes(".")).toBe(true);
    expect(ready.channelCode.includes(" ")).toBe(false);
  });

  it("rejects Runtime-authored prose fields at the run level", () => {
    for (const extra of [
      { title: "리뷰 내려받기" },
      { message: "안녕하세요" },
      { instruction: "버튼을 누르세요" },
      { html: "<b>x</b>" },
      { displayText: "text" },
    ]) {
      expect(validateRunView({ ...ready, ...extra }).ok).toBe(false);
    }
  });

  it("rejects prose fields inside currentStep", () => {
    const base = ACTION_WINDOW_SCENARIOS["human-action-required"];
    const step = base.currentStep;
    expect(step).toBeDefined();
    for (const extra of [{ title: "x" }, { instruction: "y" }]) {
      expect(validateRunView({ ...base, currentStep: { ...step!, ...extra } }).ok).toBe(false);
    }
  });

  it("rejects a blocker that carries prose (unknown 'message' field)", () => {
    const base = ACTION_WINDOW_SCENARIOS["ui-drift"];
    const bad = validateRunView({
      ...base,
      blocker: { code: base.blocker!.code, recoverable: true, message: "prose" },
    });
    expect(bad.ok).toBe(false);
  });

  it("rejects a runCopyKey that is prose and a channelCode that is a title", () => {
    expect(validateRunView({ ...ready, runCopyKey: "리뷰 내려받기" }).ok).toBe(false);
    expect(validateRunView({ ...ready, channelCode: "지마켓 스토어" }).ok).toBe(false);
  });

  it("rejects non-primitive or markup copy params, accepts sanitized primitives", () => {
    expect(validateRunView({ ...ready, runCopyParams: { nested: { a: 1 } } }).ok).toBe(false);
    expect(validateRunView({ ...ready, runCopyParams: { note: "<b>x</b>" } }).ok).toBe(false);
    expect(validateRunView({ ...ready, runCopyParams: { count: 3, marketplace: "gmarket" } }).ok).toBe(true);
  });
});
