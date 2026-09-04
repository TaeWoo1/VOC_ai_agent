import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { BridgeServer, type DeviceLinkEndpoint } from "../../src/bridge/bridge-server";
import { FilePairingStore } from "../../src/bridge/pairing-store";
import { fakeApprovalPresenter } from "./helpers";

const APP = "http://localhost:5173";
const cleanups: Array<() => Promise<void>> = [];
const approval = fakeApprovalPresenter();
afterEach(async () => { while (cleanups.length) await cleanups.pop()!(); });

async function startServer(deviceLink?: DeviceLinkEndpoint) {
  const dir = mkdtempSync(join(tmpdir(), `bridge-dl-${randomUUID()}-`));
  const store = new FilePairingStore(join(dir, "pairings.json"), { now: () => Date.now() });
  const server = new BridgeServer({ store, allowedOrigins: [APP], agentVersion: "t", port: 0, approvalPresenter: approval.presenter, ...(deviceLink ? { deviceLink } : {}) });
  const { port } = await server.listen();
  cleanups.push(async () => { await server.close(); rmSync(dir, { recursive: true, force: true }); });
  return port;
}
function call(port: number, method: string, path: string, headers: Record<string, string> = {}) {
  return fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { "Content-Type": "application/json", Origin: APP, ...headers }, body: method === "POST" ? "{}" : undefined });
}
async function pairToken(port: number): Promise<string> {
  const req = await (await call(port, "POST", "/bridge/pair/request")).json();
  await fetch(`http://127.0.0.1:${port}/bridge/pair/confirm`, { method: "POST", headers: { "Content-Type": "application/json", Origin: `http://127.0.0.1:${port}` }, body: JSON.stringify({ requestId: req.requestId, decision: "allow", approvalCode: approval.lastCode() }) });
  const poll = await (await call(port, "POST", "/bridge/pair/poll")).json().catch(() => null);
  if (poll?.pairingToken) return poll.pairingToken;
  const p2 = await (await fetch(`http://127.0.0.1:${port}/bridge/pair/poll`, { method: "POST", headers: { "Content-Type": "application/json", Origin: APP }, body: JSON.stringify({ requestId: req.requestId }) })).json();
  return p2.pairingToken as string;
}

describe("bridge device-link routes", () => {
  it("are 404 when the helper has no link endpoint", async () => {
    const port = await startServer();
    expect((await call(port, "POST", "/bridge/device/link")).status).toBe(404);
    expect((await call(port, "GET", "/bridge/device/status")).status).toBe(404);
  });

  it("require the pairing bearer and an allowed origin — the pairing is the trust root", async () => {
    let starts = 0;
    const port = await startServer({ start: async () => { starts++; return { ok: true, userCode: "BCDFGHJK" }; }, status: async () => ({ linked: false }) });
    expect((await call(port, "POST", "/bridge/device/link")).status).toBe(401);
    expect((await call(port, "GET", "/bridge/device/status")).status).toBe(401);
    expect((await call(port, "POST", "/bridge/device/link", { Origin: "http://evil.example.invalid" })).status).toBe(403);
    expect(starts).toBe(0);
    const token = await pairToken(port);
    const started = await call(port, "POST", "/bridge/device/link", { Authorization: `Bearer ${token}` });
    expect(started.status).toBe(200);
    expect(await started.json()).toEqual({ ok: true, userCode: "BCDFGHJK" });
    const status = await call(port, "GET", "/bridge/device/status", { Authorization: `Bearer ${token}` });
    expect(await status.json()).toEqual({ linked: false });
    expect(starts).toBe(1);
  });
});
