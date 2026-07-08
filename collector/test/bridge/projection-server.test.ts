import { afterEach, describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import { BridgeServer } from "../../src/bridge/bridge-server";
import { FilePairingStore } from "../../src/bridge/pairing-store";
import { ProjectionEndpoint } from "../../src/bridge/projection-endpoint";
import { ProjectionRegistry } from "../../src/bridge/projection-session";
import { ProjectionHub, type ProjectionSource } from "../../src/bridge/projection-hub";
import type { AdapterFrame } from "../../src/bridge/projection-adapter";
import { decodeFrameHeader, type ProjectionServerMessage } from "../../src/bridge/projection-protocol";

const APP = "http://localhost:5173";
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()!(); });

class FakeSource implements ProjectionSource {
  started = false;
  get isStarted(): boolean { return this.started; }
  get viewport(): { width: number; height: number } { return { width: 1280, height: 720 }; }
  async start(): Promise<void> { this.started = true; }
  async stop(): Promise<void> { this.started = false; }
  async dispatchInput(): Promise<{ accepted: boolean }> { return { accepted: true }; }
}

async function startServer() {
  const dir = mkdtempSync(join(tmpdir(), `proj-${randomUUID()}-`));
  const store = new FilePairingStore(join(dir, "pairings.json"), { now: () => Date.now() });
  let push: (f: AdapterFrame) => void = () => {};
  const endpoint = new ProjectionEndpoint({
    registry: new ProjectionRegistry({ now: () => Date.now(), leaseIdleMs: 120_000 }),
    capabilities: { view: true, control: true, format: "jpeg", fps: 10 },
    initialTargetHandle: "aaaa1111bbbb2222",
    createSource: (onFrame) => { push = onFrame; return new FakeSource(); },
  });
  const server = new BridgeServer({ store, allowedOrigins: [APP], agentVersion: "test", port: 0, autoApprovePairing: true, projection: endpoint });
  const { port } = await server.listen();
  cleanups.push(async () => { await server.close(); rmSync(dir, { recursive: true, force: true }); });
  return { server, port, endpoint, pushFrame: (f: AdapterFrame) => push(f) };
}

function post(port: number, path: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: APP, ...headers },
    body: JSON.stringify(body),
  });
}

async function pairToken(port: number): Promise<string> {
  const req = await (await post(port, "/bridge/pair/request", { workspaceLabel: "t" })).json();
  const poll = await (await post(port, "/bridge/pair/poll", { requestId: req.requestId })).json();
  return poll.pairingToken as string;
}

async function projTicket(port: number, token: string, version = 1) {
  return await post(port, "/projection/ticket", { clientProjectionVersion: version }, { Authorization: `Bearer ${token}` });
}

