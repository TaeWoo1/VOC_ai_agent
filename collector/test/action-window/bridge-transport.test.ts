/**
 * **Action Window over the REAL Bridge WebSocket (R2B synthetic E2E).** The loopback-channel E2E
 * (`session-integration.test.ts`) proved the command/event/view loop; this suite replaces the loopback
 * with the actual security path: a real `BridgeServer` on a loopback port, real pairing
 * (request → local confirm → poll), a single-use WS ticket, a real `ws` client, and the opaque
 * `{type:"aw"}` carrier — with the same `ActionWindowSession` + `SyntheticProbeDriver` on the far side.
 * Offline and hermetic: no browser, no backend, no live channel; the "user action" is delivered by the
 * test driver (`completeUserAction`), never by the Runtime.
 */
import { afterEach, describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import {
  ACTION_WINDOW_PROTOCOL_VERSION,
  findProhibitedFields,
  isDuplicateEvent,
  isOutOfOrderEvent,
  validateEventEnvelope,
  validateRunView,
  type ActionWindowRunView,
  type CommandEnvelope,
  type CommandType,
  type EventEnvelope,
} from "../../../contracts/action-window/v1/index";
import {
  ACTION_WINDOW_TRANSPORT_VERSION,
  deserializeFrame,
  serializeFrame,
  type AwClientFrame,
  type AwServerFrame,
} from "../../../contracts/action-window/v1/transport";
import { BridgeServer } from "../../src/bridge/bridge-server";
import { FilePairingStore } from "../../src/bridge/pairing-store";
import { ActionWindowEndpoint } from "../../src/bridge/action-window-endpoint";
import { ActionWindowEngine, type LocateResult } from "../../src/action-window/engine";
import { ActionWindowSession, SyntheticProbeDriver } from "../../src/action-window/session";
import { resolveActionWindowSynthetic, ACTION_WINDOW_SYNTHETIC_FLAG } from "../../src/cli/local-agent";
import { connect, readMessages, fakeApprovalPresenter } from "../bridge/helpers";

/** Stands in for the human console — pairing is fail-closed without a presenter. One shared instance per file: `lastCode()` is the most recent presentation, and request→confirm is sequential. */
const approval = fakeApprovalPresenter();

const APP = "http://localhost:5173";
const RUN_ID = "run_bridge_e2e";
const CHANNEL = "synthetic";
const RUN_COPY = "actionWindow.run.synthetic";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

async function startAwServer(opts: { locate?: LocateResult } = {}) {
  const dir = mkdtempSync(join(tmpdir(), `aw-bridge-${randomUUID()}-`));
  const store = new FilePairingStore(join(dir, "pairings.json"), { now: () => Date.now() });
  const driver = new SyntheticProbeDriver(opts.locate ? { locate: opts.locate } : {});
  const endpoint = new ActionWindowEndpoint({ runId: RUN_ID, channelCode: CHANNEL });
  const engine = new ActionWindowEngine({ runId: RUN_ID, channelCode: CHANNEL, runCopyKey: RUN_COPY });
  const session = new ActionWindowSession(engine, driver, endpoint.transport);
  session.attach();
  const server = new BridgeServer({
    store,
    allowedOrigins: [APP],
    agentVersion: "test",
    port: 0,
    actionWindow: endpoint,
    // Pairing is fail-closed in every environment: without an injected presenter the bridge refuses to pair.
    // This suite drives a real request→confirm→poll, so it stands in for the human console.
    approvalPresenter: approval.presenter,
  });
  const { port } = await server.listen();
  cleanups.push(async () => {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { server, port, store, driver, session, endpoint };
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
  await post(port, "/bridge/pair/confirm", { requestId: req.requestId, decision: "allow", approvalCode: approval.lastCode() }, { Origin: `http://127.0.0.1:${port}` });
  const poll = await (await post(port, "/bridge/pair/poll", { requestId: req.requestId })).json();
  return poll.pairingToken as string;
}

async function mintTicket(port: number, token: string): Promise<string> {
  const r = await (await post(port, "/bridge/ws-ticket", { clientProtocolVersion: 1 }, { Authorization: `Bearer ${token}` })).json();
  return r.ticket as string;
}

/** Poll until `get` yields a truthy value (real-wire delivery is asynchronous). */
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
  type: string;
  transportVersion: number;
  runId: string;
  channelCode: string;
}

/**
 * A frame-level FE stand-in over the REAL WebSocket: unwraps `{type:"aw"}` carriers, records the
 * `aw_session` announcement, and folds events/views like the real adapter (dedupe + revision guard).
 */
class AwWireClient {
  announcement: Announcement | null = null;
  view: ActionWindowRunView | null = null;
  events: EventEnvelope[] = [];
  serverFrames: AwServerFrame[] = [];
  commandResults: Array<{ commandId: string; accepted: boolean; reason?: string }> = [];
  resyncResults: Array<{ view: ActionWindowRunView | null; events: readonly EventEnvelope[] }> = [];
  lastSequence = 0;
  private readonly seenEventIds = new Set<string>();
  private cmdSeq = 0;

  constructor(readonly ws: WebSocket, private readonly label = "c") {
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
      if (msg.type !== "aw" || typeof msg.payload !== "string") return; // hello/snapshot/etc.
      const frame = deserializeFrame(msg.payload) as AwServerFrame;
      this.serverFrames.push(frame);
      switch (frame.kind) {
        case "aw_event":
          this.ingestEvent(frame.event);
          break;
        case "aw_view":
          this.adoptView(frame.view);
          break;
        case "aw_command_result":
          this.commandResults.push({ commandId: frame.commandId, accepted: frame.accepted, reason: frame.reason });
          break;
        case "aw_resync_result":
          this.resyncResults.push({ view: frame.view, events: frame.events });
          if (frame.view) this.adoptView(frame.view);
          for (const e of frame.events) this.ingestEvent(e);
          break;
      }
    });
  }

  private ingestEvent(e: EventEnvelope): void {
    if (isDuplicateEvent(e.eventId, this.seenEventIds)) return;
    if (isOutOfOrderEvent(e.sequence, this.lastSequence)) return;
    this.seenEventIds.add(e.eventId);
    this.lastSequence = e.sequence;
    this.events.push(e);
  }
  private adoptView(v: ActionWindowRunView): void {
    if (this.view === null || v.revision >= this.view.revision) this.view = v;
  }

  sendFrame(frame: AwClientFrame): void {
    this.ws.send(JSON.stringify({ type: "aw", payload: serializeFrame(frame) }));
  }
  send(type: CommandType, payload?: CommandEnvelope["payload"]): CommandEnvelope {
    const command: CommandEnvelope = {
      protocolVersion: ACTION_WINDOW_PROTOCOL_VERSION,
      commandId: `${RUN_ID}-${this.label}${++this.cmdSeq}`,
      runId: RUN_ID,
      expectedRevision: this.view?.revision ?? 0,
      type,
      ...(payload ? { payload } : {}),
    };
    this.sendFrame({ kind: "aw_command", command });
    return command;
  }
  resync(sinceSequence = this.lastSequence): void {
    this.sendFrame({ kind: "aw_resync", runId: RUN_ID, sinceSequence });
  }
  eventTypes(): string[] {
    return this.events.map((e) => e.type);
  }
  close(): void {
    try {
      this.ws.close();
    } catch {
      /* already closed */
    }
  }
}

