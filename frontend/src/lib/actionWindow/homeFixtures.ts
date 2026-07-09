// FE-2 home fixtures + UI-ONLY projections for the operations-agent home.
//
// `HomeView` and `RecentRunItem` are FE projections, NOT protocol types: the shared
// contract defines a single-run `ActionWindowRunView` and no run-list/history wire
// shape. Any real multi-run wire type would be a separate contract PR — these exist
// only so the mock-driven home can render. Every embedded `activeRun` reuses an
// FE-1 fixture and stays contract-valid (asserted via `validateRunView` in tests).
// History items carry only sanitized data already allowed in FE surfaces (copy
// keys, channel codes, enums, counts, ISO timestamps).

import type { ActionWindowRunView, RunStatus } from "./contract";
import { UI_SCENARIOS } from "./fixtures";

/** Run statuses that end a run — the only statuses allowed in recent activity. */
export type TerminalRunStatus = Extract<RunStatus, "COMPLETED" | "FAILED" | "CANCELLED">;
export const TERMINAL_RUN_STATUSES: readonly TerminalRunStatus[] = [
  "COMPLETED",
  "FAILED",
  "CANCELLED",
];

export function isTerminalRunStatus(status: RunStatus): status is TerminalRunStatus {
  return (TERMINAL_RUN_STATUSES as readonly RunStatus[]).includes(status);
}

/** UI-only projection of a finished run for the read-only recent-activity list. */
export interface RecentRunItem {
  runId: string;
  runCopyKey: string;
  channelCode: string;
  status: TerminalRunStatus;
  completedSteps: number;
  totalSteps: number;
  /** Sanitized ISO timestamp — the run's last update when it left the active zone. */
  finishedAt: string;
}

/** UI-only view the home renders: at most one active run + mock recent activity. */
export interface HomeView {
  activeRun: ActionWindowRunView | null;
  recentRuns: RecentRunItem[];
}

/** Project a terminal run view into a recent-activity item; null for a live run. */
export function toRecentRunItem(run: ActionWindowRunView): RecentRunItem | null {
  if (!isTerminalRunStatus(run.status)) return null;
  return {
    runId: run.runId,
    runCopyKey: run.runCopyKey,
    channelCode: run.channelCode,
    status: run.status,
    completedSteps: run.progress.completedSteps,
    totalSteps: run.progress.totalSteps,
    finishedAt: run.updatedAt,
  };
}

export type HomeScenarioName =
  | "home-empty"
  | "home-active-running"
  | "home-active-checkpoint"
  | "home-active-paused"
  | "home-completed-just-now"
  | "home-with-history";

export const HOME_SCENARIO_NAMES: readonly HomeScenarioName[] = [
  "home-empty",
  "home-active-running",
  "home-active-checkpoint",
  "home-active-paused",
  "home-completed-just-now",
  "home-with-history",
];

export interface HomeScenario {
  name: HomeScenarioName;
  view: HomeView;
}

// Mock history items (demo data; distinct runIds, terminal statuses only).
const HISTORY_COMPLETED_0705: RecentRunItem = {
  runId: "run_demo_esm_0705",
  runCopyKey: "actionWindow.review.run",
  channelCode: "esm_plus",
  status: "COMPLETED",
  completedSteps: 4,
  totalSteps: 4,
  finishedAt: "2026-07-05T09:12:00Z",
};
const HISTORY_FAILED_0703: RecentRunItem = {
  runId: "run_demo_esm_0703",
  runCopyKey: "actionWindow.review.run",
  channelCode: "esm_plus",
  status: "FAILED",
  completedSteps: 3,
  totalSteps: 4,
  finishedAt: "2026-07-03T14:40:00Z",
};
const HISTORY_COMPLETED_0701: RecentRunItem = {
  runId: "run_demo_esm_0701",
  runCopyKey: "actionWindow.review.run",
  channelCode: "esm_plus",
  status: "COMPLETED",
  completedSteps: 4,
  totalSteps: 4,
  finishedAt: "2026-07-01T08:03:00Z",
};

export const HOME_SCENARIOS: Record<HomeScenarioName, HomeScenario> = {
  "home-empty": {
    name: "home-empty",
    view: { activeRun: null, recentRuns: [] },
  },
  "home-active-running": {
    name: "home-active-running",
    view: {
      activeRun: UI_SCENARIOS["observing"].run,
      recentRuns: [HISTORY_COMPLETED_0705],
    },
  },
  "home-active-checkpoint": {
    name: "home-active-checkpoint",
    view: {
      activeRun: UI_SCENARIOS["human-action-required"].run,
      recentRuns: [HISTORY_COMPLETED_0705],
    },
  },
  "home-active-paused": {
    name: "home-active-paused",
    view: { activeRun: UI_SCENARIOS["paused"].run, recentRuns: [] },
  },
  // Product decision: a just-completed run stays in the active zone; it moves to
  // recent activity when the next run starts (see operationsStore archive rule).
  "home-completed-just-now": {
    name: "home-completed-just-now",
    view: {
      activeRun: UI_SCENARIOS["completed"].run,
      recentRuns: [HISTORY_COMPLETED_0705, HISTORY_FAILED_0703],
    },
  },
  "home-with-history": {
    name: "home-with-history",
    view: {
      activeRun: null,
      recentRuns: [HISTORY_COMPLETED_0705, HISTORY_FAILED_0703, HISTORY_COMPLETED_0701],
    },
  },
};
