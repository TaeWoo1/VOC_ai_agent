/**
 * **When SellerOps counts as having asked to be connected.**
 *
 * The import agent uses this signal for one visible thing: it brings the seller's marketplace window up. The
 * product owner stated that as a sequence (2026-07-26) — open SellerOps, request the connection, and THEN the
 * seller center appears. Earlier than that and a window arrives before they have asked for anything; later and
 * they meet it in the middle of a guided step.
 *
 * So what does and does not count is a product decision with a security edge, and these tests pin both halves:
 *
 *  - a pairing that took effect counts, and so does an already-paired tab attaching (the only signal a RETURNING
 *    seller produces — they never pair again);
 *  - a pairing REQUEST that has not been approved does not, because an unapproved request is any page on an
 *    allowed origin asking, and a page must not be able to open a window on someone's machine;
 *  - a DENIED confirmation does not;
 *  - and a hook that throws cannot break pairing, because a browser failing to launch must never cost the seller
 *    their connection.
 *
 * Hermetic: loopback, temp store, injected presenter. No browser is involved — the hook is a callback, and what
 * the import boot does with it is `LazyImportDriver`'s business.
 */
import { afterEach, describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import { BridgeServer } from "../../src/bridge/bridge-server";
import { FilePairingStore } from "../../src/bridge/pairing-store";
import { fakeApprovalPresenter } from "./helpers";

const APP = "http://localhost:5173";
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

async function startServer(opts: { autoApprove?: boolean; throwFromHook?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), `bridge-connected-hook-${randomUUID()}-`));
  const store = new FilePairingStore(join(dir, "pairings.json"), { now: () => Date.now() });
  const approval = fakeApprovalPresenter();
  let calls = 0;
  const server = new BridgeServer({
    store,
    allowedOrigins: [APP],
    agentVersion: "test",
    port: 0,
    heartbeatMs: 0,
    approvalPresenter: approval.presenter,
    ...(opts.autoApprove ? { autoApprovePairing: true } : {}),
    onSellerOpsConnected: () => {
      calls += 1;
      if (opts.throwFromHook) throw new Error("the browser refused to launch");
    },
  });
  const { port } = await server.listen();
  cleanups.push(async () => {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { server, port, approval, calls: () => calls };
}

function post(port: number, path: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: APP, ...headers },
    body: JSON.stringify(body),
  });
}

/** Pair the way a seller does: request, approve out of band, then collect the token. */
async function pair(port: number, approval: ReturnType<typeof fakeApprovalPresenter>): Promise<string> {
  const req = await (await post(port, "/bridge/pair/request", { workspaceLabel: "test" })).json();
  await post(
    port,
    "/bridge/pair/confirm",
    { requestId: req.requestId, decision: "allow", approvalCode: approval.lastCode() },
    { Origin: `http://127.0.0.1:${port}` },
  );
  const poll = await (await post(port, "/bridge/pair/poll", { requestId: req.requestId })).json();
  return poll.pairingToken as string;
}

async function attach(port: number, token: string): Promise<WebSocket> {
  const minted = await (
    await post(port, "/bridge/ws-ticket", { clientProtocolVersion: 1 }, { Authorization: `Bearer ${token}` })
  ).json();
  const ws = new WebSocket(`ws://127.0.0.1:${port}/bridge/ws?ticket=${minted.ticket}`, { origin: APP });
  await new Promise<void>((resolve, reject) => {
    ws.on("open", () => resolve());
    ws.on("error", reject);
  });
  cleanups.push(async () => ws.close());
  return ws;
}

describe("onSellerOpsConnected — the seller asking to be connected", () => {
  it("does not fire on a pairing request that nobody has approved yet", async () => {
    const { port, calls } = await startServer();
    await post(port, "/bridge/pair/request", { workspaceLabel: "test" });
    // An unapproved request is a page asking. A page must not be able to put a window on someone's screen.
    expect(calls()).toBe(0);
  });

  it("fires when a pairing is approved", async () => {
    const { port, approval, calls } = await startServer();
    await pair(port, approval);
    expect(calls()).toBe(1);
  });

  it("does not fire when the human DENIES the pairing", async () => {
    const { port, calls } = await startServer();
    const req = await (await post(port, "/bridge/pair/request", { workspaceLabel: "test" })).json();
    await post(
      port,
      "/bridge/pair/confirm",
      { requestId: req.requestId, decision: "deny" },
      { Origin: `http://127.0.0.1:${port}` },
    );
    expect(calls()).toBe(0);
  });

  it("fires on the dev auto-approve path too, which is where a request IS the approval", async () => {
    const { port, calls } = await startServer({ autoApprove: true });
    await post(port, "/bridge/pair/request", { workspaceLabel: "test" });
    expect(calls()).toBe(1);
  });

  /**
   * The case that makes this hook worth having. A returning seller never pairs again — their tab attaches with a
   * stored token — so a pairing-only trigger would fire exactly once, on the first day, and never afterwards.
   */
  it("fires when an already-paired tab attaches", async () => {
    const { port, approval, calls } = await startServer();
    const token = await pair(port, approval);
    const after = calls();

    await attach(port, token);
    expect(calls()).toBe(after + 1);
  });

  it("fires again on a reconnect, because the handler is the one that must be idempotent", async () => {
    const { port, approval, calls } = await startServer();
    const token = await pair(port, approval);
    await attach(port, token);
    const after = calls();
    await attach(port, token);
    expect(calls()).toBe(after + 1);
  });

  /**
   * A browser that would not launch must not cost the seller their pairing or their status socket. The hook runs
   * on both accept paths, so a throw there would otherwise take out the connection itself.
   */
  it("pairs and attaches normally even when the hook throws", async () => {
    const { port, approval, calls } = await startServer({ throwFromHook: true });
    const token = await pair(port, approval);
    expect(token).toBeTruthy();
    const ws = await attach(port, token);
    expect(ws.readyState).toBe(WebSocket.OPEN);
    expect(calls()).toBeGreaterThanOrEqual(2);
  });

  it("is entirely optional — a bridge with no hook behaves as before", async () => {
    const dir = mkdtempSync(join(tmpdir(), `bridge-no-hook-${randomUUID()}-`));
    const store = new FilePairingStore(join(dir, "pairings.json"), { now: () => Date.now() });
    const approval = fakeApprovalPresenter();
    const server = new BridgeServer({
      store,
      allowedOrigins: [APP],
      agentVersion: "test",
      port: 0,
      heartbeatMs: 0,
      approvalPresenter: approval.presenter,
    });
    const { port } = await server.listen();
    cleanups.push(async () => {
      await server.close();
      rmSync(dir, { recursive: true, force: true });
    });

    const token = await pair(port, approval);
    const ws = await attach(port, token);
    expect(ws.readyState).toBe(WebSocket.OPEN);
  });
});
