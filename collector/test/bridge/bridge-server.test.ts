import { afterEach, describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import { BridgeServer } from "../../src/bridge/bridge-server";
import { FilePairingStore } from "../../src/bridge/pairing-store";
import { connect, readMessages, fakeApprovalPresenter } from "./helpers";

const APP = "http://localhost:5173";
const cleanups: Array<() => Promise<void>> = [];
/** Stands in for the human console — pairing is fail-closed without a presenter. One shared instance per file: `lastCode()` is the most recent presentation, and request→confirm is sequential. */
const approval = fakeApprovalPresenter();

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

async function startServer(opts: { autoApprove?: boolean; port?: number; allowed?: string[] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), `bridge-${randomUUID()}-`));
  const store = new FilePairingStore(join(dir, "pairings.json"), { now: () => Date.now() });
  const server = new BridgeServer({
    store,
    allowedOrigins: opts.allowed ?? [APP],
    agentVersion: "test",
    port: opts.port ?? 0,
    autoApprovePairing: opts.autoApprove ?? false,
    approvalPresenter: approval.presenter,
  });
  const { port } = await server.listen();
  cleanups.push(async () => { await server.close(); rmSync(dir, { recursive: true, force: true }); });
  return { server, port, store };
}

function post(port: number, path: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: APP, ...headers },
    body: JSON.stringify(body),
  });
}

/** Drive a full request→confirm→poll pairing and return the plaintext token. */
async function pairToken(port: number): Promise<string> {
  const req = await (await post(port, "/bridge/pair/request", { workspaceLabel: "테스트" })).json();
  // Simulate the human clicking Allow on the agent-owned confirmation page (self-origin).
  await post(port, "/bridge/pair/confirm", { requestId: req.requestId, decision: "allow", approvalCode: approval.lastCode() }, { Origin: `http://127.0.0.1:${port}` });
  const poll = await (await post(port, "/bridge/pair/poll", { requestId: req.requestId })).json();
  return poll.pairingToken as string;
}

async function mintTicket(port: number, token: string, version = 1): Promise<string> {
  const r = await (await post(port, "/bridge/ws-ticket", { clientProtocolVersion: version }, { Authorization: `Bearer ${token}` })).json();
  return r.ticket as string;
}

