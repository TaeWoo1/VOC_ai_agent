// Default ActionWindowSource: wraps the FE-1 fixtures/mock adapter. Preserves all
// FE-1/FE-2 behavior — deterministic transitions, no transport, always connected.
// Runtime semantics stay in `applyCommand`; this file only frames its results as
// SourceUpdate messages for the store.

import type { ActionWindowRunView } from "./contract";
import { applyCommand } from "./mockAdapter";
import { isTerminalRunStatus } from "./homeFixtures";
import type { ActionWindowSource, SourceCommand, SourceUpdate } from "./source";

export interface FixtureSource extends ActionWindowSource {
  /** DEV preview hook: align the source's internal run with a loaded fixture. */
  setRun(run: ActionWindowRunView | null): void;
}

export function createFixtureSource(initialRun: ActionWindowRunView | null): FixtureSource {
  let run = initialRun;
  let sequence = 0;
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
      // UI-only idle affordance: starting over a terminal run first clears it —
      // never a bypass of `allowedCommands` on a live run.
      const effective =
        command.type === "START_RUN" && run !== null && isTerminalRunStatus(run.status)
          ? null
          : run;
      const result = applyCommand(effective, command.type);
      if (!result.applied) {
        emit({ kind: "command-rejected", commandId: command.commandId, reason: "not-allowed" });
        return;
      }
      run = result.run;
      emit({ kind: "view", sequence: ++sequence, run, note: result.note });
    },
    requestSnapshot() {
      emit({ kind: "snapshot", sequence: ++sequence, run });
    },
    setRun(next) {
      run = next;
    },
  };
}
