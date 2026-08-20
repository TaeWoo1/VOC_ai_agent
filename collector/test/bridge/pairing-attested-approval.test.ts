/**
 * **Pairing through an ATTESTING approval channel** — the production macOS path, end to end over real
 * loopback HTTP (no browser, no dialog: the presenter is faked, the server is real).
 *
 * The property under test is the one the product intent turns on: when the human answers in a surface the
 * agent itself owns, the seller never transports a code — and yet nothing about the verification is skipped.
 * The bridge still calls the same `confirmPairing(allow, secret)` a retyped code goes through, still persists
 * before committing, and still refuses everything it refused before. What disappears is the retyping, and
 * with it the code screen, the confirmation tab, and the terminal.
 *
 * The DEV (non-attesting) presenter path is asserted here too, in the same file, because "we did not quietly
 * change the other one" is exactly the claim a reader needs and it is cheapest to prove side by side.
 */
import { afterEach, describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { BridgeServer } from "../../src/bridge/bridge-server";
import { FilePairingStore } from "../../src/bridge/pairing-store";
import type { ApprovalPresenter } from "../../src/bridge/approval-presenter";
import { clearLogSink, getLogSink } from "../../src/log";
import { attestingApprovalPresenter, fakeApprovalPresenter } from "./helpers";

const APP = "http://localhost:5173";
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
  clearLogSink();
});

async function startServer(presenter: ApprovalPresenter) {
  const dir = mkdtempSync(join(tmpdir(), `bridge-attest-${randomUUID()}-`));
  const path = join(dir, "pairings.json");
  const store = new FilePairingStore(path, { now: () => Date.now() });
  const server = new BridgeServer({
    store,
    allowedOrigins: [APP],
    agentVersion: "test",
    port: 0,
    autoApprovePairing: false,
    approvalPresenter: presenter,
  });
  const { port } = await server.listen();
  cleanups.push(async () => { await server.close(); rmSync(dir, { recursive: true, force: true }); });
  return { server, port, store, path };
}