/**
 * Pair, mint a single-use ticket, and open an authenticated real-WS client. The server pushes
 * hello + snapshot + aw_session SYNCHRONOUSLY right after the handshake (before a later listener could
 * attach), so the connect helper's persistent reader drains those three and we adopt the announcement
 * from there; the AwWireClient listener handles everything after.
 */
async function openClient(port: number, token?: string, label = "c"): Promise<{ client: AwWireClient; token: string }> {
  const t = token ?? (await pairToken(port));
  const ticket = await mintTicket(port, t);
  const up = await connect({ port, path: `/bridge/ws?ticket=${ticket}`, origin: APP });
  expect(up.status).toBe(101);
  const initial = await readMessages(up.ws!, 3); // hello, snapshot, aw_session
  const client = new AwWireClient(up.ws!, label);
  client.announcement = (initial.find((m) => m.type === "aw_session") as unknown as Announcement | undefined) ?? null;
  cleanups.push(async () => client.close());
  return { client, token: t };
}

/** Every aw frame that crossed the real wire must be contract-valid and carry no prohibited field. */
function assertSanitizedWire(client: AwWireClient): void {
  expect(client.announcement).not.toBeNull();
  expect(findProhibitedFields(client.announcement)).toEqual([]);
  for (const frame of client.serverFrames) {
    expect(findProhibitedFields(frame)).toEqual([]);
    if (frame.kind === "aw_event") expect(validateEventEnvelope(frame.event)).toEqual({ ok: true });
    if (frame.kind === "aw_view") expect(validateRunView(frame.view)).toEqual({ ok: true });
    if (frame.kind === "aw_resync_result") {
      if (frame.view) expect(validateRunView(frame.view)).toEqual({ ok: true });
      for (const e of frame.events) expect(validateEventEnvelope(e)).toEqual({ ok: true });
    }
  }
}

