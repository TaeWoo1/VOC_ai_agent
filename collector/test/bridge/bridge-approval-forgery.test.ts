/**
 * **The forgery regression suite.** Drives the REAL bridge HTTP surface as the attacker would: a local
 * process that can spoof any `Origin` header (browsers cannot, but a non-browser caller trivially can), reads
 * its own `pair/request` response, and can fetch the confirmation page. It must still be unable to approve.
 *
 * Also locks the fail-closed production gate, the presentation-failure rollback, and the privacy rule that
 * the approval secret never reaches an HTTP response, the confirmation page, the log sink, or the disk.
 *
 * Hermetic: loopback only (as the sibling bridge suites already do), temp store dir, injected presenter —
 * no browser, no backend, no network, no real terminal.
 */
import { afterEach, describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { BridgeServer } from "../../src/bridge/bridge-server";
import { FilePairingStore } from "../../src/bridge/pairing-store";
import type { ApprovalPresentation, ApprovalPresenter, PresenterUnavailable } from "../../src/bridge/approval-presenter";
import { clearLogSink, getLogSink } from "../../src/log";

const APP = "http://localhost:5173";
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
  clearLogSink();
});

/**
 * A presenter standing in for the human console. It records what would have been shown, so the test can act
 * as the human who read the code — and, crucially, so we can prove that value never appears anywhere else.
 */
function capturingPresenter(opts: { available?: boolean; failWith?: PresenterUnavailable; decline?: boolean } = {}) {
  const shown: ApprovalPresentation[] = [];
  const presenter: ApprovalPresenter = {
    available: () => opts.available ?? true,
    present: (p) => {
      shown.push(p); // record even on failure/decline, so the rollback tests can look the request up
      if (opts.decline) return { status: "declined" };
      return opts.failWith ? { status: "unavailable", reason: opts.failWith } : { status: "presented" };
    },
  };
  return { shown, presenter };
}

async function startServer(opts: {
  presenter?: ApprovalPresenter;
  autoApprove?: boolean;
  /** Pending-request cap. Injected small so a flood is a handful of calls, not the default in a loop. */
  maxPendingRequests?: number;
} = {}) {
  const dir = mkdtempSync(join(tmpdir(), `bridge-approval-${randomUUID()}-`));
  const pairingFile = join(dir, "pairings.json");
  const store = new FilePairingStore(pairingFile, {
    now: () => Date.now(),
    ...(opts.maxPendingRequests !== undefined ? { maxPendingRequests: opts.maxPendingRequests } : {}),
  });
  const server = new BridgeServer({
    store,
    allowedOrigins: [APP],
    agentVersion: "test",
    port: 0,
    heartbeatMs: 0,
    ...(opts.presenter ? { approvalPresenter: opts.presenter } : {}),
    ...(opts.autoApprove !== undefined ? { autoApprovePairing: opts.autoApprove } : {}),
  });
  const { port } = await server.listen();
  cleanups.push(async () => { await server.close(); rmSync(dir, { recursive: true, force: true }); });
  return { server, port, store, pairingFile };
}

function post(port: number, path: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    // The attacker spoofs an allowed Origin — a non-browser caller controls this header freely.
    headers: { "Content-Type": "application/json", Origin: APP, ...headers },
    body: JSON.stringify(body),
  });
}

