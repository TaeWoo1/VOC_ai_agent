import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  BRIDGE_ONLY_FLAG,
  bridgeOnlyRefusalMessage,
  resolveBridgeOnlyMode,
} from "../../src/cli/bridge-only-gate";
import { ACTION_WINDOW_IMPORT_FLAG, OTHER_CARRIER_FLAGS } from "../../src/cli/import-mode-gate";
import { decideRun, runBridgeOnlyBoot, shouldExitAfterBoot } from "../../src/cli/local-agent";

const DEV = { NODE_ENV: "test" } as NodeJS.ProcessEnv;

// ── the gate (pure) ────────────────────────────────────────────────────────────────────────────────
describe("resolveBridgeOnlyMode", () => {
  it("is closed by default and refuses to combine with --connections or any carrier", () => {
    expect(resolveBridgeOnlyMode([], DEV)).toEqual({ host: false, reason: "NOT_REQUESTED" });
    expect(resolveBridgeOnlyMode(["--connections", "c.json"], DEV)).toEqual({ host: false, reason: "NOT_REQUESTED" });
    expect(resolveBridgeOnlyMode([BRIDGE_ONLY_FLAG], DEV)).toEqual({ host: true });
    expect(resolveBridgeOnlyMode([BRIDGE_ONLY_FLAG, "--connections", "c.json"], DEV)).toEqual({
      host: false,
      reason: "CONNECTIONS_CONFLICT",
    });
    for (const carrier of [ACTION_WINDOW_IMPORT_FLAG, ...OTHER_CARRIER_FLAGS]) {
      expect(resolveBridgeOnlyMode([BRIDGE_ONLY_FLAG, carrier], DEV)).toEqual({ host: false, reason: "CARRIER_CONFLICT" });
    }
    // production does not change the answer: nothing live is opened by this mode.
    expect(resolveBridgeOnlyMode([BRIDGE_ONLY_FLAG], { NODE_ENV: "production" } as NodeJS.ProcessEnv)).toEqual({ host: true });
  });

  it("refusals are one operator line; NOT_REQUESTED is silent", () => {
    expect(bridgeOnlyRefusalMessage("NOT_REQUESTED")).toBeNull();
    expect(bridgeOnlyRefusalMessage("CONNECTIONS_CONFLICT")).toContain("--connections");
    expect(bridgeOnlyRefusalMessage("CARRIER_CONFLICT")).toContain("carrier");
  });
});