describe("Action Window over the real Bridge WS (R2B)", () => {
  it("announces the hosted run after hello+snapshot, with the transport version", async () => {
    const { port } = await startAwServer();
    const { client } = await openClient(port);
    const ann = await waitFor(() => client.announcement);
    expect(ann).toEqual({
      type: "aw_session",
      transportVersion: ACTION_WINDOW_TRANSPORT_VERSION,
      runId: RUN_ID,
      channelCode: CHANNEL,
    });
  });

  it("runs the full loop over the wire: start → checkpoint → test-driver action → recheck → completed", async () => {
    const { port, driver, session } = await startAwServer();
    const { client } = await openClient(port);
    await waitFor(() => client.announcement);

    // Resync before START_RUN: no started run → view null, no events (no state leaks pre-start).
    client.resync(0);
    await waitFor(() => client.resyncResults.length >= 1);
    expect(client.resyncResults[0]).toEqual({ view: null, events: [] });

    // 1) Start; the Runtime drives to the human checkpoint and stops.
    client.send("START_RUN", { channelCode: CHANNEL });
    await session.whenSettled();
    await waitFor(() => client.view?.status === "WAITING_FOR_HUMAN");
    expect(client.view?.executionMode).toBe("ACTION_WINDOW");
    expect(client.view?.currentStep?.status).toBe("AWAITING_USER");
    expect(client.view?.allowedCommands).toContain("REQUEST_STEP_RECHECK");
    const highlight = client.events.find((e) => e.type === "TARGET_HIGHLIGHTED");
    expect(highlight?.payload.targetRef).toMatch(/^[0-9a-f]{16}$/);
    // Observation has not happened; nothing completed from automation alone.
    expect(client.eventTypes()).not.toContain("USER_ACTION_OBSERVED");
    expect(client.eventTypes()).not.toContain("STEP_COMPLETED");

    // 2) The test driver reports the user's action (the Runtime never clicks). Observation ≠ completion.
    const revBeforeAction = client.view!.revision;
    driver.completeUserAction(true);
    await session.whenSettled();
    // Wait for the post-observation VIEW too (not just the event): the next command's expectedRevision
    // must come from the view that reflects the observation, or it would race into STALE_REVISION.
    await waitFor(() => client.eventTypes().includes("USER_ACTION_OBSERVED") && (client.view?.revision ?? 0) > revBeforeAction);
    expect(client.view?.status).toBe("WAITING_FOR_HUMAN");

    // 3) Recheck → verify → downstream → completed.
    client.send("REQUEST_STEP_RECHECK");
    await session.whenSettled();
    await waitFor(() => client.view?.status === "COMPLETED");
    expect(client.view?.progress).toEqual({ completedSteps: 3, totalSteps: 3 });
    expect(client.view?.blocker).toBeUndefined();
    expect(client.eventTypes()).toContain("RUN_COMPLETED");

    // Ordering across the real wire: strictly monotonic, gapless.
    const seqs = client.events.map((e) => e.sequence);
    expect(seqs).toEqual(seqs.map((_, i) => i + 1));
    // Every command was acknowledged and accepted.
    expect(client.commandResults.filter((r) => r.accepted)).toHaveLength(2);

    assertSanitizedWire(client);
  });

  it("restores the latest view and replays missed events after a reconnect (new ticket, same pairing)", async () => {
    const { port, driver, session, endpoint } = await startAwServer();
    const { client, token } = await openClient(port);
    await waitFor(() => client.announcement);
    client.send("START_RUN", { channelCode: CHANNEL });
    await session.whenSettled();
    await waitFor(() => client.view?.status === "WAITING_FOR_HUMAN");
    const seqBeforeDisconnect = client.lastSequence;

    // Drop the socket, then the user acts while the FE is offline — those frames are lost on the wire.
    client.close();
    await waitFor(() => endpoint.clientCount() === 0); // server has deregistered the socket
    driver.completeUserAction(true);
    await session.whenSettled();
    expect(client.eventTypes()).not.toContain("USER_ACTION_OBSERVED");

    // Reconnect with a FRESH single-use ticket minted from the SAME pairing token.
    const { client: rejoined } = await openClient(port, token, "r");
    await waitFor(() => rejoined.announcement);
    expect(rejoined.announcement?.runId).toBe(RUN_ID);
    rejoined.resync(seqBeforeDisconnect);
    await waitFor(() => rejoined.eventTypes().includes("USER_ACTION_OBSERVED"));
    expect(rejoined.view?.status).toBe("WAITING_FOR_HUMAN");
    expect(rejoined.lastSequence).toBeGreaterThan(seqBeforeDisconnect);

    // The rejoined client can finish the run.
    rejoined.send("REQUEST_STEP_RECHECK");
    await session.whenSettled();
    await waitFor(() => rejoined.view?.status === "COMPLETED");
    assertSanitizedWire(rejoined);
  });

  it("rejects a stale-revision command over the wire", async () => {
    const { port, session } = await startAwServer();
    const { client } = await openClient(port);
    await waitFor(() => client.announcement);
    client.send("START_RUN", { channelCode: CHANNEL });
    await session.whenSettled();
    await waitFor(() => client.view?.status === "WAITING_FOR_HUMAN");

    const stale: CommandEnvelope = {
      protocolVersion: ACTION_WINDOW_PROTOCOL_VERSION,
      commandId: "stale-1",
      runId: RUN_ID,
      expectedRevision: (client.view?.revision ?? 1) - 1,
      type: "SET_GUIDANCE_ENABLED",
      payload: { enabled: false },
    };
    client.sendFrame({ kind: "aw_command", command: stale });
    const result = await waitFor(() => client.commandResults.find((r) => r.commandId === "stale-1"));
    expect(result).toEqual({ commandId: "stale-1", accepted: false, reason: "STALE_REVISION" });
    expect(client.view?.guidanceEnabled).toBe(true); // unchanged
  });

  it("treats a replayed commandId as an idempotent no-op over the wire", async () => {
    const { port, session } = await startAwServer();
    const { client } = await openClient(port);
    await waitFor(() => client.announcement);
    client.send("START_RUN", { channelCode: CHANNEL });
    await session.whenSettled();
    await waitFor(() => client.view?.status === "WAITING_FOR_HUMAN");

    const cmd: CommandEnvelope = {
      protocolVersion: ACTION_WINDOW_PROTOCOL_VERSION,
      commandId: "dup-1",
      runId: RUN_ID,
      expectedRevision: client.view?.revision ?? 0,
      type: "SET_GUIDANCE_ENABLED",
      payload: { enabled: false },
    };
    client.sendFrame({ kind: "aw_command", command: cmd });
    await waitFor(() => client.commandResults.some((r) => r.commandId === "dup-1"));
    const revAfterFirst = await waitFor(() => (client.view?.guidanceEnabled === false ? client.view.revision : null));

    client.sendFrame({ kind: "aw_command", command: cmd }); // exact same envelope
    await waitFor(() => client.commandResults.filter((r) => r.commandId === "dup-1").length === 2);
    expect(client.commandResults.filter((r) => r.commandId === "dup-1").every((r) => r.accepted)).toBe(true);
    expect(client.view?.revision).toBe(revAfterFirst); // no second state mutation
  });

  it("cancels and cleans up", async () => {
    const { port, driver, session } = await startAwServer();
    let cleanupCalls = 0;
    driver.cleanup = () => {
      cleanupCalls += 1;
      return Promise.resolve();
    };
    const { client } = await openClient(port);
    await waitFor(() => client.announcement);
    client.send("START_RUN", { channelCode: CHANNEL });
    await session.whenSettled();
    await waitFor(() => client.view?.status === "WAITING_FOR_HUMAN");

    client.send("CANCEL_RUN");
    await session.whenSettled();
    await waitFor(() => client.view?.status === "CANCELLED");
    expect(client.view?.allowedCommands).toEqual([]);
    expect(cleanupCalls).toBeGreaterThanOrEqual(1);
  });

  it("rejects unauthorized and unpaired clients before any Action Window frame can flow", async () => {
    const { port } = await startAwServer();
    // No pairing token → no ticket.
    const unpaired = await post(port, "/bridge/ws-ticket", { clientProtocolVersion: 1 });
    expect(unpaired.status).toBe(401);
    // Bogus ticket → handshake rejected.
    const badTicket = await connect({ port, path: "/bridge/ws?ticket=bogus", origin: APP });
    expect(badTicket.status).toBe(401);
    // Valid ticket but disallowed Origin → rejected (and the ticket is not consumed by the rejection).
    const token = await pairToken(port);
    const ticket = await mintTicket(port, token);
    const badOrigin = await connect({ port, path: `/bridge/ws?ticket=${ticket}`, origin: "https://evil.example" });
    expect(badOrigin.status).toBe(403);
    const ok = await connect({ port, path: `/bridge/ws?ticket=${ticket}`, origin: APP });
    expect(ok.status).toBe(101);
    ok.ws?.close();
  });

  it("drops a malformed aw payload without disturbing the channel", async () => {
    const { port, session } = await startAwServer();
    const { client } = await openClient(port);
    await waitFor(() => client.announcement);

    client.ws.send(JSON.stringify({ type: "aw", payload: "{not json" }));
    client.ws.send(JSON.stringify({ type: "aw", payload: JSON.stringify({ kind: "aw_view" }) })); // server-kind frame from a client
    client.ws.send(JSON.stringify({ type: "aw" })); // missing payload

    // The channel still works afterwards.
    client.send("START_RUN", { channelCode: CHANNEL });
    await session.whenSettled();
    await waitFor(() => client.view?.status === "WAITING_FOR_HUMAN");
  });

  it("broadcasts events/views to every paired tab but routes command results to the sender only", async () => {
    const { port, session } = await startAwServer();
    const { client: a, token } = await openClient(port, undefined, "a");
    const { client: b } = await openClient(port, token, "b");
    await waitFor(() => a.announcement);
    await waitFor(() => b.announcement);

    a.send("START_RUN", { channelCode: CHANNEL });
    await session.whenSettled();
    await waitFor(() => a.view?.status === "WAITING_FOR_HUMAN");
    await waitFor(() => b.view?.status === "WAITING_FOR_HUMAN"); // broadcast reached the second tab

    expect(a.commandResults).toHaveLength(1); // the sender got its ack…
    expect(b.commandResults).toHaveLength(0); // …the other tab did not
    expect(b.eventTypes()).toContain("TARGET_HIGHLIGHTED");
    assertSanitizedWire(a);
    assertSanitizedWire(b);
  });

  it("gates the dev-only synthetic hosting flag out of production", () => {
    expect(resolveActionWindowSynthetic([ACTION_WINDOW_SYNTHETIC_FLAG], { NODE_ENV: "development" } as NodeJS.ProcessEnv)).toBe(true);
    expect(resolveActionWindowSynthetic([ACTION_WINDOW_SYNTHETIC_FLAG], { NODE_ENV: "production" } as NodeJS.ProcessEnv)).toBe(false);
    expect(resolveActionWindowSynthetic([], { NODE_ENV: "development" } as NodeJS.ProcessEnv)).toBe(false);
  });
});
