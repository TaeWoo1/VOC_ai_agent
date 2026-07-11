// FE-7 store-driving harness for page-level DOM integration tests.
//
// These helpers are thin seams over the REAL `operationsStore` singleton — page
// tests drive it through its public API (never a mocked store) and assert the
// rendered page, so they exercise the true store → `useSyncExternalStore` → render
// wiring. Connection state is not settable directly; it only flows through the
// active source, so a bridge world is adopted with a test-controlled source whose
// subscriber the test can `emit` into (the same pattern as `operationsStore.test.ts`).
import {
  adoptBridgeSource,
  getOperationsState,
  loadHomeScenario,
  loadRunScenario,
  resetOperationsStateForTests,
} from "../lib/actionWindow/operationsStore";
import type { ActionWindowRunView } from "../lib/actionWindow/contract";
import type { ScenarioName } from "../lib/actionWindow/fixtures";
import type { HomeScenarioName } from "../lib/actionWindow/homeFixtures";
import type {
  ActionWindowSource,
  SourceConnection,
  SourceUpdate,
} from "../lib/actionWindow/source";

export { getOperationsState };
export type { SourceUpdate, SourceConnection };

/** A source whose single subscriber the test captures, so it can push frames
 *  (view / connection) into the store on demand. */
export function controllableSource(): {
  source: ActionWindowSource;
  emit: (u: SourceUpdate) => void;
} {
  let listener: (u: SourceUpdate) => void = () => {};
  return {
    source: {
      subscribe: (next) => {
        listener = next;
        return () => {
          listener = () => {};
        };
      },
      dispatch: () => {},
      requestSnapshot: () => {},
    },
    emit: (u) => listener(u),
  };
}

/** Full store reset (+ tears down any adopted bridge). Call in `beforeEach`. */
export function resetOps(): void {
  resetOperationsStateForTests();
}

/** Seed the run-detail state from a fixture scenario (fixture source, connected). */
export function seedRun(name: ScenarioName): void {
  loadRunScenario(name);
}

/** Seed the home state from a fixture scenario (fixture source, connected). */
export function seedHome(name: HomeScenarioName): void {
  loadHomeScenario(name);
}

/** Adopt a bridge world (sourceMode "bridge", connection "connected", run null) and
 *  return the `emit` for pushing view / connection frames — the only way to reach a
 *  non-connected banner AND make the pages pass a defined `onReconnect`. */
export function seedBridge(): (u: SourceUpdate) => void {
  const { source, emit } = controllableSource();
  adoptBridgeSource(source, () => {});
  return emit;
}

/** Bridge world reporting a terminal-less connection state, with no run bound. */
export function seedConnection(connection: SourceConnection): void {
  seedBridge()({ kind: "connection", connection });
}

/** Bridge world holding a last-known run view, then reporting `connection` — the
 *  realistic "offline/reconnecting but the last view stays visible" shape used to
 *  prove the pages suppress commands yet keep the timeline. */
export function seedBridgeRun(run: ActionWindowRunView, connection: SourceConnection): void {
  const emit = seedBridge();
  emit({ kind: "view", sequence: 1, run });
  emit({ kind: "connection", connection });
}
