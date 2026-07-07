import { afterEach, describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { BridgeServer } from "../../src/bridge/bridge-server";
import { FilePairingStore } from "../../src/bridge/pairing-store";
import { getLogSink, clearLogSink } from "../../src/log";
import { connect, readMessages } from "./helpers";

const APP = "http://localhost:5173";
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()!(); });

async function startServer() {
  const dir = mkdtempSync(join(tmpdir(), `bridge-priv-${randomUUID()}-`));
  const store = new FilePairingStore(join(dir, "pairings.json"), { now: () => Date.now() });
  const server = new BridgeServer({ store, allowedOrigins: [APP], agentVersion: "test", port: 0, autoApprovePairing: true });
  const { port } = await server.listen();
  cleanups.push(async () => { await server.close(); rmSync(dir, { recursive: true, force: true }); });
  return { server, port };
}

function post(port: number, path: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: APP, ...headers }, body: JSON.stringify(body),
  });
}

describe("bridge privacy / no-secret-leak", () => {
  it("never logs the pairing token, ticket, or confirmation code, and puts no secret in a URL", async () => {
    const { server, port } = await startServer();
    clearLogSink();

    const req = await (await post(port, "/bridge/pair/request", { workspaceLabel: "회사" })).json();
    const confirmationCode: string = req.confirmationCode;
    // confirmUrl must carry ONLY the short requestId — never a secret.
    expect(req.confirmUrl).toContain(req.requestId);
    expect(req.confirmUrl).not.toContain(confirmationCode);

    const token: string = (await (await post(port, "/bridge/pair/poll", { requestId: req.requestId })).json()).pairingToken;
    const ticket: string = (await (await post(port, "/bridge/ws-ticket", { clientProtocolVersion: 1 }, { Authorization: `Bearer ${token}` })).json()).ticket;
    expect(token).not.toContain(ticket);

    const up = await connect({ port, path: `/bridge/ws?ticket=${ticket}`, origin: APP });
    await readMessages(up.ws!, 2);
    server.events.browserOpen("ref0000000000aa", true);
    server.events.pendingUserAction("ref0000000000aa", "complete_manual_login");
    up.ws?.close();

    const dump = JSON.stringify(getLogSink());
    expect(dump).not.toContain(token);
    expect(dump).not.toContain(ticket);
    expect(dump).not.toContain(confirmationCode);
    // No forbidden-content in any log meta.
    for (const forbidden of ["password", "cookie", "authorization", "secret", "credential"]) {
      expect(dump.toLowerCase()).not.toContain(`"${forbidden}"`);
    }
  });

  it("emits sanitized event payloads with only safe scalar fields", async () => {
    const { server, port } = await startServer();
    const req = await (await post(port, "/bridge/pair/request", { workspaceLabel: "w" })).json();
    const token = (await (await post(port, "/bridge/pair/poll", { requestId: req.requestId })).json()).pairingToken;
    const ticket = (await (await post(port, "/bridge/ws-ticket", { clientProtocolVersion: 1 }, { Authorization: `Bearer ${token}` })).json()).ticket;
    const up = await connect({ port, path: `/bridge/ws?ticket=${ticket}`, origin: APP });
    await readMessages(up.ws!, 2);
    server.events.collectionProgress("ref0000000000bb", "in_progress");
    server.events.collectionResult("ref0000000000bb", "new_data");
    const [ev1, ev2] = await readMessages(up.ws!, 2);
    const serialized = JSON.stringify([ev1, ev2]).toLowerCase();
    for (const bad of ["url", "selector", "coord", "dom", "http", "://", "token", "cookie"]) {
      expect(serialized).not.toContain(bad);
    }
    up.ws?.close();
  });
});
