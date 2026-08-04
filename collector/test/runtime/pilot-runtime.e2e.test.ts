/**
 * **Pilot runtime — repeated-use E2E (offline, real filesystem).**
 *
 * Exercises the lifecycle a pilot seller actually lives through, against a REAL temp data root, with no
 * browser and no backend. It covers the runtime half of the 8 acceptance scenarios that are testable without
 * a live NAVER session (the browser/login half is the on-device check the operator runs):
 *
 *   #2 agent restart → session files survive           #3 reboot/crash → recover + reuse
 *   #7 account slots isolated (profile dirs distinct)   #8 shutdown never touches non-owned processes
 *   + duplicate-agent prevention, and update preserves the data root.
 */
import { afterEach, describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquirePilotRuntime } from "../../src/runtime/runtime-supervisor";
import { accountScopedProfileDirFor } from "../../src/profile";
import type { ProcessKiller } from "../../src/runtime/owned-process-registry";
import { planUpdate } from "../../src/runtime/packaging-plan";

const roots: string[] = [];
const prevProfileBase = process.env.COLLECTOR_PROFILE_BASE_DIR;
function freshDataRoot(): string {
  const d = mkdtempSync(join(tmpdir(), "sellerops-e2e-"));
  roots.push(d);
  return d;
}
afterEach(() => {
  for (const d of roots.splice(0)) rmSync(d, { recursive: true, force: true });
  // Restore the global profile-base env the real boot mutates (resolveProfileDir reads process.env).
  if (prevProfileBase === undefined) delete process.env.COLLECTOR_PROFILE_BASE_DIR;
  else process.env.COLLECTOR_PROFILE_BASE_DIR = prevProfileBase;
});

const countingKiller = (): ProcessKiller & { killed: number[] } => {
  const killed: number[] = [];
  return {
    killed,
    terminate(record) {
      killed.push(record.pid);
      return "signaled";
    },
  };
};

/** A run acquires the runtime, writes some durable state, then releases — like one session of the agent. */
function bootOnce(dataRoot: string, killer: ProcessKiller) {
  const env: NodeJS.ProcessEnv = { SELLEROPS_AGENT_DATA_DIR: dataRoot };
  const res = acquirePilotRuntime({ env, platform: "linux", homedir: "/home/seller", agentVersion: "1.0.0", killer });
  if (!res.ok) throw new Error("expected acquisition to succeed");
  // Mirror the real boot (which passes process.env): make the relocated profile base visible to
  // resolveProfileDir, which reads process.env at call time.
  process.env.COLLECTOR_PROFILE_BASE_DIR = env.COLLECTOR_PROFILE_BASE_DIR;
  return { runtime: res.runtime, env };
}

