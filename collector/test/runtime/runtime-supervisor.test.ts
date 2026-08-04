import { afterEach, describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  acquirePilotRuntime,
  applyPilotDataRootEnv,
  browserChannelAvailable,
  isPilotMode,
  AGENT_LOCK_FILE,
} from "../../src/runtime/runtime-supervisor";
import { runtimePathsFrom } from "../../src/runtime/runtime-paths";
import { parseLockRecord, type LockAdapter } from "../../src/runtime/single-instance-lock";
import type { ProcessKiller } from "../../src/runtime/owned-process-registry";

describe("isPilotMode", () => {
  it("engages in production or with SELLEROPS_PILOT_RUNTIME", () => {
    expect(isPilotMode({ NODE_ENV: "production" })).toBe(true);
    expect(isPilotMode({ SELLEROPS_PILOT_RUNTIME: "1" })).toBe(true);
    expect(isPilotMode({})).toBe(false);
    expect(isPilotMode({ SELLEROPS_PILOT_RUNTIME: "0" })).toBe(false);
  });
});

describe("applyPilotDataRootEnv", () => {
  it("relocates profile/download/status/pairing onto the data root, without overriding explicit values", () => {
    const paths = runtimePathsFrom("/data/root", "linux");
    const env: NodeJS.ProcessEnv = { COLLECTOR_PROFILE_DIR: "/explicit/naver" };
    applyPilotDataRootEnv(env, paths);
    expect(env.COLLECTOR_PROFILE_BASE_DIR).toBe(paths.profilesDir);
    expect(env.COLLECTOR_PROFILE_DIR).toBe("/explicit/naver"); // explicit wins
    expect(env.COLLECTOR_DOWNLOAD_DIR).toBe(paths.downloadsDir);
    expect(env.SELLEROPS_BRIDGE_PAIRING_FILE).toBe(paths.pairingFile);
  });
});

describe("browserChannelAvailable", () => {
  it("bundled Chromium (no channel) is always available", () => {
    expect(browserChannelAvailable(undefined, "win32", () => false)).toBe(true);
    expect(browserChannelAvailable("", "win32", () => false)).toBe(true);
  });

  it("a configured Chrome channel requires the install to exist", () => {
    expect(browserChannelAvailable("chrome", "win32", () => true)).toBe(true);
    expect(browserChannelAvailable("chrome", "win32", () => false)).toBe(false);
  });

  it("an unknown platform with a channel does not false-alarm", () => {
    expect(browserChannelAvailable("chrome", "sunos", () => false)).toBe(true);
  });
});

describe("acquirePilotRuntime", () => {
  function memLockAdapter(initial: string | null, live: number[]): LockAdapter {
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
  const noopKiller: ProcessKiller & { calls: number } = {
    calls: 0,
    terminate() {
      this.calls += 1;
      return "signaled";
    },
  };

  // A real temp data root, so `ensureDataDirs` actually creates directories (and `isDirWritable` is true).
  const roots: string[] = [];
  const dataRoot = (): string => {
    const d = mkdtempSync(join(tmpdir(), "sellerops-pilot-"));
    roots.push(d);
    return d;
  };
  afterEach(() => {
    for (const d of roots.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const baseEnv = (): NodeJS.ProcessEnv => ({ SELLEROPS_AGENT_DATA_DIR: dataRoot() });

  it("acquires the lock and relocates the env when no holder exists", () => {
    const env = baseEnv();
    const res = acquirePilotRuntime({
      env,
      platform: "linux",
      homedir: "/home/seller",
      agentVersion: "1.0.0",
      pid: 100,
      lockAdapter: memLockAdapter(null, []),
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.runtime.lockRecovered).toBe(false);
      expect(res.runtime.paths.dataRoot).toBe(env.SELLEROPS_AGENT_DATA_DIR);
      expect(env.COLLECTOR_PROFILE_BASE_DIR).toBe(res.runtime.paths.profilesDir);
    }
  });

  it("refuses when a live holder exists (duplicate prevention)", () => {
    const holder = JSON.stringify({ pid: 200, pgid: 200, startedAt: "", agentVersion: "1.0.0" });
    const res = acquirePilotRuntime({
      env: baseEnv(),
      platform: "linux",
      homedir: "/home/seller",
      agentVersion: "1.0.0",
      pid: 100,
      lockAdapter: memLockAdapter(holder, [200]),
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.holderPid).toBe(200);
  });

  it("takes over a dead holder and reaps its recorded orphans (crash recovery)", () => {
    const holder = JSON.stringify({ pid: 200, pgid: 200, startedAt: "", agentVersion: "0.9.0" });
    const killer: ProcessKiller & { killed: number[] } = {
      killed: [],
      terminate(record) {
        this.killed.push(record.pid);
        return "signaled";
      },
    };
    // The dead run's owned-process file — but our mem lock adapter is separate from the registry store, so
    // the registry reads a real (empty) file; recovery still runs and returns a zero tally. We assert the
    // recovered flag + that acquisition proceeded.
    const res = acquirePilotRuntime({
      env: baseEnv(),
      platform: "linux",
      homedir: "/home/seller",
      agentVersion: "1.0.0",
      pid: 100,
      lockAdapter: memLockAdapter(holder, []), // pid 200 not alive → stale → takeover
      killer,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.runtime.lockRecovered).toBe(true);
      expect(res.runtime.reapTally).not.toBeNull();
    }
  });

  it("writes our identity into the lock via the adapter", () => {
    let stored: string | null = null;
    const adapter: LockAdapter = {
      readFile: () => stored,
      writeFile: (_p, c) => {
        stored = c;
      },
      remove: () => {
        stored = null;
      },
      isAlive: () => false,
      now: () => "2026-07-28T00:00:00.000Z",
    };
    acquirePilotRuntime({
      env: baseEnv(),
      platform: "linux",
      homedir: "/home/seller",
      agentVersion: "1.2.3",
      pid: 4242,
      lockAdapter: adapter,
    });
    expect(parseLockRecord(stored)?.pid).toBe(4242);
    expect(parseLockRecord(stored)?.agentVersion).toBe("1.2.3");
  });
});

// Sanity: the lock file name is stable (packaging + docs reference it).
it("AGENT_LOCK_FILE is stable", () => {
  expect(AGENT_LOCK_FILE).toBe("agent.lock");
});
