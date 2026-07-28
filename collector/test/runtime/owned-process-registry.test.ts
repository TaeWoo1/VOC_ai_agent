import { describe, it, expect } from "vitest";
import {
  OwnedProcessRegistry,
  parseRegistry,
  posixProcessKiller,
  type OwnedProcessRecord,
  type ProcessKiller,
  type RegistryStore,
  type TerminateMode,
  type TerminateOutcome,
} from "../../src/runtime/owned-process-registry";

function memStore(initial: string | null = null): RegistryStore {
  let current = initial;
  return {
    read: () => current,
    write: (c) => {
      current = c;
    },
    remove: () => {
      current = null;
    },
  };
}

interface RecordingKiller extends ProcessKiller {
  readonly killed: Array<{ pid: number; mode: TerminateMode }>;
  result: (pid: number) => TerminateOutcome;
}

function recordingKiller(): RecordingKiller {
  const killed: Array<{ pid: number; mode: TerminateMode }> = [];
  const self: RecordingKiller = {
    killed,
    result: () => "signaled",
    terminate(record: OwnedProcessRecord, mode: TerminateMode) {
      killed.push({ pid: record.pid, mode });
      return self.result(record.pid);
    },
  };
  return self;
}

const at = () => "2026-07-28T00:00:00.000Z";

describe("OwnedProcessRegistry — terminate only what we own", () => {
  it("registers and persists owned processes", () => {
    const store = memStore();
    const reg = new OwnedProcessRegistry(store, recordingKiller(), at, () => true);
    reg.register(1000, { pgid: 1000, kind: "browser" });
    reg.register(1001, { kind: "helper" });
    expect(reg.snapshot().map((r) => r.pid).sort()).toEqual([1000, 1001]);
    // Persisted, so a crash leaves a readable record.
    expect(parseRegistry(store.read()).length).toBe(2);
  });

  it("terminateAll kills exactly the registered pids (by number, never a pattern) and clears the file", () => {
    const store = memStore();
    const killer = recordingKiller();
    const reg = new OwnedProcessRegistry(store, killer, at, () => true);
    reg.register(1000);
    reg.register(1001);
    const tally = reg.terminateAll("graceful");
    expect(killer.killed.map((k) => k.pid).sort()).toEqual([1000, 1001]);
    expect(killer.killed.every((k) => k.mode === "graceful")).toBe(true);
    expect(tally.signaled).toBe(2);
    // No longer owned — set and file cleared.
    expect(reg.snapshot()).toEqual([]);
    expect(store.read()).toBeNull();
  });

  it("deregister forgets a cleanly-closed process so it is never signalled", () => {
    const store = memStore();
    const killer = recordingKiller();
    const reg = new OwnedProcessRegistry(store, killer, at, () => true);
    reg.register(1000);
    reg.register(1001);
    reg.deregister(1000);
    reg.terminateAll();
    expect(killer.killed.map((k) => k.pid)).toEqual([1001]);
  });

  it("reapRecords kills an external (crashed prior run's) record set without owning it", () => {
    const store = memStore();
    const killer = recordingKiller();
    const reg = new OwnedProcessRegistry(store, killer, at, () => true);
    const orphans: OwnedProcessRecord[] = [
      { pid: 5000, pgid: 5000, kind: "browser", startedAt: at() },
      { pid: 5001, pgid: 5001, kind: "helper", startedAt: at() },
    ];
    const tally = reg.reapRecords(orphans, "force");
    expect(killer.killed.map((k) => k.pid).sort()).toEqual([5000, 5001]);
    expect(killer.killed.every((k) => k.mode === "force")).toBe(true);
    expect(tally.signaled).toBe(2);
    // The reaper never took ownership of a run it did not start.
    expect(reg.snapshot()).toEqual([]);
  });

  it("tallies not_found / error outcomes without throwing", () => {
    const store = memStore();
    const killer = recordingKiller();
    killer.result = (pid) => (pid === 1000 ? "not_found" : pid === 1001 ? "error" : "signaled");
    const reg = new OwnedProcessRegistry(store, killer, at, () => true);
    reg.register(1000);
    reg.register(1001);
    reg.register(1002);
    const tally = reg.terminateAll();
    expect(tally).toEqual({ signaled: 1, not_found: 1, error: 1 });
  });

  it("rehydrates owned processes from a persisted file on construction", () => {
    const persisted = JSON.stringify([{ pid: 9000, pgid: 9000, kind: "browser", startedAt: at() }]);
    const reg = new OwnedProcessRegistry(memStore(persisted), recordingKiller(), at, () => true);
    expect(reg.snapshot().map((r) => r.pid)).toEqual([9000]);
  });

  it("liveness-gates reaping: a recorded pid that is no longer alive is skipped, never signalled", () => {
    const store = memStore();
    const killer = recordingKiller();
    // 4242 is alive, 4243 is dead → only the live one is signalled (bounds PID reuse).
    const reg = new OwnedProcessRegistry(store, killer, at, (pid) => pid === 4242);
    reg.register(4242);
    reg.register(4243);
    const tally = reg.terminateAll("force");
    expect(killer.killed.map((k) => k.pid)).toEqual([4242]);
    expect(tally).toEqual({ signaled: 1, not_found: 1, error: 0 });
  });
});

describe("parseRegistry", () => {
  it("returns [] for absent/corrupt/non-array input", () => {
    expect(parseRegistry(null)).toEqual([]);
    expect(parseRegistry("nonsense")).toEqual([]);
    expect(parseRegistry('{"pid":1}')).toEqual([]); // not an array
  });

  it("drops entries without a numeric pid and defaults pgid/kind", () => {
    const parsed = parseRegistry(JSON.stringify([{ pid: 1 }, { pgid: 2 }, { pid: "x" }]));
    expect(parsed).toEqual([{ pid: 1, pgid: 1, kind: "browser", startedAt: "" }]);
  });
});

describe("posixProcessKiller", () => {
  it("reports not_found for a pid that does not exist (exact number, no pattern)", () => {
    const killer = posixProcessKiller();
    // An almost-certainly-dead pid; process.kill throws ESRCH → not_found.
    const outcome = killer.terminate({ pid: 2 ** 30, pgid: 2 ** 30, kind: "helper", startedAt: at() }, "graceful");
    expect(["not_found", "error"]).toContain(outcome);
  });
});