// ── the boot ───────────────────────────────────────────────────────────────────────────────────────
describe("runBridgeOnlyBoot", () => {
  const cleanups: Array<() => Promise<void> | void> = [];
  afterEach(async () => {
    while (cleanups.length) await cleanups.pop()!();
  });

  it("boots with no connections file, serves /bridge/health, launches nothing, and stays resident until a signal", async () => {
    const dir = mkdtempSync(join(tmpdir(), `bridge-only-${randomUUID()}-`));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const lines: string[] = [];
    const handlers: Record<string, () => void> = {};
    let exited = 0;
    // No marketplace env at all (no NAVER_*, no STORAGE_*, no approval flag) — the boot must not need any.
    const env = { NODE_ENV: "test" } as NodeJS.ProcessEnv;
    const handle = await runBridgeOnlyBoot([BRIDGE_ONLY_FLAG], env, {
      bridgeConfigOverride: { port: 0, pairingFile: join(dir, "pairings.json") },
      onSignal: (sig, h) => void (handlers[sig] = h),
      print: (l) => void lines.push(l),
      exit: () => void exited++,
    });
    cleanups.push(() => handle.shutdown());
    expect(handle.listen.ok).toBe(true);
    const port = (handle.listen as { ok: true; port: number }).port;

    const boot = JSON.parse(lines[0]!);
    expect(boot).toMatchObject({ mode: "BRIDGE_ONLY", ok: true, port, browserLaunched: false, marketplaceOpened: false });
    expect(boot.approvalPresenter).toBe("dev_tty_stderr");

    const health = await fetch(`http://127.0.0.1:${port}/bridge/health`, { headers: { Origin: "http://localhost:5173" } });
    expect(health.status).toBe(200);
    const body = (await health.json()) as Record<string, unknown>;
    expect(body).toHaveProperty("agentVersion");
    // The health answer is sanitized — no connections, no paths, no env.
    expect(JSON.stringify(body)).not.toMatch(/pairings\.json|NAVER|STORAGE/);

    // Both signals are registered; still resident before either fires.
    expect(Object.keys(handlers).sort()).toEqual(["SIGINT", "SIGTERM"]);
    let settled = false;
    void handle.stopped.then(() => (settled = true));
    await new Promise((r) => setTimeout(r, 20));
    expect(settled).toBe(false);

    // SIGTERM → idempotent shutdown → the bridge is torn down exactly once even on a double signal (process.exit
    // itself is harmlessly idempotent, so only the teardown count matters).
    handlers.SIGTERM!();
    handlers.SIGINT!();
    await handle.stopped;
    await new Promise((r) => setTimeout(r, 20));
    expect(exited).toBeGreaterThanOrEqual(1);
    const stoppedLine = JSON.stringify({ mode: "BRIDGE_ONLY", stopped: true });
    expect(lines.filter((l) => l === stoppedLine)).toHaveLength(1);
    expect(lines.at(-1)).toBe(stoppedLine);
    await expect(fetch(`http://127.0.0.1:${port}/bridge/health`)).rejects.toBeTruthy();
  });

  it("reuses an existing pairings file rather than starting a new pairing store", async () => {
    const dir = mkdtempSync(join(tmpdir(), `bridge-only-${randomUUID()}-`));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const pairingFile = join(dir, "pairings.json");
    // Same store format the connector boot writes; a bridge-only boot must read it, not replace it.
    writeFileSync(pairingFile, JSON.stringify({ version: 1, pairings: [] }));
    const handle = await runBridgeOnlyBoot([BRIDGE_ONLY_FLAG], DEV, {
      bridgeConfigOverride: { port: 0, pairingFile },
      onSignal: () => {},
      print: () => {},
      exit: () => {},
    });
    cleanups.push(() => handle.shutdown());
    expect(handle.listen.ok).toBe(true);
  });

  it("a bound port is a skipped listen (no resident process), never a second silent helper", async () => {
    const dir = mkdtempSync(join(tmpdir(), `bridge-only-${randomUUID()}-`));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const first = await runBridgeOnlyBoot([BRIDGE_ONLY_FLAG], DEV, {
      bridgeConfigOverride: { port: 0, pairingFile: join(dir, "a.json") },
      onSignal: () => {},
      print: () => {},
      exit: () => {},
    });
    cleanups.push(() => first.shutdown());
    const port = (first.listen as { ok: true; port: number }).port;
    const second = await runBridgeOnlyBoot([BRIDGE_ONLY_FLAG], DEV, {
      bridgeConfigOverride: { port, pairingFile: join(dir, "b.json") },
      onSignal: () => {},
      print: () => {},
      exit: () => {},
    });
    expect(second.listen).toEqual({ ok: false, skipped: true, reason: "already_running" });
  });
});

// ── the existing path is untouched ─────────────────────────────────────────────────────────────────
describe("--connections path regression", () => {
  it("decideRun still rejects an empty connections set, and an all-SKIPPED connector boot still exits", () => {
    expect(decideRun([], "[]", DEV)).toMatchObject({ mode: "PARSE_ERROR" });
    expect(shouldExitAfterBoot({ managedConnectionCount: 0, hostsBridgeCarrier: false })).toBe(true);
    // the new flag is invisible to decideRun — it never reaches it
    expect(decideRun([BRIDGE_ONLY_FLAG], "[]", DEV)).toMatchObject({ mode: "PARSE_ERROR" });
  });
});