describe("pilot runtime E2E — repeated use across restarts", () => {
  it("#2 restart reuses the durable data root: pairing + profile survive a release/re-acquire", () => {
    const dataRoot = freshDataRoot();

    // First boot: pair (write the pairing store) and log in (create the account profile dir).
    const first = bootOnce(dataRoot, countingKiller());
    const pairingFile = first.runtime.paths.pairingFile;
    writeFileSync(pairingFile, JSON.stringify({ pairings: [{ pairingId: "p1" }] }));
    const profileBase = first.env.COLLECTOR_PROFILE_BASE_DIR!;
    const profileDir = accountScopedProfileDirFor(profileBase, "naver", "aabbccddeeff00112233abcd");
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(join(profileDir, "Cookies"), "fake-session-cookie");
    first.runtime.releaseLock();

    // Second boot (a fresh process would): the lock is free, and the pairing + login are STILL there.
    const second = bootOnce(dataRoot, countingKiller());
    expect(second.runtime.lockRecovered).toBe(false); // clean restart, not a crash
    expect(readFileSync(pairingFile, "utf8")).toContain("p1");
    expect(existsSync(join(profileDir, "Cookies"))).toBe(true);
    second.runtime.releaseLock();
  });

  it("prevents a duplicate agent: a second acquire while one holds the lock is refused", () => {
    const dataRoot = freshDataRoot();
    const held = bootOnce(dataRoot, countingKiller()); // lock names THIS (live) process
    const env2: NodeJS.ProcessEnv = { SELLEROPS_AGENT_DATA_DIR: dataRoot };
    // A second agent is a DIFFERENT process — give it a distinct pid so the (live) holder is "not us".
    const second = acquirePilotRuntime({
      env: env2,
      platform: "linux",
      homedir: "/home/seller",
      agentVersion: "1.0.0",
      pid: 999001,
      killer: countingKiller(),
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.holderPid).toBe(process.pid); // the live first agent
    held.runtime.releaseLock();
  });

  it("#3 crash recovery: a dead holder's lock is taken over and its recorded orphans are reaped by pid", () => {
    const dataRoot = freshDataRoot();
    const runDir = join(dataRoot, "run");
    mkdirSync(runDir, { recursive: true });
    // Simulate a crashed prior run: a lock naming a dead pid + an owned-processes file listing orphan pids.
    writeFileSync(
      join(runDir, "agent.lock"),
      JSON.stringify({ pid: 2 ** 30, pgid: 2 ** 30, startedAt: "", agentVersion: "0.9.0" }),
    );
    // One orphan is STILL alive (use this test process's pid — the injected killer never really kills it),
    // one is already dead. Reaping is liveness-gated: only the live orphan is signalled, by EXACT pid.
    const deadPid = 2 ** 30;
    writeFileSync(
      join(runDir, "owned-processes.json"),
      JSON.stringify([
        { pid: process.pid, pgid: process.pid, kind: "browser", startedAt: "" },
        { pid: deadPid, pgid: deadPid, kind: "helper", startedAt: "" },
      ]),
    );
    const killer = countingKiller();
    const res = acquirePilotRuntime({
      env: { SELLEROPS_AGENT_DATA_DIR: dataRoot },
      platform: "linux",
      homedir: "/home/seller",
      agentVersion: "1.0.0",
      killer,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.runtime.lockRecovered).toBe(true);
      // Only the live orphan was reaped — by exact pid, never a pattern; the dead one was skipped.
      expect(killer.killed).toEqual([process.pid]);
      res.runtime.releaseLock();
    }
  });

  it("#8 shutdown terminates ONLY owned, still-alive processes (no name/pattern kill)", () => {
    const dataRoot = freshDataRoot();
    const killer = countingKiller();
    const { runtime } = bootOnce(dataRoot, killer);
    // One live owned pid (this test process — the injected killer never really kills it) and one dead.
    runtime.ownedProcesses.register(process.pid, { kind: "browser" });
    runtime.ownedProcesses.register(2 ** 30, { kind: "helper" });
    runtime.ownedProcesses.terminateAll("force");
    // Exactly the live one we recorded — by exact pid, never a pattern; the dead one is skipped, and the
    // seller's own Chrome (never registered) is untouchable.
    expect(killer.killed).toEqual([process.pid]);
    runtime.releaseLock();
  });

  it("#7 two account slots resolve to distinct, isolated profile dirs (cookies never mix)", () => {
    const dataRoot = freshDataRoot();
    const { env } = bootOnce(dataRoot, countingKiller());
    const base = env.COLLECTOR_PROFILE_BASE_DIR!;
    const a = accountScopedProfileDirFor(base, "naver", "aaaaaaaaaaaaaaaaaaaaaaaa");
    const b = accountScopedProfileDirFor(base, "naver", "bbbbbbbbbbbbbbbbbbbbbbbb");
    expect(a).not.toBe(b);
    expect(a.startsWith(base)).toBe(true);
    expect(b.startsWith(base)).toBe(true);
  });

  it("an update preserves the data root by construction (safe plan)", () => {
    const dataRoot = freshDataRoot();
    bootOnce(dataRoot, countingKiller()).runtime.releaseLock();
    // With an explicit data dir, the install root resolves elsewhere; the update is provably safe.
    const plan = planUpdate({ platform: "linux", env: { SELLEROPS_AGENT_DATA_DIR: dataRoot }, homedir: "/home/seller" });
    expect(plan.preserve).toBe(dataRoot);
    expect(plan.safe).toBe(true);
  });
});