/** Confirm exactly as a local attacker would: NO Origin header at all (which the self-origin check lets pass). */
function confirmNoOrigin(port: number, body: unknown) {
  return fetch(`http://127.0.0.1:${port}/bridge/pair/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("pairing approval — forgery resistance", () => {
  it("a local process holding requestId cannot approve without the console code", async () => {
    const { presenter } = capturingPresenter();
    const { port } = await startServer({ presenter });

    const req = await (await post(port, "/bridge/pair/request", { workspaceLabel: "w" })).json();
    // The attacker holds everything the OLD confirm endpoint checked: a valid requestId, the confirmationCode,
    // and full control of the Origin header. Under the old code this exact call paired successfully.
    const forged = await confirmNoOrigin(port, { requestId: req.requestId, decision: "allow" });
    expect(forged.ok).toBe(false);
    // Guessing, and reusing the attacker-known confirmationCode, both fail.
    expect((await confirmNoOrigin(port, { requestId: req.requestId, decision: "allow", approvalCode: "DEAD-BEEF" })).ok).toBe(false);
    expect((await confirmNoOrigin(port, { requestId: req.requestId, decision: "allow", approvalCode: req.confirmationCode })).ok).toBe(false);

    // No token is ever issued.
    const poll = await (await post(port, "/bridge/pair/poll", { requestId: req.requestId })).json();
    expect(poll.status).toBe("pending");
    expect(poll.pairingToken).toBeUndefined();
  });

  it("only the code shown on the agent console pairs", async () => {
    const { shown, presenter } = capturingPresenter();
    const { port } = await startServer({ presenter });

    const req = await (await post(port, "/bridge/pair/request", { workspaceLabel: "w" })).json();
    expect(shown).toHaveLength(1);
    expect(shown[0]!.requestId).toBe(req.requestId);

    // The human reads the code off the console and types it in.
    const ok = await confirmNoOrigin(port, { requestId: req.requestId, decision: "allow", approvalCode: shown[0]!.approvalCode });
    expect(ok.ok).toBe(true);
    const poll = await (await post(port, "/bridge/pair/poll", { requestId: req.requestId })).json();
    expect(poll.status).toBe("paired");
    expect(typeof poll.pairingToken).toBe("string");
  });

  it("the pair/request response never carries the approval code", async () => {
    const { shown, presenter } = capturingPresenter();
    const { port } = await startServer({ presenter });
    const res = await post(port, "/bridge/pair/request", { workspaceLabel: "w" });
    const body = await res.json();
    // Exactly the pre-existing PairRequestResponse shape — the secret is absent by construction.
    expect(Object.keys(body).sort()).toEqual(["confirmUrl", "confirmationCode", "requestId"]);
    expect(JSON.stringify(body)).not.toContain(shown[0]!.approvalCode.replace("-", ""));
  });

  it("five wrong attempts burn the request; the correct code then fails", async () => {
    const { shown, presenter } = capturingPresenter();
    const { port } = await startServer({ presenter });
    const req = await (await post(port, "/bridge/pair/request", { workspaceLabel: "w" })).json();

    for (let i = 0; i < 5; i += 1) {
      const r = await confirmNoOrigin(port, { requestId: req.requestId, decision: "allow", approvalCode: "DEAD-BEEF" });
      expect(r.ok).toBe(false);
    }
    const afterBurn = await confirmNoOrigin(port, { requestId: req.requestId, decision: "allow", approvalCode: shown[0]!.approvalCode });
    expect(afterBurn.ok).toBe(false);
    const poll = await (await post(port, "/bridge/pair/poll", { requestId: req.requestId })).json();
    expect(poll.status).toBe("denied");
  });

  it("a wrong code and an unknown requestId are indistinguishable (no oracle)", async () => {
    const { presenter } = capturingPresenter();
    const { port } = await startServer({ presenter });
    const req = await (await post(port, "/bridge/pair/request", { workspaceLabel: "w" })).json();

    const wrongCode = await confirmNoOrigin(port, { requestId: req.requestId, decision: "allow", approvalCode: "DEAD-BEEF" });
    const unknownId = await confirmNoOrigin(port, { requestId: "ffffffffffffffff", decision: "allow", approvalCode: "DEAD-BEEF" });
    expect(wrongCode.status).toBe(unknownId.status);
    expect(await wrongCode.json()).toEqual(await unknownId.json());
  });
});

describe("pairing approval — fail-closed gate", () => {
  it("no presenter returns a sanitized 503 and mints nothing — in EVERY environment", async () => {
    // No presenter wired, and NODE_ENV is `test` here (not production): the gate is unconditional, so there
    // is no environment in which a missing human channel silently degrades to an un-gated confirm.
    const { port } = await startServer();
    const res = await post(port, "/bridge/pair/request", { workspaceLabel: "w" });
    expect(res.status).toBe(503);
    // Sanitized: a fixed error code only — no requestId, no code, no path, no pairing detail.
    expect(await res.json()).toEqual({ error: "approval_unavailable" });
  });

  it("an unavailable presenter also refuses", async () => {
    const { presenter } = capturingPresenter({ available: false });
    const { port } = await startServer({ presenter });
    const res = await post(port, "/bridge/pair/request", { workspaceLabel: "w" });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "approval_unavailable" });
  });

  it("a refused pair/request mints nothing — no requestId is ever issued to retry with", async () => {
    const { port } = await startServer();
    const body = await (await post(port, "/bridge/pair/request", { workspaceLabel: "w" })).json();
    expect(body.requestId).toBeUndefined();
    expect(body.confirmationCode).toBeUndefined();
  });

  it("rolls the request back when presentation fails — the human never saw the code", async () => {
    const { shown, presenter } = capturingPresenter({ failWith: "presenter_failed" });
    const { port, store } = await startServer({ presenter });

    const res = await post(port, "/bridge/pair/request", { workspaceLabel: "w" });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "approval_unavailable" });

    // A request WAS minted, then discarded: it must be unconfirmable and leave no ephemeral state.
    expect(shown).toHaveLength(1);
    const requestId = shown[0]!.requestId;
    expect(store.registry.getRequestView(requestId)).toBeNull();
    const retry = await confirmNoOrigin(port, { requestId, decision: "allow", approvalCode: shown[0]!.approvalCode });
    expect(retry.ok).toBe(false);
  });

  it("a human refusal discards the request immediately and is reported distinctly", async () => {
    const { shown, presenter } = capturingPresenter({ decline: true });
    const { port, store } = await startServer({ presenter });

    const res = await post(port, "/bridge/pair/request", { workspaceLabel: "w" });
    // 403 + approval_declined — distinct from the 503/approval_unavailable "no channel exists" case, so the
    // frontend can say "거부됨" rather than "연결할 수 없음".
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "approval_declined" });

    // Refused means GONE, not left to age out on the 5-minute TTL.
    expect(shown).toHaveLength(1);
    const requestId = shown[0]!.requestId;
    expect(store.registry.getRequestView(requestId)).toBeNull();
    const retry = await confirmNoOrigin(port, { requestId, decision: "allow", approvalCode: shown[0]!.approvalCode });
    expect(retry.ok).toBe(false);
  });

  it("a refusal issues no requestId and no code to the caller", async () => {
    const { presenter } = capturingPresenter({ decline: true });
    const { port } = await startServer({ presenter });
    const body = await (await post(port, "/bridge/pair/request", { workspaceLabel: "w" })).json();
    expect(body.requestId).toBeUndefined();
    expect(body.confirmationCode).toBeUndefined();
  });

  it("DEV auto-approve is the ONLY bypass, and must be injected explicitly", async () => {
    // The two are mutually exclusive by design: auto-approve means no human is involved. It is never a
    // fallback for a missing presenter — it only applies when explicitly injected, and `resolveBridgeConfig`
    // refuses it under NODE_ENV=production (locked by `cli/bridge` config tests).
    const { port } = await startServer({ autoApprove: true });
    const req = await (await post(port, "/bridge/pair/request", { workspaceLabel: "w" })).json();
    const poll = await (await post(port, "/bridge/pair/poll", { requestId: req.requestId })).json();
    expect(poll.status).toBe("paired");
  });
});

describe("pairing approval — privacy of the secret", () => {
  it("never appears in the log sink, the confirmation page, or the persisted store", async () => {
    clearLogSink();
    const { shown, presenter } = capturingPresenter();
    const { port, pairingFile } = await startServer({ presenter });

    const req = await (await post(port, "/bridge/pair/request", { workspaceLabel: "w" })).json();
    const bare = shown[0]!.approvalCode.replace("-", "");

    // 1. Not in the log sink (log() writes stdout AND this in-memory array; safeMeta would NOT drop it).
    expect(JSON.stringify(getLogSink())).not.toContain(bare);

    // 2. Not in the confirmation page — which any holder of the public requestId can fetch.
    const page = await (await fetch(`http://127.0.0.1:${port}/bridge/confirm?requestId=${req.requestId}`)).text();
    expect(page).not.toContain(bare);
    expect(page).not.toContain(shown[0]!.approvalCode);
    // ...but the page does collect it from the human.
    expect(page).toContain('id="approval"');

    // 3. Not on disk after a successful pairing.
    await confirmNoOrigin(port, { requestId: req.requestId, decision: "allow", approvalCode: shown[0]!.approvalCode });
    expect(readFileSync(pairingFile, "utf8")).not.toContain(bare);
  });

  it("a flooded agent refuses NEW pairings without disturbing the one already in flight", async () => {
    const { shown, presenter } = capturingPresenter();
    const { port } = await startServer({ presenter, maxPendingRequests: 2 });

    // The human's real request — they are reading this code off the console right now.
    const real = await (await post(port, "/bridge/pair/request", { workspaceLabel: "우리 회사" })).json();
    const realCode = shown[0]!.approvalCode;
    await post(port, "/bridge/pair/request", { workspaceLabel: "filler" });
    const presentedBeforeFlood = shown.length;

    // A local process sprays requests, spoofing the allowed Origin as it pleases.
    for (let i = 0; i < 10; i += 1) {
      const res = await post(port, "/bridge/pair/request", { workspaceLabel: `flood-${i}` });
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: "pairing_busy" });
    }

    // The cap is enforced BEFORE the presenter: the flood put not one extra prompt in front of the human.
    // Without that ordering the refusal would still leak 10 interruptions, which is most of the attack.
    expect(shown).toHaveLength(presentedBeforeFlood);

    // And the in-flight consent is untouched: the code the human is holding still pairs.
    const ok = await confirmNoOrigin(port, { requestId: real.requestId, decision: "allow", approvalCode: realCode });
    expect(ok.status).toBe(200);
    const poll = await (await post(port, "/bridge/pair/poll", { requestId: real.requestId })).json();
    expect(poll.status).toBe("paired");
    expect(typeof poll.pairingToken).toBe("string");
  });

  it("the busy refusal is distinct from the fail-closed one, and leaks nothing about the flood", async () => {
    const { presenter } = capturingPresenter();
    const { port } = await startServer({ presenter, maxPendingRequests: 1 });
    clearLogSink();

    await post(port, "/bridge/pair/request", { workspaceLabel: "real" });
    const res = await post(port, "/bridge/pair/request", { workspaceLabel: "flood" });

    // `pairing_busy` (temporary, retryable) must not be confused with `approval_unavailable` (no human
    // channel exists at all) — they call for different words in the frontend.
    const body = await res.json();
    expect(body).toEqual({ error: "pairing_busy" });
    // The response tells the caller nothing it did not already know: no id, no code, no capacity numbers.
    expect(Object.keys(body)).toEqual(["error"]);

    const refusals = getLogSink().filter((e) => e.event === "bridge_pair_refused");
    expect(refusals).toHaveLength(1);
    // Counts are what an operator needs to tell a flood from a person retrying; identifiers are not, and the
    // sanitization contract keeps them out of the sink.
    expect(refusals[0]!.meta).toEqual({ reason: "pending_limit", pending: 1, limit: 1 });
    expect(JSON.stringify(refusals[0])).not.toContain("flood");
    expect(JSON.stringify(refusals[0])).not.toContain(APP);
  });

  it("a resolved request frees its slot — busy is temporary, not a wedged-shut agent", async () => {
    const { presenter } = capturingPresenter();
    const { port } = await startServer({ presenter, maxPendingRequests: 1 });

    const a = await (await post(port, "/bridge/pair/request", { workspaceLabel: "a" })).json();
    expect((await post(port, "/bridge/pair/request", { workspaceLabel: "b" })).status).toBe(503);

    // The human clicks 거부. That request is resolved, so it is no longer live consent holding the slot.
    // (Recovery via TTL expiry is the same sweep, covered hermetically in pairing-approval.test.ts — this
    // server drives a real clock and cannot advance it.)
    expect((await confirmNoOrigin(port, { requestId: a.requestId, decision: "deny" })).status).toBe(200);
    expect((await post(port, "/bridge/pair/request", { workspaceLabel: "c" })).status).toBe(200);
  });

  it("the durable store schema is unchanged (no approval field persisted)", async () => {
    const { shown, presenter } = capturingPresenter();
    const { port, pairingFile } = await startServer({ presenter });
    const req = await (await post(port, "/bridge/pair/request", { workspaceLabel: "w" })).json();
    await confirmNoOrigin(port, { requestId: req.requestId, decision: "allow", approvalCode: shown[0]!.approvalCode });

    const persisted = JSON.parse(readFileSync(pairingFile, "utf8"));
    expect(Array.isArray(persisted)).toBe(true);
    // Existing pairings keep loading on an older/newer build — no migration, no re-pair.
    expect(Object.keys(persisted[0]).sort()).toEqual(["createdAtMs", "origin", "pairingId", "revoked", "tokenHash"]);
  });
});
