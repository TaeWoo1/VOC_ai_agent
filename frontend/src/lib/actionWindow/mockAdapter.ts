// Contract-backed mock adapter for the FE-1 Review Operations flow.
//
// It serves the shared, contract-valid fixtures and applies minimal deterministic
// transitions to demonstrate the flow. It is NOT the Runtime state machine and has
// no Bridge/Chrome/Backend dependency. Runtime alone verifies observations and
// completes steps — this mock NEVER completes a step from REQUEST_STEP_RECHECK.

import type { ActionWindowRunView, CommandType } from "./contract";
import { SCENARIO_NAMES, UI_SCENARIOS, type ScenarioName, type UiScenario } from "./fixtures";

export interface CommandResult {
  run: ActionWindowRunView | null;
  /** Sanitized, FE-authored note describing the mock transition (demo only). */
  note: string;
  applied: boolean;
}

export function listScenarios(): readonly ScenarioName[] {
  return SCENARIO_NAMES;
}

export function getScenario(name: ScenarioName): UiScenario {
  return UI_SCENARIOS[name];
}

/** A command is dispatchable only if the current view lists it (or START when idle). */
export function isCommandAllowed(run: ActionWindowRunView | null, type: CommandType): boolean {
  if (run === null) return type === "START_RUN";
  return run.allowedCommands.includes(type);
}

export function applyCommand(run: ActionWindowRunView | null, type: CommandType): CommandResult {
  if (!isCommandAllowed(run, type)) {
    return { run, note: "지금은 할 수 없는 동작이라 무시했어요.", applied: false };
  }
  switch (type) {
    case "START_RUN":
      return { run: UI_SCENARIOS["starting"].run, note: "실행을 시작했어요.", applied: true };
    case "PAUSE_RUN":
      return { run: UI_SCENARIOS["paused"].run, note: "일시정지했어요.", applied: true };
    case "RESUME_RUN":
      return { run: UI_SCENARIOS["observing"].run, note: "이어서 진행해요.", applied: true };
    case "CANCEL_RUN":
      return { run: UI_SCENARIOS["ready-to-start"].run, note: "실행을 취소했어요.", applied: true };
    case "SWITCH_TO_MANUAL":
      return { run: UI_SCENARIOS["waiting-for-user"].run, note: "직접 진행 모드로 전환했어요.", applied: true };
    case "FIND_CURRENT_STEP":
      return { run, note: "현재 단계를 다시 확인했어요.", applied: true };
    case "SET_GUIDANCE_ENABLED":
      return run
        ? { run: { ...run, guidanceEnabled: !run.guidanceEnabled }, note: "안내 표시를 전환했어요.", applied: true }
        : { run, note: "", applied: false };
    case "REQUEST_STEP_RECHECK":
      // The user reports they finished the action; Runtime would now OBSERVE and
      // verify. The mock moves to `observing` and NEVER marks the step complete.
      return { run: UI_SCENARIOS["observing"].run, note: "확인하고 있어요. 잠시만 기다려 주세요.", applied: true };
    default:
      return { run, note: "", applied: false };
  }
}
