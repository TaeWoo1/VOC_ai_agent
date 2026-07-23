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
import { COMMAND_REJECTED_COPY, CONNECTION_RETRY_FAILED_NOTE } from "./copy";
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
  /** FE-5 sanitized diagnostics: a timestamp-free trail of connection literals
   *  (oldest → newest), capped at `CONNECTION_TRAIL_LIMIT`, for the DEV-only
   *  live-bridge diagnostics panel. Reset whenever the world is replaced (adopt /
   *  fixture load / simulation / reset) so it reflects the current session only.
   *  Only ever holds the three `SourceConnection` literals — no timing, no ids. */
  connectionTrail: SourceConnection[];
  /** Count of actual connection transitions in the current session (dedup-safe:
   *  a repeated same-state frame does not bump it). Sanitized integer. */
  connectionChangeCount: number;
  /** A manual live-Bridge reconnect (FE-4) is in flight — disables the offline
   *  banner's reconnect button so it can't be double-fired. UI-only; NOT a
   *  fourth `SourceConnection` literal (those stay the stable three). */
  retryPending: boolean;
  /** FE-5 diagnostics (reactive): whether a live-Bridge boot has been attempted this
   *  session. Mirrors `bridgeSource`'s boot guard into the store so the DEV panel
   *  RE-RENDERS when it flips — even on the fixture-fallback path, which otherwise
   *  changes no store field and would leave the panel showing a stale "아니오". */
  bootAttempted: boolean;
  /**
   * Why the last live-bridge boot was refused, or null when it succeeded / was never attempted.
   * DEV diagnostics only — a sanitized enum plus, for a carrier mismatch, which carrier the agent
   * announced. Never a message, status code, origin or token.
   */
  bridgeRefusal: { reason: string; announcedCarrier?: string } | null;
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

/** How many recent connection literals the diagnostics trail retains. */
const CONNECTION_TRAIL_LIMIT = 6;

/** The diagnostics fields reset to a fresh, connected session (no transitions
 *  yet). Used at every point the world is replaced. */
function freshConnectionDiagnostics(): Pick<
  OperationsState,
  "connection" | "connectionTrail" | "connectionChangeCount"
> {
  return { connection: "connected", connectionTrail: ["connected"], connectionChangeCount: 0 };
}

function initialState(): OperationsState {
  const view = HOME_SCENARIOS[INITIAL_HOME].view;
  return {
    run: view.activeRun,
    recentRuns: view.recentRuns,
    note: "",
    noteId: 0,
    ...freshConnectionDiagnostics(),
    retryPending: false,
    bootAttempted: false,
    bridgeRefusal: null,
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
      const changed = update.connection !== state.connection;
      setState({
        ...state,
        connection: update.connection,
        // Record the transition for the FE-5 diagnostics trail only when the state
        // actually changes (a repeated same-state frame is not a transition).
        ...(changed
          ? {
              connectionTrail: [...state.connectionTrail, update.connection].slice(
                -CONNECTION_TRAIL_LIMIT,
              ),
              connectionChangeCount: state.connectionChangeCount + 1,
            }
          : {}),
      });
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
    ...freshConnectionDiagnostics(),
    retryPending: false,
    sourceMode: "bridge",
    simulation: null,
    simulationRemaining: 0,
  };
  bridgeCleanup = cleanup;
  switchSource(bridge);
  for (const listener of listeners) listener();
}

// ── Manual reconnect (FE-4) ──────────────────────────────────────────────────
//    The offline banner's reconnect action runs through the hook/page layer
//    (`useBridgeReconnect`), which owns the bridge import and calls
//    `retryBridgeBoot()`; the store only tracks the in-flight flag and the safe
//    outcome note, so it never imports the Bridge modules (architecture rule).

/** FE-5 diagnostics: record whether a live-Bridge boot has been attempted, as REACTIVE
 *  store state. `bridgeSource.connectBridgeIfEnabled` calls this so the DEV panel
 *  re-renders when the flag flips — the fixture-fallback path changes no other store
 *  field, so without this the panel would keep showing a stale "부트 시도됨 = 아니오". */
/** Record (or clear, with null) why the last live-bridge boot was refused. */
export function setBridgeRefusal(reason: string | null, announcedCarrier?: string): void {
  const next = reason == null ? null : announcedCarrier ? { reason, announcedCarrier } : { reason };
  if (state.bridgeRefusal?.reason === next?.reason
      && state.bridgeRefusal?.announcedCarrier === next?.announcedCarrier) {
    return;
  }
  setState({ ...state, bridgeRefusal: next });
}

export function setBridgeBootAttempted(value: boolean): void {
  if (state.bootAttempted === value) return;
  setState({ ...state, bootAttempted: value });
}

/** Mark a manual live-Bridge reconnect as in flight (disables the banner button). */
export function beginBridgeRetry(): void {
  setState({ ...state, retryPending: true });
}

/** Clear the in-flight flag when the attempt resolves. A successful attempt has
 *  already re-adopted a fresh bridge world via `adoptBridgeSource`; a failed one
 *  leaves the offline source in place and surfaces a safe note. */
export function endBridgeRetry(succeeded: boolean): void {
  if (succeeded) {
    setState({ ...state, retryPending: false });
    return;
  }
  setState({
    ...state,
    retryPending: false,
    note: CONNECTION_RETRY_FAILED_NOTE,
    noteId: state.noteId + 1,
  });
}

/** DEV-only escape hatch: leave a live/offline Bridge world and return to the
 *  fixture world without a page reload (the fixture scenario panel is hidden in
 *  bridge mode, so this is the way back). Reuses the existing fixture-load
 *  teardown path. */
export function returnToFixtureForDev(): void {
  loadHomeScenario(INITIAL_HOME);
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
    ...freshConnectionDiagnostics(),
    retryPending: false,
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
    ...freshConnectionDiagnostics(),
    retryPending: false,
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
    ...freshConnectionDiagnostics(),
    retryPending: false,
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
    ...freshConnectionDiagnostics(),
    retryPending: false,
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
