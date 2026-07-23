/**
 * **Cross-stack hermetic E2E — the REAL frontend reply runtime against the REAL agent-hosted REPLY
 * carrier.** The v2 counterpart of `fe-transport-real-bridge.test.ts` (which proves the v1 export
 * carrier). Every other reply test proves ONE side against a stand-in: the collector's
 * `reply-session.test.ts` drives the real `ReplySubmitSession` over the in-process v2 loopback, while
 * the frontend's `reply/*.test.ts` drive the real reply runtime against a fake transport. Neither
 * crosses a real socket between the two. This suite closes that gap: it imports the ACTUAL frontend
 * modules —
 *   - `wsTransport.ts`        → `connectAwBridgeSession` (ticket mint, `aw_session` carrier gate with
 *                               `expectedCarrier: reply`, opaque `{type:"aw"}` framing),
 *   - `replyFrameTransport.ts`→ `createReplyFrameTransport` (envelope↔frame adapter),
 *   - `replyRuntime.ts`       → `createBridgeReplyRuntime` (acknowledged START_RUN, single-settle
 *                               report, dispose-to-zero),
 * and runs them over a genuine `BridgeServer` + `ReplySubmissionEndpoint` (the REAL agent announcement,
 * `carrier: "reply"`) + `ReplySubmitSession` + `ReplyEngine` + a synthetic reply driver, connected by a
 * real `ws` loopback socket. It mirrors `connectGuidedReplyRuntime` exactly MINUS the `import.meta.env`
 * DEV gate (which only a browser could exercise) — the same shape the export cross-stack test uses.
 *
 * Hermetic & synthetic: no browser, no marketplace, NO NAVER contact, no backend, no credentials, no
 * real run/seller data. The seller's submit is delivered by the test driver (`completeSubmit`) — the
 * Runtime never clicks or submits. No production code is changed. No carrier mode switching.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";

// ── collector (runtime + bridge) — the REAL agent side ───────────────────────
import { BridgeServer } from "../../src/bridge/bridge-server";
import { fakeApprovalPresenter } from "../bridge/helpers";
import { FilePairingStore } from "../../src/bridge/pairing-store";
import { ReplySubmissionEndpoint } from "../../src/bridge/reply-submission-endpoint";
import { ReplyEngine, makeReplyClock } from "../../src/action-window/reply-submission/reply-engine";
import { ReplySubmitSession } from "../../src/action-window/reply-submission/reply-session";
import { SyntheticReplySubmitDriver } from "../../src/action-window/reply-submission/reply-driver";

// ── frontend — the REAL client side (imported, never modified) ───────────────
import { connectAwBridgeSession, type AwWsDeps } from "../../../frontend/src/lib/actionWindow/wsTransport";
import { createReplyFrameTransport } from "../../../frontend/src/lib/actionWindow/reply/replyFrameTransport";
import {
  createBridgeReplyRuntime,
  ReplyReportRejectedError,
  ReplyRuntimeDisposedError,
  ReplyStartRejectedError,
} from "../../../frontend/src/lib/actionWindow/reply/replyRuntime";
import type { AwClientTransport as AwClientTransportV2 } from "../../../contracts/action-window/v2/transport";
import { AW_CARRIER_REPLY, AW_CARRIER_EXPORT, type AwCarrierKind } from "../../../contracts/action-window/aw-carrier-kind";
import { BRIDGE_TOKEN_KEY, type StorageLike, type WebSocketLike } from "../../../frontend/src/lib/bridge/bridgeClient";

const APP = "http://localhost:5173";
const approval = fakeApprovalPresenter();
const RUN_ID = "run_reply_crossstack";
const CHANNEL = "naver";
const SUBMISSION_REF = "a1b2c3d4e5f60718";

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

// ── One real BridgeServer hosting one REPLY-carrier run ──────────────────────
async function startReplyServer(opts?: { announcing?: boolean; carrier?: "reply" | "export" }) {
  const dir = mkdtempSync(join(tmpdir(), `aw-reply-crossstack-${randomUUID()}-`));
  const store = new FilePairingStore(join(dir, "pairings.json"), { now: () => Date.now() });
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));

  const driver = new SyntheticReplySubmitDriver();
  const engine = new ReplyEngine({ runId: RUN_ID, channelCode: CHANNEL }, { clock: makeReplyClock() });
  // The export cross-stack test proves the v1 endpoint; for the "wrong carrier" case we still host the
  // REPLY endpoint but with a reply client declaring `export` — the mismatch is symmetric either way.
  const endpoint = new ReplySubmissionEndpoint({ runId: RUN_ID, channelCode: CHANNEL });
  if (opts?.announcing === false) endpoint.setAnnouncing(false);
  const session = new ReplySubmitSession(engine, driver, endpoint.transport);
  session.attach();

  const server = new BridgeServer({
    store, allowedOrigins: [APP], agentVersion: "test", port: 0,
    actionWindow: endpoint, approvalPresenter: approval.presenter,
  });
  const { port } = await server.listen();
  cleanups.push(async () => server.close());
  return { server, port, endpoint, driver, session };
}

// ── Browser-modelling injected transport (Origin header the browser adds automatically) ──────────
function makeBrowserDeps(port: number, opened: WebSocket[]): Pick<AwWsDeps, "fetchFn" | "wsFactory"> {
  const fetchFn = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
    fetch(String(input), { ...init, headers: { ...(init?.headers as Record<string, string> | undefined), Origin: APP } })) as typeof fetch;
  const wsFactory = (url: string): WebSocketLike => {
    const raw = new WebSocket(url, { origin: APP });
    opened.push(raw);
    const like: WebSocketLike = {
      onopen: null, onmessage: null, onclose: null, onerror: null,
      send: (data) => raw.send(data), close: () => raw.close(),
    };
    raw.on("open", () => like.onopen?.());
    raw.on("message", (data: WebSocket.RawData, isBinary: boolean) => { if (!isBinary) like.onmessage?.({ data: data.toString() }); });
    raw.on("close", () => like.onclose?.());
    raw.on("error", () => like.onerror?.());
    return like;
  };
  return { fetchFn, wsFactory };
}

function seededStorage(token: string): StorageLike {
  const map = new Map<string, string>([[BRIDGE_TOKEN_KEY, token]]);
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
}

function post(port: number, path: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: APP, ...headers }, body: JSON.stringify(body),
  });
}
async function pairToken(port: number): Promise<string> {
  const req = await (await post(port, "/bridge/pair/request", { workspaceLabel: "crossstack" })).json();
  await post(port, "/bridge/pair/confirm", { requestId: req.requestId, decision: "allow", approvalCode: approval.lastCode() }, { Origin: `http://127.0.0.1:${port}` });
  const poll = await (await post(port, "/bridge/pair/poll", { requestId: req.requestId })).json();
  return poll.pairingToken as string;
}

/** Compose the REAL FE reply stack over a real socket, exactly as connectGuidedReplyRuntime does. */
async function connectReplyRuntime(port: number, opened: WebSocket[], expectedCarrier: AwCarrierKind = AW_CARRIER_REPLY) {
  const token = await pairToken(port);
  const result = await connectAwBridgeSession({
    httpBase: `http://127.0.0.1:${port}`, wsBase: `ws://127.0.0.1:${port}`,
    storage: seededStorage(token), expectedCarrier, ...makeBrowserDeps(port, opened),
  });
  if (!result.ok) return result;
  const framesV2 = result.session.transport as unknown as AwClientTransportV2;
  // A test-side observer of the highest revision the socket has delivered to THIS client — the same
  // aw_event revision the runtime tracks internally. Lets a test wait for stage frames to propagate
  // over the real socket before reporting, mirroring the collector test's `await whenSettled()`.
  let observedRevision = 0;
  framesV2.subscribe((frame) => {
    if (frame.kind === "aw_event" && frame.event.revision > observedRevision) observedRevision = frame.event.revision;
  });
  const runtime = createBridgeReplyRuntime({ transport: createReplyFrameTransport(framesV2), runId: result.session.runId });
  return { ok: true as const, runtime, session: result.session, observedRevision: () => observedRevision };
}

