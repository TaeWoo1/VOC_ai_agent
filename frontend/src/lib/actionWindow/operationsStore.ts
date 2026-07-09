// Shared mock-state module between the operations home (/operations) and the run
// detail (/operations/current) — FE-2 product decision: one small store instead of
// per-page state, so a command dispatched on either surface is reflected on both.
//
// FE-2.5: the store consumes an FE-owned `ActionWindowSource` (see source.ts).
// The fixture source is the default and preserves all FE-1/FE-2 behavior; the
// DEV-only simulated source exercises the resilience rules below.
//
// FE-3: a Bridge-backed source (bridgeSource.ts, wrapping the R2 BridgeClient)
// can be adopted at runtime via `adoptBridgeSource` — DEV opt-in with honest
// fallback (see `connectBridgeIfEnabled`). The store logic is identical across
// all three sources; `sourceMode` only tells the DEV panels when to hide.
//
// Resilience rules (UI-side consumption discipline, not Runtime behavior):
//  - transport ordering: frames with `sequence` ≤ last seen are duplicates/late —
//    dropped via the contract's `isOutOfOrderEvent`;
//  - sequence gap: drop-until-snapshot policy (product decision) — the gapped
//    frame is dropped and an authoritative snapshot is requested instead of
//    buffering/reordering;
//  - content staleness: a live run's rendered `revision` never regresses
//    (a terminal run may be legitimately replaced by a fresh run);
//  - snapshots replace the view wholesale (no merge, no archiving);
//  - rejected commands surface a safe FE note and never mutate the view locally.
//
// UI-only rules carried from FE-2: a terminal run stays in the active zone and
// moves to recent activity when replaced (one entry per runId, capped — see
// `appendRecentRun`). Recheck-never-completes is inherited from the FE-1 mock
// adapter, not re-implemented.

import type { ActionWindowRunView, CommandType } from "./contract";
import { isOutOfOrderEvent } from "./contract";
import { UI_SCENARIOS, type ScenarioName } from "./fixtures";
import {
  HOME_SCENARIOS,
  appendRecentRun,
  isTerminalRunStatus,
  toRecentRunItem,
  type HomeScenarioName,
  type RecentRunItem,
} from "./homeFixtures";
import { COMMAND_REJECTED_COPY } from "./copy";
import { createFixtureSource, type FixtureSource } from "./fixtureSource";
import type { ActionWindowSource, SourceConnection, SourceUpdate, SteppableSource } from "./source";
import type { SimScenarioName } from "./simulatedSource";

/** Which world the store renders: the mock/fixture world (default, incl.
 *  production and the DEV simulations) or a live Bridge-backed source (FE-3,
 *  DEV opt-in). */
export type SourceMode = "fixture" | "bridge";

export interface OperationsState {
  run: ActionWindowRunView | null;
  recentRuns: RecentRunItem[];
  /** Sanitized, FE-authored note describing the last transition (demo only). */
  note: string;
  /** Monotonic id for `note` — lets each surface ignore notes issued before it
   *  mounted (no cross-page stale note). */
  noteId: number;
  /** UI resilience state reported by the source. */
  connection: SourceConnection;
  sourceMode: SourceMode;
  /** Last-loaded fixture names — used only to highlight the DEV selectors. */
  runScenario: ScenarioName;
  homeScenario: HomeScenarioName;
  /** Active DEV simulation, if any (never set in production UX). */
  simulation: SimScenarioName | null;
  /** Scripted simulation updates left to step through (DEV UI). */
  simulationRemaining: number;
}

const INITIAL_HOME: HomeScenarioName = "home-active-checkpoint";

