// DEV-only simulated stream source (FE-2.5). Emits contract-valid run views
// (reused FE-1 fixtures) inside FE-owned SourceUpdate frames, including
// deliberate fault cases. These scenarios are UI RESILIENCE SIMULATIONS — what
// the FE must tolerate — NOT a specification of Runtime or Bridge behavior.
// Production UX never reaches this module: only the DEV-gated preview panel
// (and tests) create a simulated source, so the production build drops it.

import { isStaleCommand } from "./contract";
import { UI_SCENARIOS } from "./fixtures";
import type { SourceCommand, SourceUpdate, SteppableSource } from "./source";

export type SimScenarioName =
  | "sim-duplicate"
  | "sim-stale-view"
  | "sim-out-of-order"
  | "sim-snapshot-restore"
  | "sim-stale-command"
  | "sim-offline-reconnect";

export const SIM_SCENARIO_NAMES: readonly SimScenarioName[] = [
  "sim-duplicate",
  "sim-stale-view",
  "sim-out-of-order",
  "sim-snapshot-restore",
  "sim-stale-command",
  "sim-offline-reconnect",
];

interface SimScript {
  /** Updates emitted one per step(). */
  steps: SourceUpdate[];
  /** Snapshot emitted when the store requests one (sequence-gap recovery). */
  snapshotOnRequest?: SourceUpdate;
  /** Scripted reaction to a dispatched command (default: not-allowed rejection). */
  onDispatch?: (command: SourceCommand) => SourceUpdate[];
}

const run = (name: keyof typeof UI_SCENARIOS) => UI_SCENARIOS[name].run;

const SCRIPTS: Record<SimScenarioName, SimScript> = {
  // Same sequence delivered twice (second frame even carries different content) —
  // the store must keep the first and drop the replay.
  "sim-duplicate": {
    steps: [
      { kind: "view", sequence: 1, run: run("observing") },
      { kind: "view", sequence: 1, run: run("paused") },
      { kind: "view", sequence: 2, run: run("download-detected") },
    ],
  },
  // In-order frames, but frame 2 carries an older revision — the rendered view
  // must never regress.
  "sim-stale-view": {
    steps: [
      { kind: "view", sequence: 1, run: run("waiting-for-user") }, // revision 5
      { kind: "view", sequence: 2, run: run("human-action-required") }, // revision 4 (stale)
      { kind: "view", sequence: 3, run: run("observing") }, // revision 6
    ],
  },
  // Sequence gap (1 → 3): drop-until-snapshot policy — the store drops the gapped
  // frame, requests a snapshot, and the late frame 2 is discarded afterwards.
  "sim-out-of-order": {
    steps: [
      { kind: "view", sequence: 1, run: run("starting") },
      { kind: "view", sequence: 3, run: run("download-detected") },
      { kind: "view", sequence: 2, run: run("paused") }, // late arrival
    ],
    snapshotOnRequest: { kind: "snapshot", sequence: 4, run: run("processing") },
  },
  // A reconnect-style snapshot replaces the local view wholesale.
  "sim-snapshot-restore": {
    steps: [
      { kind: "view", sequence: 1, run: run("human-action-required") },
      { kind: "snapshot", sequence: 2, run: run("completed") },
    ],
  },
  // The source pretends its state moved on (revision 5) after the UI rendered
  // revision 4 — any command carrying the old revision is rejected as stale and
  // a corrected view follows. The step never completes locally.
  "sim-stale-command": {
    steps: [{ kind: "view", sequence: 1, run: run("human-action-required") }], // revision 4
    onDispatch: (command) =>
      isStaleCommand(command.expectedRevision ?? 0, 5)
        ? [
            { kind: "command-rejected", commandId: command.commandId, reason: "stale-revision" },
            { kind: "view", sequence: 2, run: run("waiting-for-user") }, // revision 5
          ]
        : [{ kind: "command-rejected", commandId: command.commandId, reason: "not-allowed" }],
  },
  // Transport loss → offline → reconnecting → snapshot restored on reconnect.
  "sim-offline-reconnect": {
    steps: [
      { kind: "view", sequence: 1, run: run("observing") },
      { kind: "connection", connection: "offline" },
      { kind: "connection", connection: "reconnecting" },
      { kind: "snapshot", sequence: 2, run: run("download-detected") },
      { kind: "connection", connection: "connected" },
    ],
  },
};

export function createSimulatedSource(name: SimScenarioName): SteppableSource {
  const script = SCRIPTS[name];
  let cursor = 0;
  let listener: ((update: SourceUpdate) => void) | null = null;

  function emit(update: SourceUpdate): void {
    listener?.(update);
  }

  return {
    subscribe(next) {
      listener = next;
      return () => {
        if (listener === next) listener = null;
      };
    },
    dispatch(command: SourceCommand) {
      const updates = script.onDispatch?.(command) ?? [
        { kind: "command-rejected", commandId: command.commandId, reason: "not-allowed" } as const,
      ];
      for (const update of updates) emit(update);
    },
    requestSnapshot() {
      if (script.snapshotOnRequest) emit(script.snapshotOnRequest);
    },
    step() {
      const update = script.steps[cursor];
      if (!update) return false;
      cursor += 1;
      emit(update);
      return true;
    },
    remaining() {
      return script.steps.length - cursor;
    },
  };
}
