/**
 * **Bridge write-path transaction semantics** — hermetic (loopback `node:http` + an in-memory pairing store
 * fake; no real disk, no browser). Locks that confirm and revoke are *persist-then-commit*: each takes effect
 * ONLY when its durable write succeeds, and on a failed write rolls back to the exact pre-operation state.
 * The focus is each operation's SECOND step:
 *  - **confirm → poll**: a confirm whose persist fails is fully undone, so poll reports `pending` and never
 *    surrenders an inert token for a pairing that was never stored; the human can retry and then pair for real.
 *  - **revoke → retry**: a revoke whose persist fails is rolled back, so the credential stays valid and the
 *    retry re-attempts the durable write with the SAME token (it never depends on a now-revoked credential),
 *    while a successful revoke stays durably revoked (user-intent revocation preserved, no restart resurrection).
 */
import { afterEach, describe, it, expect } from "vitest";
import { BridgeServer } from "../../src/bridge/bridge-server";
import { FilePairingStore, type PairingStoreFs } from "../../src/bridge/pairing-store";
import { clearLogSink, getLogSink } from "../../src/log";
import { fakeApprovalPresenter } from "./helpers";

/** Stands in for the human console — pairing is fail-closed without a presenter. One shared instance per file: `lastCode()` is the most recent presentation, and request→confirm is sequential. */
const approval = fakeApprovalPresenter();

const APP = "http://localhost:5173";
const PATH = "/store/.bridge/pairings.json";
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
  clearLogSink();
});

function fsErr(code: string): NodeJS.ErrnoException {
  const e = new Error(code) as NodeJS.ErrnoException;
  e.code = code;
  return e;
}

/** In-memory fs whose writes can be toggled to fail (EACCES) to simulate a non-durable store. */
class ToggleFs implements PairingStoreFs {
  files = new Map<string, string>();
  dirs = new Set<string>();
  failWrites = false;
  private fdPaths = new Map<number, string>();
  private nextFd = 10;

  existsSync(p: string): boolean { return this.files.has(p) || this.dirs.has(p); }
  mkdirSync(p: string): void { this.dirs.add(p); }
  writeFileSync(p: string, data: string): void {
    if (this.failWrites) throw fsErr("EACCES");
    this.files.set(p, data);
  }
  chmodSync(): void { /* no-op */ }
  openSync(p: string, _flags: "r" | "w"): number { const fd = this.nextFd++; this.fdPaths.set(fd, p); return fd; }
  fsyncSync(): void { /* no-op */ }
  closeSync(fd: number): void { this.fdPaths.delete(fd); }
  renameSync(from: string, to: string): void {
    const v = this.files.get(from);
    if (v === undefined) throw fsErr("EIO");
    this.files.delete(from);
    this.files.set(to, v);
  }
  unlinkSync(p: string): void { this.files.delete(p); }
  readFileSync(p: string): string {
    const v = this.files.get(p);
    if (v === undefined) throw fsErr("EIO");
    return v;
  }
}

async function startServer(fs: ToggleFs) {
  const store = new FilePairingStore(PATH, { now: () => Date.now() }, fs);
  const server = new BridgeServer({ store, allowedOrigins: [APP], agentVersion: "test", port: 0, autoApprovePairing: false, approvalPresenter: approval.presenter });
  const { port } = await server.listen();
  cleanups.push(async () => { await server.close(); });
  return { server, store, port };
}

function post(port: number, path: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: APP, ...headers },
    body: JSON.stringify(body),
  });
}

const confirmHeaders = (port: number) => ({ Origin: `http://127.0.0.1:${port}` });

/** Drive request→confirm(self-origin)→poll and return the delivered plaintext token. */
async function pairToken(port: number): Promise<string> {
  const req = await (await post(port, "/bridge/pair/request", { workspaceLabel: "테스트" })).json();
  await post(port, "/bridge/pair/confirm", { requestId: req.requestId, decision: "allow", approvalCode: approval.lastCode() }, confirmHeaders(port));
  const poll = await (await post(port, "/bridge/pair/poll", { requestId: req.requestId })).json();
  return poll.pairingToken as string;
}

async function wsTicketStatus(port: number, token: string): Promise<number> {
  return (await post(port, "/bridge/ws-ticket", { clientProtocolVersion: 1 }, { Authorization: `Bearer ${token}` })).status;
}