describe("bridge server", () => {
  it("serves a minimal health payload with no sensitive fields", async () => {
    const { port } = await startServer();
    const res = await fetch(`http://127.0.0.1:${port}/bridge/health`);
    const body = await res.json();
    // Minimal presence + protocol only — NO pairing state (slice §E).
    expect(body).toEqual({ ok: true, service: "sellerops-local-agent", agentVersion: "test", protocolVersion: 1 });
    expect(Object.keys(body).sort()).toEqual(["agentVersion", "ok", "protocolVersion", "service"]);
    expect(Object.keys(body)).not.toContain("paired");
  });

  it("rejects a disallowed browser Origin on health", async () => {
    const { port } = await startServer();
    const res = await fetch(`http://127.0.0.1:${port}/bridge/health`, { headers: { Origin: "https://evil.example" } });
    expect(res.status).toBe(403);
  });

  it("pairing requires local confirmation; the confirmUrl carries no secret", async () => {
    const { port } = await startServer();
    const req = await (await post(port, "/bridge/pair/request", { workspaceLabel: "w" })).json();
    expect(req.confirmUrl).toContain(req.requestId);
    // Before confirmation, poll is pending — no token issued.
    const pending = await (await post(port, "/bridge/pair/poll", { requestId: req.requestId })).json();
    expect(pending.status).toBe("pending");
    // After local Allow, the token is delivered.
    await post(port, "/bridge/pair/confirm", { requestId: req.requestId, decision: "allow", approvalCode: approval.lastCode() }, { Origin: `http://127.0.0.1:${port}` });
    const paired = await (await post(port, "/bridge/pair/poll", { requestId: req.requestId })).json();
    expect(paired.status).toBe("paired");
    expect(typeof paired.pairingToken).toBe("string");
  });

  it("rejects a cross-site confirm attempt", async () => {
    const { port } = await startServer();
    const req = await (await post(port, "/bridge/pair/request", { workspaceLabel: "w" })).json();
    const res = await post(port, "/bridge/pair/confirm", { requestId: req.requestId, decision: "allow" }, { Origin: "https://evil.example" });
    expect(res.status).toBe(403);
  });

  it("rejects an unpaired / bad-ticket WebSocket handshake", async () => {
    const { port } = await startServer();
    const bad = await connect({ port, path: "/bridge/ws?ticket=bogus", origin: APP });
    expect(bad.status).toBe(401);
  });

  it("rejects a disallowed Origin on the WebSocket handshake (even with a valid ticket)", async () => {
    const { port } = await startServer();
    const token = await pairToken(port);
    const ticket = await mintTicket(port, token);
    const res = await connect({ port, path: `/bridge/ws?ticket=${ticket}`, origin: "https://evil.example" });
    expect(res.status).toBe(403);
    // The ticket was NOT consumed by the rejected handshake, so it still works from an allowed origin.
    const ok = await connect({ port, path: `/bridge/ws?ticket=${ticket}`, origin: APP });
    expect(ok.status).toBe(101);
    ok.ws?.close();
  });

  it("accepts a paired handshake and sends hello (with supportedEvents) + snapshot", async () => {
    const { port } = await startServer();
    const token = await pairToken(port);
    const ticket = await mintTicket(port, token);
    const up = await connect({ port, path: `/bridge/ws?ticket=${ticket}`, origin: APP });
    expect(up.status).toBe(101);
    const msgs = await readMessages(up.ws!, 2);
    const hello = msgs[0]!;
    const snapshot = msgs[1]!;
    expect(hello.type).toBe("hello");
    expect(hello.protocolVersion).toBe(1);
    // Capability negotiation lists which event categories are actually wired (slice §C).
    expect(hello.supportedEvents).toContain("connection_lifecycle");
    expect(hello.supportedEvents).not.toContain("browser_lifecycle");
    expect(snapshot.type).toBe("snapshot");
    up.ws?.close();
  });

  it("makes a WS ticket single-use (replay rejected)", async () => {
    const { port } = await startServer();
    const token = await pairToken(port);
    const ticket = await mintTicket(port, token);
    const first = await connect({ port, path: `/bridge/ws?ticket=${ticket}`, origin: APP });
    expect(first.status).toBe(101);
    first.ws?.close();
    const replay = await connect({ port, path: `/bridge/ws?ticket=${ticket}`, origin: APP });
    expect(replay.status).toBe(401);
  });

  it("closes the socket on an unsupported binary message", async () => {
    const { port } = await startServer();
    const token = await pairToken(port);
    const up = await connect({ port, path: `/bridge/ws?ticket=${await mintTicket(port, token)}`, origin: APP });
    await readMessages(up.ws!, 2);
    const closed = new Promise<number>((resolve) => up.ws!.on("close", (code) => resolve(code)));
    up.ws!.send(Buffer.from([0x00, 0x01, 0x02]), { binary: true });
    expect(await closed).toBe(1003); // unsupported data
  });

  it("closes the socket on an oversize message (maxPayload)", async () => {
    const { port } = await startServer();
    const token = await pairToken(port);
    const up = await connect({ port, path: `/bridge/ws?ticket=${await mintTicket(port, token)}`, origin: APP });
    await readMessages(up.ws!, 2);
    const closed = new Promise<number>((resolve) => up.ws!.on("close", (code) => resolve(code)));
    up.ws!.send(JSON.stringify({ type: "x", pad: "a".repeat(70 * 1024) }));
    expect(await closed).toBe(1009); // message too big
  });

  it("surfaces protocol-version incompatibility at ticket mint", async () => {
    const { port } = await startServer();
    const token = await pairToken(port);
    const res = await post(port, "/bridge/ws-ticket", { clientProtocolVersion: 999 }, { Authorization: `Bearer ${token}` });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toEqual({ error: "incompatible_version", agentProtocolVersion: 1 });
  });

  it("broadcasts an event to multiple tabs and restores it in a later snapshot", async () => {
    const { server, port } = await startServer();
    const token = await pairToken(port);
    const tabA = await connect({ port, path: `/bridge/ws?ticket=${await mintTicket(port, token)}`, origin: APP });
    const tabB = await connect({ port, path: `/bridge/ws?ticket=${await mintTicket(port, token)}`, origin: APP });
    // Drain the initial hello+snapshot from both.
    await readMessages(tabA.ws!, 2);
    await readMessages(tabB.ws!, 2);
    server.events.connectionState("ref00000000abcd", "ready");
    const [evA] = await readMessages(tabA.ws!, 1);
    const [evB] = await readMessages(tabB.ws!, 1);
    expect(evA).toMatchObject({ type: "event", category: "connection_lifecycle", ref: "ref00000000abcd", payload: { state: "ready" } });
    expect(evB).toMatchObject({ category: "connection_lifecycle", payload: { state: "ready" } });
    tabA.ws?.close();
    tabB.ws?.close();

    // A NEW tab connecting later restores the accumulated state via snapshot.
    const tabC = await connect({ port, path: `/bridge/ws?ticket=${await mintTicket(port, token)}`, origin: APP });
    const msgs = await readMessages(tabC.ws!, 2);
    expect(JSON.stringify(msgs[1]!)).toContain("ref00000000abcd");
    tabC.ws?.close();
  });

  it("revokes a pairing and drops its live sockets", async () => {
    const { port } = await startServer();
    const token = await pairToken(port);
    const up = await connect({ port, path: `/bridge/ws?ticket=${await mintTicket(port, token)}`, origin: APP });
    expect(up.status).toBe(101);
    await readMessages(up.ws!, 2);
    const closed = new Promise<void>((resolve) => up.ws!.on("close", () => resolve()));
    const rev = await post(port, "/bridge/revoke", {}, { Authorization: `Bearer ${token}` });
    expect(rev.status).toBe(200);
    await closed; // the live socket is dropped on revoke
    // A subsequent ticket mint with the revoked token is unauthorized.
    const after = await post(port, "/bridge/ws-ticket", { clientProtocolVersion: 1 }, { Authorization: `Bearer ${token}` });
    expect(after.status).toBe(401);
  });

  it("handles a clean client close without error", async () => {
    const { port } = await startServer();
    const token = await pairToken(port);
    const up = await connect({ port, path: `/bridge/ws?ticket=${await mintTicket(port, token)}`, origin: APP });
    await readMessages(up.ws!, 2);
    up.ws!.close(1000);
    // Server still accepts a fresh connection afterwards.
    const again = await connect({ port, path: `/bridge/ws?ticket=${await mintTicket(port, token)}`, origin: APP });
    expect(again.status).toBe(101);
    again.ws?.close();
  });

  it("refuses to start a duplicate instance on the same port (single-instance)", async () => {
    const { port } = await startServer();
    const dir = mkdtempSync(join(tmpdir(), `bridge-dup-`));
    const store = new FilePairingStore(join(dir, "pairings.json"), { now: () => Date.now() });
    const dup = new BridgeServer({ store, allowedOrigins: [APP], agentVersion: "t", port });
    await expect(dup.listen()).rejects.toMatchObject({ code: "EADDRINUSE" });
    rmSync(dir, { recursive: true, force: true });
  });

  it("answers a CORS preflight for an allowed origin and echoes only that origin", async () => {
    const { port } = await startServer();
    const pre = await fetch(`http://127.0.0.1:${port}/bridge/pair/request`, {
      method: "OPTIONS",
      headers: { Origin: APP, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization" },
    });
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-origin")).toBe(APP);
    // A normal response also carries the allow-origin (echoed, never "*").
    const health = await fetch(`http://127.0.0.1:${port}/bridge/health`, { headers: { Origin: APP } });
    expect(health.headers.get("access-control-allow-origin")).toBe(APP);
    expect(health.headers.get("access-control-allow-origin")).not.toBe("*");
  });

  it("rejects a CORS preflight from a disallowed origin", async () => {
    const { port } = await startServer();
    const pre = await fetch(`http://127.0.0.1:${port}/bridge/pair/request`, {
      method: "OPTIONS",
      headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "POST" },
    });
    expect(pre.status).toBe(403);
    expect(pre.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("dev auto-approve skips the confirmation click", async () => {
    const { port } = await startServer({ autoApprove: true });
    const req = await (await post(port, "/bridge/pair/request", { workspaceLabel: "w" })).json();
    const poll = await (await post(port, "/bridge/pair/poll", { requestId: req.requestId })).json();
    expect(poll.status).toBe("paired"); // no confirm call needed
  });
});
