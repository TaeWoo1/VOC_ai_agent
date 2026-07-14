/**
 * G1 `/bridge/ws` heartbeat / dead-socket reaping (runtime hardening). `ws` answers pings but never probes
 * liveness itself, so a half-open peer (vanished with no close frame) would linger in `clients` forever. The
 * server-side heartbeat pings each status socket and terminates any that missed the previous pong.
 *
 * A dead peer is simulated with a REAL `ws` client constructed with the supported `autoPong: false` option
 * (via `connect(..., { autoPong: false })`) — it ignores server pings, so it never pongs. No private socket
 * internals are touched. All hermetic: loopback only, no browser/backend/credentials, injected `heartbeatMs`.
 */
import { afterEach, describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { BridgeServer } from "../../src/bridge/bridge-server";
import { FilePairingStore } from "../../src/bridge/pairing-store";
import { connect, readMessages } from "./helpers";

const APP = "http://localhost:5173";
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

async function startServer(heartbeatMs: number) {
  const dir = mkdtempSync(join(tmpdir(), `bridge-hb-${randomUUID()}-`));
  const store = new FilePairingStore(join(dir, "pairings.json"), { now: () => Date.now() });
  const server = new BridgeServer({ store, allowedOrigins: [APP], agentVersion: "test", port: 0, heartbeatMs });
  const { port } = await server.listen();
  cleanups.push(async () => { await server.close(); rmSync(dir, { recursive: true, force: true }); });
  return { server, port };
}

function post(port: number, path: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: APP, ...headers },
    body: JSON.stringify(body),
  });
}

/** Drive request→confirm→poll→ws-ticket and return a single-use WS ticket ready for the `/bridge/ws` handshake. */
async function freshTicket(port: number): Promise<string> {
  const req = await (await post(port, "/bridge/pair/request", { workspaceLabel: "테스트" })).json();
  await post(port, "/bridge/pair/confirm", { requestId: req.requestId, decision: "allow" }, { Origin: `http://127.0.0.1:${port}` });
  const poll = await (await post(port, "/bridge/pair/poll", { requestId: req.requestId })).json();
  const r = await (await post(port, "/bridge/ws-ticket", { clientProtocolVersion: 1 }, { Authorization: `Bearer ${poll.pairingToken}` })).json();
  return r.ticket as string;
}

async function connectPaired(port: number, autoPong?: boolean) {
  const ticket = await freshTicket(port);
  const res = await connect({ port, path: `/bridge/ws?ticket=${ticket}`, origin: APP, autoPong });
  expect(res.status).toBe(101);
  const ws = res.ws!;
  await readMessages(ws, 2); // consume the hello + snapshot the server sends on connect
  return ws;
}

async function waitFor(cond: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timeout");
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe("bridge heartbeat / dead-socket reaping", () => {
  it("reaps a half-open peer that stops answering pings", async () => {
    const heartbeatMs = 40;
    const { server, port } = await startServer(heartbeatMs);
    const ws = await connectPaired(port, /* autoPong */ false);
    expect(server.liveClientCount()).toBe(1);

    // The client ignores server pings, so within ≤2 beats the server terminates it and the client sees close.
    const closeCode = await new Promise<number>((resolve) => ws.on("close", (code) => resolve(code)));
    expect(closeCode).toBeGreaterThan(0); // abnormal (1006) — server-side terminate, not a clean handshake close

    // The server prunes the socket from `clients` on its own close handler — liveClientCount returns to zero.
    await waitFor(() => server.liveClientCount() === 0);
    expect(server.liveClientCount()).toBe(0);
  });

  it("keeps a responsive client across many beats and it stays functional", async () => {
    const heartbeatMs = 40;
    const { server, port } = await startServer(heartbeatMs);
    const ws = await connectPaired(port); // default client auto-pongs

    // Survive several heartbeat intervals without being reaped.
    await new Promise((r) => setTimeout(r, heartbeatMs * 4));
    expect(server.liveClientCount()).toBe(1);

    // Still a live G1 socket: request_snapshot round-trips.
    ws.send(JSON.stringify({ type: "request_snapshot" }));
    const snap = (await readMessages(ws, 1))[0]!;
    expect(snap.type).toBe("snapshot");
    expect(server.liveClientCount()).toBe(1);
  });

  it("does not reap when the heartbeat is disabled (heartbeatMs <= 0)", async () => {
    const { server, port } = await startServer(0); // heartbeat off
    await connectPaired(port, /* autoPong */ false); // a peer that would never pong

    // With no heartbeat timer, nothing pings and nothing is reaped — the socket persists.
    await new Promise((r) => setTimeout(r, 120));
    expect(server.liveClientCount()).toBe(1);
  });
});
