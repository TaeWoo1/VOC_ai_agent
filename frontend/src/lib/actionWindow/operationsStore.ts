// Shared mock-state module between the operations home (/operations) and the run
// detail (/operations/current) — FE-2 product decision: one small store instead of
// per-page state, so a command dispatched on either surface is reflected on both.
//
// Runtime semantics stay in the FE-1 mock adapter (`applyCommand`); this store adds
// only UI-only rules:
//  - a terminal run (COMPLETED/FAILED/CANCELLED view) stays in the active zone and
//    moves to recent activity when it is replaced (product decision);
//  - starting over a terminal run first clears the active zone — the idle start
//    affordance, never a bypass of `allowedCommands` on a live run.
// Recheck-never-completes is inherited from `applyCommand`, not re-implemented.

import type { ActionWindowRunView, CommandType } from "./contract";
import { applyCommand } from "./mockAdapter";
import { UI_SCENARIOS, type ScenarioName } from "./fixtures";
import {
  HOME_SCENARIOS,
  isTerminalRunStatus,
  toRecentRunItem,
  type HomeScenarioName,
  type RecentRunItem,
} from "./homeFixtures";

export interface OperationsState {
  run: ActionWindowRunView | null;
  recentRuns: RecentRunItem[];
  /** Sanitized, FE-authored note describing the last mock transition (demo only). */
  note: string;
  /** Last-loaded fixture names — used only to highlight the DEV selectors. */
  runScenario: ScenarioName;
  homeScenario: HomeScenarioName;
}

const INITIAL_HOME: HomeScenarioName = "home-active-checkpoint";

function initialState(): OperationsState {
  const view = HOME_SCENARIOS[INITIAL_HOME].view;
  return {
    run: view.activeRun,
    recentRuns: view.recentRuns,
    note: "",
    runScenario: "human-action-required",
    homeScenario: INITIAL_HOME,
  };
}

let state: OperationsState = initialState();
const listeners = new Set<() => void>();

function setState(next: OperationsState): void {
  state = next;
  for (const listener of listeners) listener();
}

export function getOperationsState(): OperationsState {
  return state;
}

export function subscribeOperationsState(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** UI-only cap on the mock recent-activity list; oldest items drop off. */
const RECENT_LIMIT = 5;

/** True when the start affordance applies: no active run, or a terminal one (which
 *  moves to recent activity when the new run starts). */
export function canStartNewRun(run: ActionWindowRunView | null): boolean {
  return run === null || isTerminalRunStatus(run.status);
}

export function dispatchOperationsCommand(type: CommandType): void {
  const prev = state.run;
  const effective =
    type === "START_RUN" && prev !== null && isTerminalRunStatus(prev.status) ? null : prev;
  const result = applyCommand(effective, type);
  if (!result.applied) {
    setState({ ...state, note: result.note });
    return;
  }
  const archived =
    prev !== null && isTerminalRunStatus(prev.status) && result.run !== prev
      ? toRecentRunItem(prev)
      : null;
  // A run appears once in recent activity: re-archiving the same runId (the demo
  // fixtures reuse one id) replaces the older entry instead of duplicating it.
  const recentRuns = archived
    ? [archived, ...state.recentRuns.filter((i) => i.runId !== archived.runId)].slice(
        0,
        RECENT_LIMIT,
      )
    : state.recentRuns;
  setState({ ...state, run: result.run, recentRuns, note: result.note });
}

// DEV fixture loads — wholesale previews, so no archiving.
export function loadRunScenario(name: ScenarioName): void {
  setState({ ...state, run: UI_SCENARIOS[name].run, note: "", runScenario: name });
}

export function loadHomeScenario(name: HomeScenarioName): void {
  const view = HOME_SCENARIOS[name].view;
  setState({
    ...state,
    run: view.activeRun,
    recentRuns: view.recentRuns,
    note: "",
    homeScenario: name,
  });
}

/** Test-only: full reset to the initial demo state. */
export function resetOperationsStateForTests(): void {
  setState(initialState());
}
