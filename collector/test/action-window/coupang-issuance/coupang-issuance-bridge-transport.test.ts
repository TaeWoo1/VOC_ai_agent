/**
 * **Coupang WING issuance guidance over the REAL Bridge WebSocket, via the real boot composition.**
 *
 * This is the offline end-to-end proof for the *browser product path*: the SellerOps frontend discovers the
 * Local Agent bridge (a loopback port), pairs (request → confirm → poll), mints a single-use WS ticket, opens
 * `/bridge/ws`, receives the `aw_session` announcement (carrier `issuance`, channelCode `coupang`), and drives
 * a real `API_ISSUANCE_GUIDANCE` run with `START_RUN` + `REQUEST_STEP_RECHECK` to `COMPLETED` — all against the
 * SYNTHETIC {@link CoupangIssuanceFixtureDriver} (no browser, no live WING, no credential read).
 *
 * It boots through {@link createAgentBridge} exactly as `local-agent.ts` does for the
 * `--dev-action-window-coupang-issuance` host, and drives the socket with a v2 frame-level FE stand-in — the
 * same handshake, ticket, and `{type:"aw"}` carrier a browser uses. So "the FE ↔ agent pairing + bridge
 * discovery works for Coupang" is proven here without a CLI and without opening real WING.
 *
 * Offline and hermetic: only real LOOPBACK sockets, no network/backend/marketplace, temp pairing dir. The
 * NAVER carrier is byte-untouched (its own suite `naver-bridge-transport.test.ts` stays green).
 */
import { afterEach, describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import WebSocket from "ws";
import {
  ACTION_WINDOW_PROTOCOL_VERSION,
  findProhibitedFields,
  validateEventEnvelope,
  validateRunView,
  type ActionWindowRunView,
} from "../../../../contracts/action-window/v2/index";
import {
  ACTION_WINDOW_TRANSPORT_VERSION,
  deserializeFrame,
  serializeFrame,
  type AwClientFrame,
  type AwServerFrame,
} from "../../../../contracts/action-window/v2/transport";
import { AW_CARRIER_ISSUANCE } from "../../../../contracts/action-window/aw-carrier-kind";
import { createAgentBridge, type AgentBridge, type AgentCoupangIssuanceConfig } from "../../../src/agent/agent-bridge";
import {
  CoupangIssuanceFixtureDriver,
  type CoupangIssuanceFixtureScript,
} from "../../../src/action-window/coupang-issuance/coupang-issuance-fixture-driver";
import { connect, readMessages, fakeApprovalPresenter } from "../../bridge/helpers";

/** Stands in for the human console — pairing is fail-closed without a presenter. */
const approval = fakeApprovalPresenter();

const APP = "http://localhost:5173";

/** Nothing selector-, WING-URL-, or credential-shaped may cross the wire. */
const FORBIDDEN_NEEDLES = [
  "data-aw-target",
  "wing.coupang.com",
  "accesskey",
  "secretkey",
  "업체코드",
  "https://",
  "http://",
  tmpdir(),
];

function expectNoNeedle(value: unknown, label: string): void {
  const lower = JSON.stringify(value).toLowerCase();
  for (const needle of FORBIDDEN_NEEDLES) {
    expect(lower.includes(needle.toLowerCase()), `${label} leaked "${needle}"`).toBe(false);
  }
}

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

interface CoupangBridgeHandle {
  bridge: AgentBridge;
  port: number;
  runId: string;
  pairingFile: string;
}

/** Boot the Coupang issuance carrier through the real composition root over a loopback port. */
async function bootCoupangBridge(script: CoupangIssuanceFixtureScript = {}): Promise<CoupangBridgeHandle> {
  const base = mkdtempSync(join(tmpdir(), `aw-coupang-ws-${randomUUID()}-`));
  cleanups.push(() => rmSync(base, { recursive: true, force: true }));
  const pairingFile = join(base, "pairings.json");
  const runId = `run_${randomBytes(6).toString("hex")}`;
  const coupangIssuance: AgentCoupangIssuanceConfig = {
    runId,
    channelCode: "coupang",
    createDriver: () => new CoupangIssuanceFixtureDriver(script),
  };
  const bridge = createAgentBridge({
    port: 0, // ephemeral — the client discovers the actual port from listen()
    allowedOrigins: [APP],
    pairingFile,
    agentVersion: "test",
    refSalt: "test-salt",
    now: () => Date.now(),
    coupangIssuance,
    approvalPresenter: approval.presenter,
  });
  const listen = await bridge.listen();
  if (!listen.ok) throw new Error("bridge failed to listen");
  cleanups.push(async () => bridge.close());
  return { bridge, port: listen.port, runId, pairingFile };
}

function post(port: number, path: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: APP, ...headers },
    body: JSON.stringify(body),
  });
}

