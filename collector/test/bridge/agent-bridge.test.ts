import { afterEach, describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createAgentBridge, type AgentBridge } from "../../src/agent/agent-bridge";
import { createLocalAgentConnectorStartup } from "../../src/agent/local-agent-connector-startup";
import { refFor } from "../../src/bridge/event-adapter";
import { connect, readMessages } from "./helpers";

const APP = "http://localhost:5173";
const SALT = "test-salt";
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()!(); });

async function startBridge(port = 0): Promise<{ bridge: AgentBridge; port: number }> {
  const dir = mkdtempSync(join(tmpdir(), `agent-bridge-${randomUUID()}-`));
  const bridge = createAgentBridge({
    port,
    allowedOrigins: [APP],
    pairingFile: join(dir, "pairings.json"),
    agentVersion: "test",
    refSalt: SALT,
    autoApprovePairing: true,
    now: () => Date.now(),
  });
  const r = await bridge.listen();
  cleanups.push(async () => { await bridge.close(); rmSync(dir, { recursive: true, force: true }); });
  return { bridge, port: r.ok ? r.port : port };
}

function post(port: number, path: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: APP, ...headers }, body: JSON.stringify(body),
  });
}

/** Auto-approve pairing (dev) → ticket, so a test can open an authenticated WS. */
async function ticketFor(port: number): Promise<string> {
  const req = await (await post(port, "/bridge/pair/request", { workspaceLabel: "t" })).json();
  const token = (await (await post(port, "/bridge/pair/poll", { requestId: req.requestId })).json()).pairingToken;
  return (await (await post(port, "/bridge/ws-ticket", { clientProtocolVersion: 1 }, { Authorization: `Bearer ${token}` })).json()).ticket;
}

describe("agent bridge integration", () => {
  it("seeds the real configured connections as opaque refs only (never the raw connectionId)", async () => {
    const { bridge, port } = await startBridge();
    bridge.seed(["store-account-raw-9"]);
    const up = await connect({ port, path: `/bridge/ws?ticket=${await ticketFor(port)}`, origin: APP });
    const msgs = await readMessages(up.ws!, 2);
    const snap = JSON.stringify(msgs[1]!);
    expect(snap).toContain(refFor("store-account-raw-9", SALT));
    expect(snap).not.toContain("store-account-raw-9");
    up.ws?.close();
  });

  it("feeds a REAL settled ConnectorOrchestrator result into the snapshot + events", async () => {
    const { bridge, port } = await startBridge();
    const up = await connect({ port, path: `/bridge/ws?ticket=${await ticketFor(port)}`, origin: APP });
    await readMessages(up.ws!, 2); // hello + (empty) snapshot

    // Boot a REAL startup with an all-SKIPPED config (Cafe24 = API, NOT_IMPLEMENTED → SKIPPED) through the
    // bridge observer — no browser launched, no live action.
    const startup = createLocalAgentConnectorStartup({}, bridge.observer);
    await startup.boot([{ connectionId: "c1", channel: "CAFE24", strategy: "API", browserConnection: null }]);

    const [event] = await readMessages(up.ws!, 1);
    expect(event).toMatchObject({ type: "event", category: "connection_lifecycle", ref: refFor("c1", SALT), payload: { state: "stopped" } });
    await startup.shutdown();
    up.ws?.close();
  });

  it("refuses a duplicate bridge on the same port (single instance)", async () => {
    const { port } = await startBridge();
    const dir = mkdtempSync(join(tmpdir(), `agent-bridge-dup-`));
    const dup = createAgentBridge({ port, allowedOrigins: [APP], pairingFile: join(dir, "p.json"), agentVersion: "t", refSalt: SALT });
    const r = await dup.listen();
    expect(r).toMatchObject({ ok: false, skipped: true, reason: "already_running" });
    expect(dup.active).toBe(false);
    await dup.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("a frontend socket closing does NOT stop the agent bridge", async () => {
    const { bridge, port } = await startBridge();
    const up = await connect({ port, path: `/bridge/ws?ticket=${await ticketFor(port)}`, origin: APP });
    await readMessages(up.ws!, 2);
    up.ws!.close(1000);
    // Bridge stays alive and serving after the tab closes.
    expect(bridge.active).toBe(true);
    const health = await fetch(`http://127.0.0.1:${port}/bridge/health`, { headers: { Origin: APP } });
    expect(health.status).toBe(200);
    const again = await connect({ port, path: `/bridge/ws?ticket=${await ticketFor(port)}`, origin: APP });
    expect(again.status).toBe(101);
    again.ws?.close();
  });

  it("close() shuts the bridge down (agent shutdown closes it)", async () => {
    const { bridge, port } = await startBridge();
    await bridge.close();
    expect(bridge.active).toBe(false);
    await expect(fetch(`http://127.0.0.1:${port}/bridge/health`, { headers: { Origin: APP } })).rejects.toThrow();
  });
});