/**
 * Wait until the observed revision SETTLES (stops climbing) — the run has reached its awaiting-report
 * state and the frames carrying that revision have arrived over the socket. This mirrors what a real
 * operator sees before clicking "report" (the panel has rendered the reportable state), and the
 * collector session test's `await whenSettled()`. Reporting before this yields a stale revision.
 */
async function waitForSettle(get: () => number, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  let last = -1;
  let stableFor = 0;
  while (stableFor < 6) {
    const now = get();
    stableFor = now === last && now > 0 ? stableFor + 1 : 0;
    last = now;
    if (Date.now() - start > timeoutMs) return;
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("cross-stack: FE reply runtime ↔ real agent-hosted REPLY carrier", () => {
  it("accepted START_RUN then accepted report → OPERATOR_REPORTED terminal", async () => {
    const opened: WebSocket[] = [];
    const { port, driver } = await startReplyServer();
    const c = await connectReplyRuntime(port, opened);
    expect(c.ok).toBe(true);
    if (!c.ok) return;

    // Acknowledged START_RUN: resolves only on the real engine's aw_command_result.
    const { runId } = await c.runtime.start({ channelCode: CHANNEL, submissionRef: SUBMISSION_REF });
    expect(runId).toBe(RUN_ID);

    // The seller performs their submit on the (synthetic) surface — an observation, not completion.
    driver.completeSubmit(true);

    // Let the stage frames (which carry the advancing revision the report must quote) settle over the
    // real socket before reporting — the runtime tracks revision from aw_event frames, and a report
    // that raced ahead of them would quote a stale revision. The collector's own session test gets
    // this for free via `await whenSettled()` on the in-process loopback; over a real socket the
    // client waits for the reportable state to arrive, exactly as the operator does.
    await waitForSettle(c.observedRevision);

    // Operator reports SUBMITTED → REQUEST_STEP_RECHECK → real engine terminates at OPERATOR_REPORTED.
    // The runtime reads the terminal back from the real RUN_OPERATOR_REPORTED event: outcome +
    // UNVERIFIED (a public reply has no read-back oracle — there is never a COMPLETED terminal).
    const terminal = await c.runtime.report(runId, "OPERATOR_REPORTED_SUBMITTED");
    expect(terminal.runId).toBe(RUN_ID);
    expect(terminal.operatorOutcome).toBe("OPERATOR_REPORTED_SUBMITTED");
    expect(terminal.verification).toBe("UNVERIFIED");
  });

  it("a START_RUN the real agent validator refuses is rejected immediately (not left to time out)", async () => {
    const opened: WebSocket[] = [];
    const { port } = await startReplyServer();
    const token = await pairToken(port);
    const result = await connectAwBridgeSession({
      httpBase: `http://127.0.0.1:${port}`, wsBase: `ws://127.0.0.1:${port}`,
      storage: seededStorage(token), expectedCarrier: AW_CARRIER_REPLY, ...makeBrowserDeps(port, opened),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Wrap the real transport so the START_RUN command reaches the socket with an INVALID submissionRef
    // (not the 16-hex an intent=REPLY_SUBMISSION run requires). This models a malformed/tampered START
    // hitting the agent's REAL `validateCommandEnvelope`, which answers `accepted:false` /
    // `INVALID_ENVELOPE` — the same wire path any refused START takes. The commandId is preserved so
    // the agent's refusal correlates back to the runtime's start listener.
    const realTransport = result.session.transport as unknown as AwClientTransportV2;
    const corrupting: AwClientTransportV2 = {
      ...realTransport,
      send: (frame) => {
        if (frame.kind === "aw_command" && frame.command.type === "START_RUN") {
          const corruptedPayload = { ...(frame.command.payload as Record<string, unknown>), submissionRef: "not-hex" };
          realTransport.send({ ...frame, command: { ...frame.command, payload: corruptedPayload } as typeof frame.command });
        } else {
          realTransport.send(frame);
        }
      },
    };
    const runtime = createBridgeReplyRuntime({ transport: createReplyFrameTransport(corrupting), runId: result.session.runId });
    await expect(runtime.start({ channelCode: CHANNEL, submissionRef: SUBMISSION_REF })).rejects.toBeInstanceOf(ReplyStartRejectedError);
    await runtime
      .start({ channelCode: CHANNEL, submissionRef: SUBMISSION_REF })
      .catch((e: ReplyStartRejectedError) => expect(e.reason).toBe("INVALID_ENVELOPE"));
    runtime.dispose();
    result.session.close();
  });

  it("a report before the run is reportable is rejected (INVALID_FOR_STATE), not left hanging", async () => {
    const opened: WebSocket[] = [];
    const { port } = await startReplyServer();
    const c = await connectReplyRuntime(port, opened);
    expect(c.ok).toBe(true);
    if (!c.ok) return;

    // Report WITHOUT starting: the engine rejects a non-START command before START with INVALID_FOR_STATE.
    await expect(c.runtime.report(RUN_ID, "OPERATOR_REPORTED_SUBMITTED")).rejects.toBeInstanceOf(ReplyReportRejectedError);
    // The rejection carries the agent's sanitized reason.
    await c.runtime
      .report(RUN_ID, "OPERATOR_REPORTED_SUBMITTED")
      .catch((e: ReplyReportRejectedError) => expect(e.reason).toBe("INVALID_FOR_STATE"));
  });

  it("a reply client that declares the EXPORT carrier is refused (carrier-mismatch)", async () => {
    const opened: WebSocket[] = [];
    const { port } = await startReplyServer();
    // The agent announces `reply`; a client declaring `export` must fail closed, never attach.
    const c = await connectReplyRuntime(port, opened, AW_CARRIER_EXPORT);
    expect(c.ok).toBe(false);
    if (c.ok) return;
    expect(c.reason).toBe("carrier-mismatch");
  });

  it("honest fallback: when the agent is not announcing the reply carrier, connect refuses (no runtime)", async () => {
    const opened: WebSocket[] = [];
    const { port } = await startReplyServer({ announcing: false });
    const c = await connectReplyRuntime(port, opened);
    // No announcement → the transport goes dormant and connect returns a refusal, which the hook turns
    // into "keep the honest fallback" rather than a half-attached live runtime.
    expect(c.ok).toBe(false);
  });

  it("reconnect refusal: if the reply carrier is gone after a drop, the transport goes dormant (never mis-splices)", async () => {
    const opened: WebSocket[] = [];
    const { port, endpoint } = await startReplyServer();
    const token = await pairToken(port);
    const statuses: string[] = [];
    const result = await connectAwBridgeSession({
      httpBase: `http://127.0.0.1:${port}`, wsBase: `ws://127.0.0.1:${port}`,
      storage: seededStorage(token), expectedCarrier: AW_CARRIER_REPLY,
      retryDelayMs: 20, maxReconnectAttempts: 2, sessionTimeoutMs: 300,
      onStatus: (s) => statuses.push(s), ...makeBrowserDeps(port, opened),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The agent stops hosting the reply carrier, then the live socket drops. The transport re-mints a
    // ticket and reopens, but the announcement never comes — so it exhausts its retries and goes
    // "offline" (dormant) rather than attaching to a carrier it can no longer confirm.
    endpoint.setAnnouncing(false);
    opened[opened.length - 1]?.close();

    const start = Date.now();
    while (!statuses.includes("offline") && Date.now() - start < 5000) await new Promise((r) => setTimeout(r, 20));
    expect(statuses).toContain("offline");
    result.session.close();
  });

  it("disposal (what the hook's unmount runs) rejects the in-flight report and drops the agent client to zero", async () => {
    const opened: WebSocket[] = [];
    const { port, endpoint } = await startReplyServer();
    const c = await connectReplyRuntime(port, opened);
    expect(c.ok).toBe(true);
    if (!c.ok) return;

    await c.runtime.start({ channelCode: CHANNEL, submissionRef: SUBMISSION_REF });
    // A report is in flight (the seller has not been driven to submit, so no terminal is coming).
    const inflight = c.runtime.report(RUN_ID, "OPERATOR_REPORTED_SUBMITTED");
    // handle.close() disposes the runtime FIRST (rejecting in-flight as DISPOSED), then the socket.
    c.runtime.dispose();
    c.session.close();
    await expect(inflight).rejects.toBeInstanceOf(ReplyRuntimeDisposedError);

    // The agent sees the client go: its hosted-run client count returns to zero.
    for (let i = 0; i < 200 && endpoint.clientCount() > 0; i++) await new Promise((r) => setTimeout(r, 10));
    expect(endpoint.clientCount()).toBe(0);

    // A later start/report on the disposed runtime fails closed rather than re-attaching.
    await expect(c.runtime.start({ channelCode: CHANNEL, submissionRef: SUBMISSION_REF })).rejects.toBeInstanceOf(ReplyRuntimeDisposedError);
  });
});