async function pairToken(port: number): Promise<string> {
  const req = await (await post(port, "/bridge/pair/request", { workspaceLabel: "테스트" })).json();
  await post(
    port,
    "/bridge/pair/confirm",
    { requestId: req.requestId, decision: "allow", approvalCode: approval.lastCode() },
    { Origin: `http://127.0.0.1:${port}` },
  );
  const poll = await (await post(port, "/bridge/pair/poll", { requestId: req.requestId })).json();
  return poll.pairingToken as string;
}

async function mintTicket(port: number, token: string): Promise<Response> {
  return post(port, "/bridge/ws-ticket", { clientProtocolVersion: 1 }, { Authorization: `Bearer ${token}` });
}

async function waitFor<T>(get: () => T | undefined | null | false, timeoutMs = 8000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = get();
    if (v) return v as T;
    if (Date.now() - start > timeoutMs) throw new Error("waitFor: condition not met in time");
    await new Promise((r) => setTimeout(r, 10));
  }
}

interface Announcement {
  carrier: string;
  type: string;
  transportVersion: number;
  runId: string;
  channelCode: string;
}

/** v2 frame-level FE stand-in over the REAL socket. */
class CoupangWireClient {
  announcement: Announcement | null = null;
  view: ActionWindowRunView | null = null;
  serverFrames: AwServerFrame[] = [];
  commandResults: Array<{ commandId: string; accepted: boolean; reason?: string }> = [];
  private cmdSeq = 0;

  constructor(readonly ws: WebSocket, public runId: string, private readonly label = "c") {
    ws.on("message", (data: WebSocket.RawData, isBinary: boolean) => {
      if (isBinary) return;
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(data.toString()) as Record<string, unknown>;
      } catch {
        return;
      }
      if (msg.type === "aw_session") {
        this.announcement = msg as unknown as Announcement;
        return;
      }
      if (msg.type !== "aw" || typeof msg.payload !== "string") return;
      const frame = deserializeFrame(msg.payload) as AwServerFrame;
      this.serverFrames.push(frame);
      switch (frame.kind) {
        case "aw_view":
          if (this.view === null || frame.view.revision >= this.view.revision) this.view = frame.view;
          break;
        case "aw_command_result":
          this.commandResults.push({ commandId: frame.commandId, accepted: frame.accepted, reason: frame.reason });
          break;
        case "aw_resync_result":
          if (frame.view) this.view = frame.view;
          break;
      }
    });
  }

  private sendFrame(frame: AwClientFrame): void {
    this.ws.send(JSON.stringify({ type: "aw", payload: serializeFrame(frame) }));
  }
  send(type: string, payload?: Record<string, unknown>, expectedRevision = this.view?.revision ?? 0): void {
    this.sendFrame({
      kind: "aw_command",
      command: {
        protocolVersion: ACTION_WINDOW_PROTOCOL_VERSION,
        commandId: `${this.runId}-${this.label}${++this.cmdSeq}-${randomUUID().slice(0, 8)}`,
        runId: this.runId,
        expectedRevision,
        type: type as never,
        ...(payload ? { payload: payload as never } : {}),
      },
    });
  }
  startRun(expectedRevision = 0): void {
    this.send("START_RUN", { channelCode: "coupang", intent: "API_ISSUANCE_GUIDANCE" }, expectedRevision);
  }
  resync(sinceSequence = 0, runId = this.runId): void {
    this.sendFrame({ kind: "aw_resync", runId, sinceSequence });
  }
  close(): void {
    try {
      this.ws.close();
    } catch {
      /* already closed */
    }
  }
}