interface ProjClient {
  ws: WebSocket;
  texts: ProjectionServerMessage[];
  frames: Buffer[];
  open: Promise<number>;
  closeCode: () => number | undefined;
}
function projClient(port: number, ticket: string, origin = APP): ProjClient {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/projection/ws?ticket=${encodeURIComponent(ticket)}`, { origin });
  const texts: ProjectionServerMessage[] = [];
  const frames: Buffer[] = [];
  let code: number | undefined;
  ws.on("message", (data: WebSocket.RawData, isBinary: boolean) => {
    if (isBinary) frames.push(data as Buffer);
    else { try { texts.push(JSON.parse(data.toString()) as ProjectionServerMessage); } catch { /* ignore */ } }
  });
  ws.on("close", (c) => { code = c; });
  const open = new Promise<number>((resolve, reject) => {
    ws.on("open", () => resolve(101));
    ws.on("unexpected-response", (_r, res) => reject(res.statusCode ?? 0));
    ws.on("error", () => { /* handled via unexpected-response / close */ });
  });
  return { ws, texts, frames, open, closeCode: () => code };
}

async function waitFor(pred: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("waitFor timeout");
}

describe("projection server transport", () => {
  it("mints a projection ticket only for a paired origin + valid token", async () => {
    const { port } = await startServer();
    expect((await projTicket(port, "")).status).toBe(401); // no bearer
    const token = await pairToken(port);
    const good = await projTicket(port, token);
    expect(good.status).toBe(200);
    expect((await good.json()).ticket).toBeTruthy();
    // A disallowed origin cannot mint.
    const badOrigin = await post(port, "/projection/ticket", { clientProjectionVersion: 1 }, { Authorization: `Bearer ${token}`, Origin: "https://evil.example" });
    expect(badOrigin.status).toBe(403);
  });

  it("rejects an incompatible projection version at ticket mint", async () => {
    const { port } = await startServer();
    const token = await pairToken(port);
    const r = await projTicket(port, token, 999);
    expect(r.status).toBe(409);
  });

  it("upgrades a ticketed viewer and sends hello + session + control_available", async () => {
    const { port } = await startServer();
    const token = await pairToken(port);
    const { ticket } = await (await projTicket(port, token)).json();
    const c = projClient(port, ticket);
    await c.open;
    await waitFor(() => c.texts.length >= 3);
    expect(c.texts.map((t) => t.type)).toEqual(expect.arrayContaining(["hello_projection", "session_started", "control_available"]));
    c.ws.close();
  });

  it("rejects a bad origin and a bad ticket at upgrade", async () => {
    const { port } = await startServer();
    const token = await pairToken(port);
    const { ticket } = await (await projTicket(port, token)).json();
    await expect(projClient(port, ticket, "https://evil.example").open).rejects.toBe(403);
    await expect(projClient(port, "not-a-ticket").open).rejects.toBe(401);
  });

  it("closes the socket 1003 if the client sends a binary payload", async () => {
    const { port } = await startServer();
    const token = await pairToken(port);
    const { ticket } = await (await projTicket(port, token)).json();
    const c = projClient(port, ticket);
    await c.open;
    c.ws.send(Buffer.from([1, 2, 3]), { binary: true });
    await waitFor(() => c.closeCode() !== undefined);
    expect(c.closeCode()).toBe(1003);
  });

  it("delivers binary image frames with a decodable header", async () => {
    const { port, pushFrame } = await startServer();
    const token = await pairToken(port);
    const { ticket } = await (await projTicket(port, token)).json();
    const c = projClient(port, ticket);
    await c.open;
    await waitFor(() => c.texts.length >= 3);
    pushFrame({ seq: 42, bytes: Buffer.alloc(500, 9), deviceWidth: 1280, deviceHeight: 720 });
    await waitFor(() => c.frames.length >= 1);
    const hdr = decodeFrameHeader(c.frames[0]!);
    expect(hdr).toMatchObject({ seq: 42, deviceWidth: 1280, deviceHeight: 720, format: "jpeg" });
    c.ws.close();
  });

  it("grants control over the socket and gates input on the lease", async () => {
    const { port } = await startServer();
    const token = await pairToken(port);
    const { ticket } = await (await projTicket(port, token)).json();
    const c = projClient(port, ticket);
    await c.open;
    await waitFor(() => c.texts.length >= 3);
    c.ws.send(JSON.stringify({ type: "request_control" }));
    await waitFor(() => c.texts.some((t) => t.type === "control_granted"));
    c.ws.send(JSON.stringify({ type: "input", input: { kind: "pointer_move", x: 0.5, y: 0.5 } }));
    await waitFor(() => c.texts.some((t) => t.type === "input_accepted"));
    c.ws.close();
  });

  it("terminates a projection socket when its pairing is revoked", async () => {
    const { port } = await startServer();
    const token = await pairToken(port);
    const { ticket } = await (await projTicket(port, token)).json();
    const c = projClient(port, ticket);
    await c.open;
    await waitFor(() => c.texts.length >= 3);
    await post(port, "/bridge/revoke", {}, { Authorization: `Bearer ${token}` });
    await waitFor(() => c.texts.some((t) => t.type === "terminal_error") || c.closeCode() !== undefined);
    expect(c.texts.some((t) => t.type === "terminal_error") || c.closeCode() !== undefined).toBe(true);
  });
});