describe("bridge write-path transaction semantics", () => {
  it("confirm→poll: a persist-failed confirm is fully undone — poll reports pending and hands out NO token", async () => {
    const fs = new ToggleFs();
    fs.failWrites = true; // the confirm cannot reach disk
    const { store, port } = await startServer(fs);

    const req = await (await post(port, "/bridge/pair/request", { workspaceLabel: "테스트" })).json();
    const confirm = await post(port, "/bridge/pair/confirm", { requestId: req.requestId, decision: "allow", approvalCode: approval.lastCode() }, confirmHeaders(port));

    expect(confirm.status).toBe(500);
    expect(await confirm.json()).toEqual({ ok: false, error: "persist_failed" });
    expect(store.registry.hasActivePairing()).toBe(false); // no pairing was committed

    // SECOND STEP: poll must NOT report `paired` and must NOT surrender a token (there is no durable pairing).
    const poll = await (await post(port, "/bridge/pair/poll", { requestId: req.requestId })).json();
    expect(poll.status).toBe("pending");
    expect(poll.pairingToken).toBeUndefined();

    const failures = getLogSink().filter((e) => e.event === "bridge_persist_failed");
    expect(failures).toHaveLength(1);
    expect(failures[0]!.meta).toEqual({ context: "confirm", reason: "permission_denied" });
  });

  it("confirm→poll: the SAME request is still confirmable once writes recover — the retry pairs for real", async () => {
    const fs = new ToggleFs();
    fs.failWrites = true;
    const { store, port } = await startServer(fs);

    const req = await (await post(port, "/bridge/pair/request", { workspaceLabel: "테스트" })).json();
    expect((await post(port, "/bridge/pair/confirm", { requestId: req.requestId, decision: "allow", approvalCode: approval.lastCode() }, confirmHeaders(port))).status).toBe(500);

    fs.failWrites = false; // storage recovers
    const retry = await post(port, "/bridge/pair/confirm", { requestId: req.requestId, decision: "allow", approvalCode: approval.lastCode() }, confirmHeaders(port));
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual({ ok: true });

    const poll = await (await post(port, "/bridge/pair/poll", { requestId: req.requestId })).json();
    expect(poll.status).toBe("paired");
    expect(typeof poll.pairingToken).toBe("string");
    expect(store.registry.hasActivePairing()).toBe(true);
    expect(await wsTicketStatus(port, poll.pairingToken)).toBe(200); // the retried token authenticates for real
    expect(JSON.parse(fs.files.get(PATH)!)[0].revoked).toBe(false);
  });

  it("revoke→retry: a persist-failed revoke is rolled back — the SAME token stays valid and the retry succeeds", async () => {
    const fs = new ToggleFs();
    const { port } = await startServer(fs);
    const token = await pairToken(port);
    expect(await wsTicketStatus(port, token)).toBe(200);

    fs.failWrites = true; // the revoke write will not reach disk
    const failed = await post(port, "/bridge/revoke", {}, { Authorization: `Bearer ${token}` });
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ ok: false, error: "persist_failed" });

    // SECOND STEP: the credential is NOT dead — the retry does not depend on a now-revoked token.
    expect(await wsTicketStatus(port, token)).toBe(200); // still authenticates (revoke was rolled back)
    expect(JSON.parse(fs.files.get(PATH)!)[0].revoked).toBe(false); // disk agrees — no divergence to resurrect

    fs.failWrites = false; // storage recovers
    const retry = await post(port, "/bridge/revoke", {}, { Authorization: `Bearer ${token}` });
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual({ ok: true });

    // Now durably revoked — user-intent revocation preserved and persisted; the token is dead everywhere.
    expect(await wsTicketStatus(port, token)).toBe(401);
    expect(JSON.parse(fs.files.get(PATH)!)[0].revoked).toBe(true);

    const failures = getLogSink().filter((e) => e.event === "bridge_persist_failed");
    expect(failures).toHaveLength(1);
    expect(failures[0]!.meta).toEqual({ context: "revoke", reason: "permission_denied" });
  });

  it("the durable happy paths are unaffected — confirm→200 and revoke→200 both commit and persist", async () => {
    const fs = new ToggleFs();
    const { store, port } = await startServer(fs);

    const req = await (await post(port, "/bridge/pair/request", { workspaceLabel: "테스트" })).json();
    const confirm = await post(port, "/bridge/pair/confirm", { requestId: req.requestId, decision: "allow", approvalCode: approval.lastCode() }, confirmHeaders(port));
    expect(confirm.status).toBe(200);
    expect(store.registry.hasActivePairing()).toBe(true);
    expect(JSON.parse(fs.files.get(PATH)!)[0].revoked).toBe(false);

    const poll = await (await post(port, "/bridge/pair/poll", { requestId: req.requestId })).json();
    const revoke = await post(port, "/bridge/revoke", {}, { Authorization: `Bearer ${poll.pairingToken}` });
    expect(revoke.status).toBe(200);
    expect(JSON.parse(fs.files.get(PATH)!)[0].revoked).toBe(true);
    expect(getLogSink().some((e) => e.event === "bridge_persist_failed")).toBe(false);
  });
});