async function openClient(handle: CoupangBridgeHandle, token?: string, label = "c") {
  const t = token ?? (await pairToken(handle.port));
  const ticketRes = await mintTicket(handle.port, t);
  const ticket = (await ticketRes.json()).ticket as string;
  const up = await connect({ port: handle.port, path: `/bridge/ws?ticket=${ticket}`, origin: APP });
  expect(up.status).toBe(101);
  const initial = await readMessages(up.ws!, 3); // hello, snapshot, aw_session
  const ann = (initial.find((m) => m.type === "aw_session") as unknown as Announcement | undefined) ?? null;
  const runId = ann?.runId ?? "";
  const client = new CoupangWireClient(up.ws!, runId, label);
  client.announcement = ann;
  cleanups.push(() => client.close());
  return { client, token: t, runId };
}

/** FALLBACK/RECOVERY drive: press "다음" (REQUEST_STEP_RECHECK) to release a HELD checkpoint (one whose WING-
 * resident press the test suppressed with `action:false`); the remaining checkpoints then complete on their own
 * default WING-resident presses. In the product path the seller advances on the WING page — this is only used
 * here to finish a run the test deliberately parked, and to prove the FE fallback still advances a checkpoint. */
async function driveToCompleted(client: CoupangWireClient, session: { whenSettled(): Promise<void> }): Promise<void> {
  for (let i = 0; i < 16 && client.view?.status !== "COMPLETED"; i++) {
    const before = client.view?.revision ?? -1;
    client.send("REQUEST_STEP_RECHECK");
    await session.whenSettled();
    await waitFor(() => (client.view?.revision ?? -1) > before || client.view?.status === "COMPLETED");
  }
}

function assertSanitizedWire(client: CoupangWireClient, label: string): void {
  expect(client.announcement).not.toBeNull();
  expect(findProhibitedFields(client.announcement)).toEqual([]);
  for (const frame of client.serverFrames) {
    expect(findProhibitedFields(frame)).toEqual([]);
    if (frame.kind === "aw_event") expect(validateEventEnvelope(frame.event)).toEqual({ ok: true });
    if (frame.kind === "aw_view") expect(validateRunView(frame.view)).toEqual({ ok: true });
  }
  expectNoNeedle(client.serverFrames, label);
}

