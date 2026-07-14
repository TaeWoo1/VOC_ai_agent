import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  DEFAULT_BRIDGE_PORT,
  DEFAULT_CONTROL_PORT,
  resolveSyntheticUiHarnessConfig,
  startSyntheticUiHarness,
  type RunningSyntheticUiHarness,
  type SyntheticUiHarnessConfig,
} from "../../src/agent/synthetic-ui-harness";

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

function tempPairingFile(): string {
  const dir = mkdtempSync(join(tmpdir(), `aw-ui-harness-${randomUUID()}-`));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, "pairings.json");
}

describe("resolveSyntheticUiHarnessConfig", () => {
  const opts = { pairingFile: "/tmp/x/pairings.json", runId: "run_synthetic_test" };

  it("refuses to start under NODE_ENV=production", () => {
    const r = resolveSyntheticUiHarnessConfig({ NODE_ENV: "production" }, opts);
    expect(r).toEqual({ ok: false, error: "synthetic-ui-harness-refused-in-production" });
  });

  it("needs no connections/browser env — resolves from an empty env with the DEV defaults", () => {
    const r = resolveSyntheticUiHarnessConfig({}, opts);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect(r.config.bridgePort).toBe(DEFAULT_BRIDGE_PORT);
    expect(r.config.controlPort).toBe(DEFAULT_CONTROL_PORT);
    expect(r.config.channelCode).toBe("synthetic");
    expect(r.config.allowedOrigins).toContain("http://localhost:5173");
    expect(r.config.runId).toBe("run_synthetic_test");
  });

  it("honors BRIDGE_PORT / AW_UI_HARNESS_CONTROL_PORT overrides", () => {
    const r = resolveSyntheticUiHarnessConfig({ BRIDGE_PORT: "48000", AW_UI_HARNESS_CONTROL_PORT: "48001" }, opts);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect(r.config.bridgePort).toBe(48000);
    expect(r.config.controlPort).toBe(48001);
  });

  it("rejects an invalid or conflicting port", () => {
    expect(resolveSyntheticUiHarnessConfig({ BRIDGE_PORT: "0" }, opts)).toEqual({ ok: false, error: "invalid-bridge-port" });
    expect(resolveSyntheticUiHarnessConfig({ AW_UI_HARNESS_CONTROL_PORT: "999999" }, opts)).toEqual({ ok: false, error: "invalid-control-port" });
    expect(resolveSyntheticUiHarnessConfig({ BRIDGE_PORT: "47615", AW_UI_HARNESS_CONTROL_PORT: "47615" }, opts)).toEqual({
      ok: false,
      error: "control-port-conflicts-with-bridge-port",
    });
  });

  it("rejects an empty origin allow-list", () => {
    expect(resolveSyntheticUiHarnessConfig({ BRIDGE_ALLOWED_ORIGINS: "*" }, opts)).toEqual({ ok: false, error: "no-allowed-origins" });
  });
});

async function startForTest(runId = "run_synthetic_a"): Promise<RunningSyntheticUiHarness> {
  const config: SyntheticUiHarnessConfig = {
    bridgePort: 0,
    controlPort: 0,
    allowedOrigins: ["http://localhost:5173"],
    pairingFile: tempPairingFile(),
    runId,
    channelCode: "synthetic",
    now: () => Date.now(),
  };
  const harness = await startSyntheticUiHarness(config);
  cleanups.push(() => harness.close());
  return harness;
}

function control(port: number, path: string, method: "GET" | "POST", body?: unknown) {
  return fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    ...(body !== undefined ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
}

describe("synthetic UI harness — loopback control server", () => {
  it("reports sanitized status and hosts the configured synthetic run", async () => {
    const h = await startForTest("run_synthetic_status");
    const status = await (await control(h.controlPort, "/control/status", "GET")).json();
    expect(status).toEqual({ runId: "run_synthetic_status", announcing: true, attachedClients: 0 });
  });

  it("pauses and resumes announcing, and rehosts under an explicit run id", async () => {
    const h = await startForTest("run_synthetic_a");

    const paused = await (await control(h.controlPort, "/control/host", "POST", { up: false })).json();
    expect(paused).toEqual({ ok: true, runId: "run_synthetic_a", announcing: false });
    expect(h.endpoint.isAnnouncing()).toBe(false);

    const rehosted = await (await control(h.controlPort, "/control/host", "POST", { up: true, runId: "run_synthetic_b" })).json();
    expect(rehosted).toEqual({ ok: true, runId: "run_synthetic_b", announcing: true });
    expect(h.hostedRunId()).toBe("run_synthetic_b");
  });

  it("drops attached sockets (zero when none connected) and completes the user action", async () => {
    const h = await startForTest();
    const dropped = await (await control(h.controlPort, "/control/drop-socket", "POST")).json();
    expect(dropped).toEqual({ ok: true, dropped: 0 });

    const completed = await (await control(h.controlPort, "/control/complete-user-action", "POST")).json();
    expect(completed).toEqual({ ok: true, observed: true });
  });

  it("404s an unknown control path", async () => {
    const h = await startForTest();
    const res = await control(h.controlPort, "/control/nope", "POST");
    expect(res.status).toBe(404);
  });
});
