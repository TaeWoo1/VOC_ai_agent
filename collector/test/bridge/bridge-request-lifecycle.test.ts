/**
 * **Bridge request-lifecycle observability (G1).** The pure pairing core already computes the granular
 * outcome of each request/ticket lifecycle leg — a ticket rejection reason (`used`/`expired`/`not_found`)
 * and the bounded timeout-eviction counts from its opportunistic sweep — but the transport shell used to
 * discard both. These tests lock that the shell now surfaces them in the metadata log (never on the wire,
 * never a secret), so an operator can tell a benign handshake timeout from a replay, and can see stale
 * requests/tickets ageing out.
 */
import { afterEach, describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { BridgeServer } from "../../src/bridge/bridge-server";
import { FilePairingStore } from "../../src/bridge/pairing-store";
import { getLogSink, clearLogSink, type LogEntry } from "../../src/log";
import { connect, fixedClock } from "./helpers";

const APP = "http://localhost:5173";
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()!(); });

/** Start a server on an injectable clock with short TTLs so expiry/eviction are deterministic. */
async function startServer() {
  const clock = fixedClock();
  const dir = mkdtempSync(join(tmpdir(), `bridge-life-${randomUUID()}-`));
  const store = new FilePairingStore(join(dir, "pairings.json"), {
    now: clock.now,
    ticketTtlMs: 10_000,
    requestTtlMs: 300_000,
  });
  // Heartbeat off (heartbeatMs: 0) so the only log entries are the lifecycle ones under test.
  const server = new BridgeServer({ store, allowedOrigins: [APP], agentVersion: "test", port: 0, autoApprovePairing: true, heartbeatMs: 0 });
  const { port } = await server.listen();
  cleanups.push(async () => { await server.close(); rmSync(dir, { recursive: true, force: true }); });
  return { server, port, clock };
}

function post(port: number, path: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: APP, ...headers }, body: JSON.stringify(body),
  });
}

/** Auto-approve is on, so a request is paired immediately — poll returns the token. */
async function pairToken(port: number): Promise<string> {
  const req = await (await post(port, "/bridge/pair/request", { workspaceLabel: "w" })).json();
  return (await (await post(port, "/bridge/pair/poll", { requestId: req.requestId })).json()).pairingToken;
}

async function mintTicket(port: number, token: string): Promise<string> {
  const res = await post(port, "/bridge/ws-ticket", { clientProtocolVersion: 1 }, { Authorization: `Bearer ${token}` });
  return (await res.json()).ticket;
}

function rejections(): LogEntry[] {
  return getLogSink().filter((e) => e.event === "bridge_ws_rejected");
}

function sweeps(): LogEntry[] {
  return getLogSink().filter((e) => e.event === "bridge_pairing_swept");
}

describe("bridge request-lifecycle observability", () => {
  it("logs a granular reason for an unknown ticket while keeping the wire response 'bad_ticket'", async () => {
    const { port } = await startServer();
    clearLogSink();
    const res = await connect({ port, path: "/bridge/ws?ticket=bogus", origin: APP });
    expect(res.status).toBe(401);
    const [entry] = rejections();
    expect(entry?.meta).toMatchObject({ reason: "bad_ticket", detail: "not_found" });
  });

  it("distinguishes a replayed (used) ticket from a first, valid handshake", async () => {
    const { port } = await startServer();
    const token = await pairToken(port);
    const ticket = await mintTicket(port, token);
    // First handshake consumes the ticket and succeeds.
    const first = await connect({ port, path: `/bridge/ws?ticket=${ticket}`, origin: APP });
    expect(first.status).toBe(101);
    clearLogSink();
    // Replaying the same ticket is rejected — and the log names it a replay, not a generic bad ticket.
    const replay = await connect({ port, path: `/bridge/ws?ticket=${ticket}`, origin: APP });
    expect(replay.status).toBe(401);
    expect(rejections()[0]?.meta).toMatchObject({ reason: "bad_ticket", detail: "used" });
    first.ws?.close();
  });

  it("distinguishes an expired (timed-out) ticket from a replay or a forgery", async () => {
    const { port, clock } = await startServer();
    const token = await pairToken(port);
    const ticket = await mintTicket(port, token);
    clock.advance(10_001); // past the 10s ticket TTL — the handshake arrives too late
    clearLogSink();
    const res = await connect({ port, path: `/bridge/ws?ticket=${ticket}`, origin: APP });
    expect(res.status).toBe(401);
    expect(rejections()[0]?.meta).toMatchObject({ reason: "bad_ticket", detail: "expired" });
  });

  it("makes the bounded timeout-eviction of stale pairing requests observable", async () => {
    const { port, clock } = await startServer();
    await post(port, "/bridge/pair/request", { workspaceLabel: "a" });
    clock.advance(300_001); // the first request ages past its confirmation TTL
    clearLogSink();
    // The next request runs the opportunistic sweep first, evicting the stale one — now logged.
    await post(port, "/bridge/pair/request", { workspaceLabel: "b" });
    const [swept] = sweeps();
    expect(swept?.meta).toMatchObject({ trigger: "pair_request", requestsEvicted: 1, ticketsEvicted: 0 });
  });

  it("reports a stale-ticket eviction under the ws_ticket trigger", async () => {
    const { port, clock } = await startServer();
    const token = await pairToken(port);
    await mintTicket(port, token); // ticket #1, left unused
    clock.advance(10_001); // ticket #1 expires
    clearLogSink();
    await mintTicket(port, token); // ticket #2 mint sweeps the dead #1 first
    const [swept] = sweeps();
    expect(swept?.meta).toMatchObject({ trigger: "ws_ticket", requestsEvicted: 0, ticketsEvicted: 1 });
  });

  it("stays silent (no sweep log) when nothing is evicted", async () => {
    const { port } = await startServer();
    clearLogSink();
    await post(port, "/bridge/pair/request", { workspaceLabel: "a" });
    await post(port, "/bridge/pair/request", { workspaceLabel: "b" });
    expect(sweeps()).toHaveLength(0);
  });

  it("never leaks the ticket or any secret into the lifecycle logs", async () => {
    const { port } = await startServer();
    const token = await pairToken(port);
    const ticket = await mintTicket(port, token);
    clearLogSink();
    await connect({ port, path: "/bridge/ws?ticket=bogus", origin: APP });
    const dump = JSON.stringify(getLogSink());
    expect(dump).not.toContain(ticket);
    expect(dump).not.toContain(token);
    // The detail values are a closed, safe enum — no free-form content.
    for (const entry of rejections()) {
      if (entry.meta.detail !== undefined) {
        expect(["not_found", "expired", "used"]).toContain(entry.meta.detail);
      }
    }
  });
});