describe("Coupang issuance carrier over the real Bridge WS (dev-host boot wiring)", () => {
  it("announces carrier issuance + channelCode coupang after hello+snapshot with the transport version", async () => {
    const handle = await bootCoupangBridge();
    const { client, runId } = await openClient(handle);
    const ann = await waitFor(() => client.announcement);
    expect(ann).toEqual({
      carrier: AW_CARRIER_ISSUANCE,
      type: "aw_session",
      transportVersion: ACTION_WINDOW_TRANSPORT_VERSION,
      runId,
      channelCode: "coupang",
    });
    // The hosted run identity is the one the boot minted — the client never chooses it.
    expect(runId).toBe(handle.runId);
  });

  it("drives the full guided walk to COMPLETED over the wire on WING-RESIDENT advances ALONE (a single START_RUN, no FE 다음), sanitized throughout", async () => {
    const handle = await bootCoupangBridge();
    const session = handle.bridge.coupangIssuanceSession!;
    const { client } = await openClient(handle);
    await waitFor(() => client.announcement);

    // A SINGLE FE START_RUN — the runtime then drives the whole walk (reach → 자체개발 → 업체명 → 호출 IP → 발급 →
    // copy keys → return) to COMPLETED as the seller presses each WING-RESIDENT advance button on the WING page
    // (the synthetic driver's default). No REQUEST_STEP_RECHECK is ever sent: the FE never drives a step.
    client.startRun();
    await session.whenSettled();
    await waitFor(() => client.view?.status === "COMPLETED");
    expect(client.view?.status).toBe("COMPLETED");
    expect(client.view?.blocker).toBeUndefined();
    expect(client.view?.intent).toBe("API_ISSUANCE_GUIDANCE");
    expect(client.view?.channelCode).toBe("coupang");
    expect(client.view?.executionMode).toBe("ACTION_WINDOW");

    // On its way to COMPLETED the run rested at the WAITING_FOR_HUMAN checkpoints (each step waited for the seller).
    const statuses = client.serverFrames
      .filter((f) => f.kind === "aw_view")
      .map((f) => (f as { view: ActionWindowRunView }).view.status);
    expect(statuses).toContain("WAITING_FOR_HUMAN");
    // PROOF the FE never drove a step: the ONLY command it sent (and got a result for) was the single START_RUN.
    expect(client.commandResults).toHaveLength(1);

    // Every frame that crossed the real (serialize/deserialize) wire is contract-valid and value-free.
    assertSanitizedWire(client, "coupang-ws-happy");
  });

  it("reattaches a refreshed/reconnected client to the SAME run — never a duplicate run, never a splice", async () => {
    // Hold the walk at the 호출 IP checkpoint (suppress its WING-resident press) so there is a stable mid-run state
    // to reattach to — otherwise the walk would auto-complete before the tab could refresh.
    const handle = await bootCoupangBridge({ action: { call_ip: false } });
    const session = handle.bridge.coupangIssuanceSession!;
    const { client, token, runId } = await openClient(handle);
    await waitFor(() => client.announcement);
    client.startRun();
    await session.whenSettled();
    await waitFor(() => client.view?.status === "WAITING_FOR_HUMAN");
    const midRevision = client.view!.revision;

    // The browser tab refreshes: the socket drops, a fresh socket opens with the SAME stored token.
    client.close();
    const { client: rejoined, runId: rejoinedRunId } = await openClient(handle, token, "r");
    await waitFor(() => rejoined.announcement);
    // The announcement re-binds to the SAME hosted run — the client can never be spliced onto a different run.
    expect(rejoinedRunId).toBe(runId);
    expect(rejoined.announcement?.runId).toBe(runId);

    // A resync from 0 republishes the SAME run's live view (in-progress, not a fresh PREPARING) — no re-START.
    rejoined.resync(0);
    await waitFor(() => rejoined.view !== null);
    expect(rejoined.view?.runId).toBe(runId);
    expect(rejoined.view!.revision).toBeGreaterThanOrEqual(midRevision);
    expect(rejoined.view?.status).not.toBe("COMPLETED");

    // The reattached client drives the SAME run to completion — proving reattach, not a second run.
    await driveToCompleted(rejoined, session);
    expect(rejoined.view?.status).toBe("COMPLETED");
    expect(rejoined.view?.runId).toBe(runId);
    assertSanitizedWire(rejoined, "coupang-ws-reattach");
  });

  it("a replayed START_RUN is idempotent — the same run, no revision jump, no second run", async () => {
    // Hold the walk at the first checkpoint (자체개발) so the run rests at a stable revision the duplicate
    // START_RUN can be checked against (otherwise it would auto-complete before the replay).
    const handle = await bootCoupangBridge({ action: { self_dev: false } });
    const session = handle.bridge.coupangIssuanceSession!;
    const { client, runId } = await openClient(handle);
    await waitFor(() => client.announcement);

    client.startRun();
    await session.whenSettled();
    await waitFor(() => client.view?.status === "WAITING_FOR_HUMAN");
    const revAfterStart = client.view!.revision;

    // A duplicate START_RUN (double-click / re-mount) against the fresh revision must not re-start or advance.
    client.startRun(revAfterStart);
    await session.whenSettled();
    await new Promise((r) => setTimeout(r, 30));
    expect(client.view?.runId).toBe(runId);
    expect(client.view!.revision).toBe(revAfterStart);

    // The run is still drivable to completion afterwards (the replay left it healthy).
    await driveToCompleted(client, session);
    expect(client.view?.status).toBe("COMPLETED");
  });

  it("rejects a WS ticket minted from a wrong/absent pairing token (fails closed)", async () => {
    const handle = await bootCoupangBridge();
    // A bogus bearer token cannot mint a ticket — the ws-ticket endpoint refuses (no ticket issued).
    const res = await mintTicket(handle.port, "not-a-real-token");
    expect(res.ok).toBe(false);
    const body = await res.json().catch(() => ({}));
    expect(body.ticket).toBeUndefined();
  });

  it("rejects a WS upgrade carrying a bogus ticket (single-use ticket is enforced at the socket)", async () => {
    const handle = await bootCoupangBridge();
    const up = await connect({ port: handle.port, path: `/bridge/ws?ticket=${randomUUID()}`, origin: APP });
    expect(up.status).not.toBe(101);
  });
});