function post(port: number, p: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`http://127.0.0.1:${port}${p}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: APP, ...headers },
    body: JSON.stringify(body),
  });
}

const request = (port: number) => post(port, "/bridge/pair/request", { workspaceLabel: "우리 회사" });
const poll = (port: number, requestId: string) => post(port, "/bridge/pair/poll", { requestId });

describe("attested approval — the seller answers the dialog and nothing else", () => {
  it("pairs on the dialog verdict alone: the poll hands over a token with no code ever typed", async () => {
    const { port } = await startServer(attestingApprovalPresenter().presenter);

    const res = await request(port);
    expect(res.status).toBe(200);
    const body = await res.json();

    // The request call itself already settled the approval — no second HTTP call, no code, no confirm page.
    expect(body.attested).toBe(true);
    expect(body.confirmUrl).toBeUndefined();
    expect(body.confirmationCode).toBeUndefined();

    const paired = await (await poll(port, body.requestId)).json();
    expect(paired.status).toBe("paired");
    expect(typeof paired.pairingToken).toBe("string");
    expect(paired.pairingToken.length).toBeGreaterThan(32);
  });

  it("the delivered token is a REAL credential — it mints a WS ticket", async () => {
    const { port } = await startServer(attestingApprovalPresenter().presenter);
    const body = await (await request(port)).json();
    const { pairingToken } = await (await poll(port, body.requestId)).json();

    const ticket = await post(port, "/bridge/ws-ticket", { clientProtocolVersion: 1 }, { Authorization: `Bearer ${pairingToken}` });
    expect(ticket.status).toBe(200);
    expect(typeof (await ticket.json()).ticket).toBe("string");
  });

  it("survives a restart: the pairing was persisted BEFORE the token was handed out", async () => {
    const { port, path } = await startServer(attestingApprovalPresenter().presenter);
    const body = await (await request(port)).json();
    await poll(port, body.requestId);

    // Persist-then-commit means the durable record exists by the time the seller is connected — not on some
    // later flush. Read the file directly rather than trusting a second in-process call.
    const stored = JSON.parse(readFileSync(path, "utf8"));
    const pairings = stored.pairings ?? stored;
    expect(JSON.stringify(pairings)).toContain(APP);
  });

  it("the approval secret never leaves the process — not in the response, not in the log", async () => {
    const sink = getLogSink();
    const attest = attestingApprovalPresenter();
    const { port } = await startServer(attest.presenter);

    const raw = await (await request(port)).text();
    const code = attest.shown[0]!.approvalCode;
    const normalized = code.replace("-", "");

    // The presenter was handed the secret (it is the channel), but nothing else may carry it.
    expect(raw).not.toContain(code);
    expect(raw).not.toContain(normalized);
    const logged = JSON.stringify(sink);
    expect(logged).not.toContain(code);
    expect(logged).not.toContain(normalized);
  });

  it("records the pairing as attested, so an operator can tell the two channels apart", async () => {
    const sink = getLogSink();
    const { port } = await startServer(attestingApprovalPresenter().presenter);
    await request(port);

    const confirmed = sink.find((e) => e.event === "bridge_pair_confirmed");
    expect(confirmed?.meta).toMatchObject({ ok: true, allowed: true, attested: true });
  });
});

describe("attested approval — refusal and silence are NOT approvals", () => {
  it("[거부] → 403 approval_declined, and the request is dead on the spot", async () => {
    const { port } = await startServer(attestingApprovalPresenter({ status: "declined" }).presenter);

    const res = await request(port);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("approval_declined");
  });

  it("an unanswered dialog → 503 approval_no_response — told apart from a machine that cannot ask", async () => {
    // The two need OPPOSITE fixes ("you were away, try again" vs "this Mac cannot show the prompt"), so the
    // frontend must be able to distinguish them. Collapsing both into `approval_unavailable` would tell a
    // seller who simply walked away that their machine is broken.
    const { port } = await startServer(
      attestingApprovalPresenter({ status: "unavailable", reason: "no_response" }).presenter,
    );

    const res = await request(port);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("approval_no_response");
  });

  it("a channel that cannot reach anyone still reports approval_unavailable", async () => {
    const { port } = await startServer(
      attestingApprovalPresenter({ status: "unavailable", reason: "no_human_channel" }).presenter,
    );

    const res = await request(port);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("approval_unavailable");
  });

  it("a refused request cannot be resurrected by polling it", async () => {
    // The requestId is returned to the caller in neither refusal, but a caller that guessed one must still
    // find nothing. Poll with the id the presenter saw — the only place it exists.
    const attest = attestingApprovalPresenter({ status: "declined" });
    const { port } = await startServer(attest.presenter);
    await request(port);

    const requestId = attest.shown[0]!.requestId;
    const p = await (await poll(port, requestId)).json();
    expect(p.status).not.toBe("paired");
    expect(p.pairingToken).toBeUndefined();
  });
});

describe("the DEV terminal channel is untouched", () => {
  it("a non-attesting presenter still returns a code and a confirmation page, and does NOT pair by itself", async () => {
    const dev = fakeApprovalPresenter(); // returns `presented`, like the stderr adapter
    const { port } = await startServer(dev.presenter);

    const body = await (await request(port)).json();
    expect(body.attested).toBeUndefined();
    expect(body.confirmationCode).toMatch(/^[0-9A-F]{3}-[0-9A-F]{3}$/);
    expect(body.confirmUrl).toContain("/bridge/confirm?requestId=");

    // Still pending: on this channel the human has not answered anything yet.
    expect((await (await poll(port, body.requestId)).json()).status).toBe("pending");

    // …and the old two-step completes exactly as before.
    await post(
      port,
      "/bridge/pair/confirm",
      { requestId: body.requestId, decision: "allow", approvalCode: dev.lastCode() },
      { Origin: `http://127.0.0.1:${port}` },
    );
    expect((await (await poll(port, body.requestId)).json()).status).toBe("paired");
  });

  it("the code still gates the DEV path — a wrong one does not pair", async () => {
    const dev = fakeApprovalPresenter();
    const { port } = await startServer(dev.presenter);
    const body = await (await request(port)).json();

    await post(
      port,
      "/bridge/pair/confirm",
      { requestId: body.requestId, decision: "allow", approvalCode: "0000-0000" },
      { Origin: `http://127.0.0.1:${port}` },
    );
    expect((await (await poll(port, body.requestId)).json()).status).toBe("pending");
  });
});
