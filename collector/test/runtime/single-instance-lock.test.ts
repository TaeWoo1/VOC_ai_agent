import { describe, it, expect } from "vitest";
import {
  acquireSingleInstanceLock,
  decideLockOutcome,
  parseLockRecord,
  type LockAdapter,
  type LockRecord,
} from "../../src/runtime/single-instance-lock";

const rec = (pid: number, over: Partial<LockRecord> = {}): LockRecord => ({
  pid,
  pgid: pid,
  startedAt: "2026-07-28T00:00:00.000Z",
  agentVersion: "0.0.1-poc",
  ...over,
});

describe("decideLockOutcome — liveness, not time", () => {
  const alive = (live: number[]) => (pid: number) => live.includes(pid);

  it("no existing lock → ACQUIRE", () => {
    expect(decideLockOutcome(null, { pid: 100 }, alive([]))).toBe("ACQUIRE");
  });

  it("a live holder that is not us → ALREADY_RUNNING (duplicate prevention)", () => {
    expect(decideLockOutcome(rec(200), { pid: 100 }, alive([200]))).toBe("ALREADY_RUNNING");
  });

  it("a dead holder → STALE_TAKEOVER (crash recovery)", () => {
    expect(decideLockOutcome(rec(200), { pid: 100 }, alive([]))).toBe("STALE_TAKEOVER");
  });

  it("our own pid already in the file → ACQUIRE (re-entrant, never a conflict)", () => {
    expect(decideLockOutcome(rec(100), { pid: 100 }, alive([100]))).toBe("ACQUIRE");
  });
});

describe("parseLockRecord", () => {
  it("returns null for absent/blank/corrupt content (→ ACQUIRE)", () => {
    expect(parseLockRecord(null)).toBeNull();
    expect(parseLockRecord("")).toBeNull();
    expect(parseLockRecord("{not json")).toBeNull();
    expect(parseLockRecord("{}")).toBeNull(); // no pid
  });

  it("defaults pgid to pid when absent", () => {
    expect(parseLockRecord('{"pid":42}')?.pgid).toBe(42);
  });
});

describe("acquireSingleInstanceLock", () => {
  function fakeAdapter(initial: string | null, live: number[]): LockAdapter {
    let written = initial;
    return {
      readFile: () => written,
      writeFile: (_p, c) => {
        written = c;
      },
      remove: () => {
        written = null;
      },
      isAlive: (pid) => live.includes(pid),
      now: () => "2026-07-28T00:00:00.000Z",
    };
  }

  it("acquires a fresh lock and writes our record", () => {
    const a = fakeAdapter(null, []);
    const r = acquireSingleInstanceLock("/run/lock", { pid: 100, pgid: 100, agentVersion: "v" }, a);
    expect(r.acquired).toBe(true);
    if (r.acquired) {
      expect(r.recovered).toBe(false);
      expect(r.recoveredFrom).toBeNull();
    }
  });

  it("refuses when a live holder exists (no write), returning the holder pid", () => {
    const before = JSON.stringify(rec(200));
    const a = fakeAdapter(before, [200]);
    const r = acquireSingleInstanceLock("/run/lock", { pid: 100, pgid: 100, agentVersion: "v" }, a);
    expect(r.acquired).toBe(false);
    if (!r.acquired) expect(r.holderPid).toBe(200);
    // The live holder's record is left untouched.
    expect(a.readFile("/run/lock")).toBe(before);
  });

  it("takes over a dead holder's lock and reports what it recovered", () => {
    const a = fakeAdapter(JSON.stringify(rec(200, { pgid: 250 })), []); // pid 200 not alive
    const r = acquireSingleInstanceLock("/run/lock", { pid: 100, pgid: 100, agentVersion: "v" }, a);
    expect(r.acquired).toBe(true);
    if (r.acquired) {
      expect(r.recovered).toBe(true);
      expect(r.recoveredFrom?.pid).toBe(200);
      expect(r.recoveredFrom?.pgid).toBe(250); // the reaper needs the dead holder's process group
    }
  });
});