function initialState(): OperationsState {
  const view = HOME_SCENARIOS[INITIAL_HOME].view;
  return {
    run: view.activeRun,
    recentRuns: view.recentRuns,
    note: "",
    noteId: 0,
    connection: "connected",
    sourceMode: "fixture",
    runScenario: "human-action-required",
    homeScenario: INITIAL_HOME,
    simulation: null,
    simulationRemaining: 0,
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

/** True when the start affordance applies: no active run, or a terminal one (which
 *  moves to recent activity when the new run starts). */
export function canStartNewRun(run: ActionWindowRunView | null): boolean {
  return run === null || isTerminalRunStatus(run.status);
}

// ── Source management ────────────────────────────────────────────────────────

let fixtureSource: FixtureSource = createFixtureSource(state.run);
let source: ActionWindowSource = fixtureSource;
let activeSim: SteppableSource | null = null;
let unsubscribeSource: () => void = source.subscribe(handleUpdate);
let lastSequence = 0;
let commandCounter = 0;

function switchSource(next: ActionWindowSource): void {
  unsubscribeSource();
  source = next;
  lastSequence = 0;
  unsubscribeSource = source.subscribe(handleUpdate);
}

function applyView(nextRun: ActionWindowRunView | null, note?: string): void {
  const prev = state.run;
  const archived =
    prev !== null && isTerminalRunStatus(prev.status) && nextRun !== prev
      ? toRecentRunItem(prev)
      : null;
  const recentRuns = archived ? appendRecentRun(archived, state.recentRuns) : state.recentRuns;
  setState({
    ...state,
    run: nextRun,
    recentRuns,
    ...(note !== undefined ? { note, noteId: state.noteId + 1 } : {}),
  });
}

function handleUpdate(update: SourceUpdate): void {
  switch (update.kind) {
    case "view": {
      if (isOutOfOrderEvent(update.sequence, lastSequence)) return; // duplicate / late frame
      if (update.sequence > lastSequence + 1) {
        // Sequence gap: drop-until-snapshot (no buffering/reordering).
        source.requestSnapshot();
        return;
      }
      lastSequence = update.sequence;
      const prev = state.run;
      const staleContent =
        update.run !== null &&
        prev !== null &&
        update.run.runId === prev.runId &&
        !isTerminalRunStatus(prev.status) &&
        update.run.revision < prev.revision;
      if (staleContent) return; // never regress a live run's rendered revision
      applyView(update.run, update.note);
      return;
    }
    case "snapshot": {
      // Authoritative restore: replaces the view wholesale (no merge, no archive).
      lastSequence = update.sequence;
      setState({ ...state, run: update.run });
      return;
    }
    case "connection": {
      setState({ ...state, connection: update.connection });
      return;
    }
    case "command-rejected": {
      setState({
        ...state,
        note: COMMAND_REJECTED_COPY[update.reason],
        noteId: state.noteId + 1,
      });
      return;
    }
  }
}

export function dispatchOperationsCommand(type: CommandType): void {
  commandCounter += 1;
  source.dispatch({
    commandId: `cmd_${commandCounter}`,
    type,
    expectedRevision: state.run?.revision ?? null,
  });
}

// ── Bridge source adoption (FE-3) ────────────────────────────────────────────
//    The store never imports the Bridge modules — `connectBridgeIfEnabled`
//    (bridgeSource.ts) constructs the source and hands it in, exactly like the
//    DEV simulation panel does. `cleanup` closes the client and the WS session.

let bridgeCleanup: (() => void) | null = null;

function teardownBridge(): void {
  if (bridgeCleanup) {
    const cleanup = bridgeCleanup;
    bridgeCleanup = null;
    cleanup();
  }
}

export function adoptBridgeSource(bridge: ActionWindowSource, cleanup: () => void): void {
  teardownBridge();
  activeSim = null;
  // State first: a live/loopback source may emit synchronously on subscribe, and
  // those frames must land on the fresh bridge-world state (run cleared so the
  // live run's revisions never fight a previously displayed fixture).
  state = {
    ...state,
    run: null,
    note: "",
    noteId: state.noteId + 1,
    connection: "connected",
    sourceMode: "bridge",
    simulation: null,
    simulationRemaining: 0,
  };
  bridgeCleanup = cleanup;
  switchSource(bridge);
  for (const listener of listeners) listener();
}

// ── DEV fixture loads — wholesale previews, so no archiving. Loading a fixture
//    while a simulation or a live Bridge source is active ends it and returns
//    to the fixture source seeded with the loaded scenario. ──────────────────

function ensureFixtureSource(run: ActionWindowRunView | null): void {
  teardownBridge();
  if (source !== fixtureSource) {
    activeSim = null;
    fixtureSource = createFixtureSource(run);
    switchSource(fixtureSource);
  } else {
    fixtureSource.setRun(run);
  }
}

export function loadRunScenario(name: ScenarioName): void {
  const run = UI_SCENARIOS[name].run;
  ensureFixtureSource(run);
  setState({
    ...state,
    run,
    note: "",
    noteId: state.noteId + 1,
    connection: "connected",
    sourceMode: "fixture",
    runScenario: name,
    simulation: null,
    simulationRemaining: 0,
  });
}

export function loadHomeScenario(name: HomeScenarioName): void {
  const view = HOME_SCENARIOS[name].view;
  ensureFixtureSource(view.activeRun);
  setState({
    ...state,
    run: view.activeRun,
    recentRuns: view.recentRuns,
    note: "",
    noteId: state.noteId + 1,
    connection: "connected",
    sourceMode: "fixture",
    homeScenario: name,
    simulation: null,
    simulationRemaining: 0,
  });
}

// ── DEV simulation control (FE-2.5). The store never imports the simulation
//    module — the DEV preview panel (or a test) constructs the source and hands
//    it in, so production builds carry no simulation code. ───────────────────

export function activateSimulation(name: SimScenarioName, sim: SteppableSource): void {
  teardownBridge();
  activeSim = sim;
  switchSource(sim);
  // Fresh preview stream: clear the active run so scripted revisions never fight
  // the previously displayed fixture. Recent activity is kept for context.
  setState({
    ...state,
    run: null,
    note: "",
    noteId: state.noteId + 1,
    connection: "connected",
    sourceMode: "fixture",
    simulation: name,
    simulationRemaining: sim.remaining(),
  });
}

export function stepSimulation(): void {
  if (!activeSim) return;
  activeSim.step();
  setState({ ...state, simulationRemaining: activeSim.remaining() });
}

export function stopSimulation(): void {
  if (!activeSim) return;
  activeSim = null;
  fixtureSource = createFixtureSource(state.run);
  switchSource(fixtureSource);
  setState({
    ...state,
    note: "",
    noteId: state.noteId + 1,
    connection: "connected",
    sourceMode: "fixture",
    simulation: null,
    simulationRemaining: 0,
  });
}

/** Test-only: full reset to the initial demo state (fixture source, no sim, no bridge). */
export function resetOperationsStateForTests(): void {
  teardownBridge();
  activeSim = null;
  state = initialState();
  fixtureSource = createFixtureSource(state.run);
  switchSource(fixtureSource);
  commandCounter = 0;
  for (const listener of listeners) listener();
}
