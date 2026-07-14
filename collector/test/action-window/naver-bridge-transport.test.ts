/**
 * **NAVER fixture channel over the REAL Bridge WebSocket, via the real boot composition (R4, D-023).**
 * Where `bridge-transport.test.ts` proves the synthetic driver over the wire, this suite drives the
 * ratified `NaverFixtureProbeDriver` through the ACTUAL Local-Agent composition root
 * (`createAgentBridge`, the same call `local-agent.ts` boot makes) over a real `BridgeServer` on a
 * loopback port: real pairing (request → confirm → poll), a single-use WS ticket, a real `ws` client,
 * and the opaque `{type:"aw"}` carrier — with `channelCode:"naver"`, real detect + quarantine-validate
 * over the fixture artifact, and synthetic ingest (no `/api/uploads`, no network).
 *
 * Offline and hermetic: no browser, no backend, no live NAVER; temp `.operation-runs`/quarantine dirs;
 * the "user action" is delivered by the test driver (`completeUserAction`), never by the Runtime.
 * Runs by DEFAULT in the hermetic suite: it opens only real LOOPBACK WebSockets (exactly like the
 * un-gated `bridge-transport.test.ts`), reaches no network/backend/marketplace, and needs no external
 * service — so the earlier `RUN_INTEGRATION` gate was removed as inconsistent with that sibling suite.
 */
import { afterEach, describe, it, expect } from "vitest";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
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
import { createAgentBridge, type AgentActionWindowConfig, type AgentBridge } from "../../src/agent/agent-bridge";
import {
  NaverFixtureProbeDriver,
  NAVER_CHANNEL_CODE,
  NAVER_RUN_COPY_KEY,
  type NaverFixtureDriverOptions,
} from "../../src/action-window/naver-driver";
import { NAVER_FIXTURE_CANARIES } from "../../src/action-window/naver-fixture";
import { loadOperationRun } from "../../src/action-window/run-store";
import { connect, readMessages } from "../bridge/helpers";

const APP = "http://localhost:5173";

/** Nothing NAVER-real, fixture-raw, or filesystem-pathy may cross the wire or reach the store. */
const FORBIDDEN_NEEDLES = [
  ...NAVER_FIXTURE_CANARIES,
  "smartstore",
  "스마트스토어",
  "naver.com",
  "엑셀",
  "다운로드",
  "합성",
  "aw-quarantine",
  ".xlsx",
  "[content_types]",
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

interface AwBridgeHandle {
  bridge: AgentBridge;
  port: number;
  driver: () => NaverFixtureProbeDriver;
  persistDir: string;
  quarantineDir: string;
  pairingFile: string;
}

/**
 * Boot the NAVER-fixture Action Window channel through the real composition root. `persistDir`/
 * `pairingFile` may be reused to model an agent COLD RESTART (a second boot resumes the persisted run).
 */
async function bootNaverAwBridge(dirs: { persistDir: string; quarantineDir: string; pairingFile: string }): Promise<AwBridgeHandle> {
  let created: NaverFixtureProbeDriver | undefined;
  const opts: NaverFixtureDriverOptions = { downloadShape: "xlsx-valid", downstream: { real: { quarantineDir: dirs.quarantineDir } } };
  const actionWindow: AgentActionWindowConfig = {
    runId: `run_${randomBytes(6).toString("hex")}`,
    channelCode: NAVER_CHANNEL_CODE,
    runCopyKey: NAVER_RUN_COPY_KEY,
    createDriver: () => (created = new NaverFixtureProbeDriver("normal", opts)),
    persistDir: dirs.persistDir,
  };
  const bridge = createAgentBridge({
    port: 0,
    allowedOrigins: [APP],
    pairingFile: dirs.pairingFile,
    agentVersion: "test",
    refSalt: "test-salt",
    now: () => Date.now(),
    actionWindow,
  });
  const listen = await bridge.listen();
  if (!listen.ok) throw new Error("bridge failed to listen");
  cleanups.push(async () => bridge.close());
  return {
    bridge,
    port: listen.port,
    driver: () => created!,
    persistDir: dirs.persistDir,
    quarantineDir: dirs.quarantineDir,
    pairingFile: dirs.pairingFile,
  };
}

function makeDirs() {
  const base = mkdtempSync(join(tmpdir(), `aw-naver-ws-${randomUUID()}-`));
  cleanups.push(() => rmSync(base, { recursive: true, force: true }));
  return { persistDir: join(base, "runs"), quarantineDir: join(base, "q"), pairingFile: join(base, "pairings.json") };
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
  await post(port, "/bridge/pair/confirm", { requestId: req.requestId, decision: "allow" }, { Origin: `http://127.0.0.1:${port}` });
  const poll = await (await post(port, "/bridge/pair/poll", { requestId: req.requestId })).json();
  return poll.pairingToken as string;
}

async function mintTicket(port: number, token: string): Promise<string> {
  const r = await (await post(port, "/bridge/ws-ticket", { clientProtocolVersion: 1 }, { Authorization: `Bearer ${token}` })).json();
  return r.ticket as string;
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
  type: string;
  transportVersion: number;
  runId: string;
  channelCode: string;
}

/** Frame-level FE stand-in over the REAL socket (dedupe + revision guard), mirroring the R2B suite. */
class AwWireClient {
  announcement: Announcement | null = null;
  view: ActionWindowRunView | null = null;
  events: EventEnvelope[] = [];
  serverFrames: AwServerFrame[] = [];
  commandResults: Array<{ commandId: string; accepted: boolean; reason?: string }> = [];
  lastSequence = 0;
  private readonly seenEventIds = new Set<string>();
  private cmdSeq = 0;

  constructor(readonly ws: WebSocket, readonly runId: string, private readonly label = "c") {
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
        case "aw_event":
          if (!isDuplicateEvent(frame.event.eventId, this.seenEventIds) && !isOutOfOrderEvent(frame.event.sequence, this.lastSequence)) {
            this.seenEventIds.add(frame.event.eventId);
            this.lastSequence = frame.event.sequence;
            this.events.push(frame.event);
          }
          break;
        case "aw_view":
          if (this.view === null || frame.view.revision >= this.view.revision) this.view = frame.view;
          break;
        case "aw_command_result":
          this.commandResults.push({ commandId: frame.commandId, accepted: frame.accepted, reason: frame.reason });
          break;
        case "aw_resync_result":
          if (frame.view) this.view = frame.view;
          for (const e of frame.events) {
            if (!this.seenEventIds.has(e.eventId)) {
              this.seenEventIds.add(e.eventId);
              this.lastSequence = Math.max(this.lastSequence, e.sequence);
              this.events.push(e);
            }
          }
          break;
      }
    });
  }

  sendFrame(frame: AwClientFrame): void {
    this.ws.send(JSON.stringify({ type: "aw", payload: serializeFrame(frame) }));
  }
  send(type: CommandType, payload?: CommandEnvelope["payload"]): void {
    this.sendFrame({
      kind: "aw_command",
      command: {
        protocolVersion: ACTION_WINDOW_PROTOCOL_VERSION,
        commandId: `${this.runId}-${this.label}${++this.cmdSeq}-${randomUUID().slice(0, 8)}`,
        runId: this.runId,
        expectedRevision: this.view?.revision ?? 0,
        type,
        ...(payload ? { payload } : {}),
      },
    });
  }
  resync(sinceSequence = this.lastSequence): void {
    this.sendFrame({ kind: "aw_resync", runId: this.runId, sinceSequence });
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

async function openClient(handle: AwBridgeHandle, token?: string, label = "c"): Promise<{ client: AwWireClient; token: string; runId: string }> {
  const t = token ?? (await pairToken(handle.port));
  const ticket = await mintTicket(handle.port, t);
  const up = await connect({ port: handle.port, path: `/bridge/ws?ticket=${ticket}`, origin: APP });
  expect(up.status).toBe(101);
  const initial = await readMessages(up.ws!, 3); // hello, snapshot, aw_session
  const ann = (initial.find((m) => m.type === "aw_session") as unknown as Announcement | undefined) ?? null;
  const runId = ann?.runId ?? "";
  const client = new AwWireClient(up.ws!, runId, label);
  client.announcement = ann;
  cleanups.push(() => client.close());
  return { client, token: t, runId };
}

function assertSanitizedWire(client: AwWireClient, label: string): void {
  expect(client.announcement).not.toBeNull();
  expect(findProhibitedFields(client.announcement)).toEqual([]);
  for (const frame of client.serverFrames) {
    expect(findProhibitedFields(frame)).toEqual([]);
    if (frame.kind === "aw_event") expect(validateEventEnvelope(frame.event)).toEqual({ ok: true });
    if (frame.kind === "aw_view") expect(validateRunView(frame.view)).toEqual({ ok: true });
  }
  expectNoNeedle(client.serverFrames, label);
}

describe("NAVER fixture channel over the real Bridge WS (R4 boot wiring)", () => {
  it("announces channelCode naver after hello+snapshot with the transport version", async () => {
    const handle = await bootNaverAwBridge(makeDirs());
    const { client, runId } = await openClient(handle);
    const ann = await waitFor(() => client.announcement);
    expect(ann).toEqual({
      type: "aw_session",
      transportVersion: ACTION_WINDOW_TRANSPORT_VERSION,
      runId,
      channelCode: NAVER_CHANNEL_CODE,
    });
  });

  it("runs the full loop to COMPLETED: start → checkpoint → user action → recheck → real detect/validate → ingest", async () => {
    const handle = await bootNaverAwBridge(makeDirs());
    const session = handle.bridge.actionWindowSession!;
    const { client } = await openClient(handle);
    await waitFor(() => client.announcement);

    // 1) Start; the Runtime drives read-only to the human checkpoint and stops.
    client.send("START_RUN", { channelCode: NAVER_CHANNEL_CODE });
    await session.whenSettled();
    await waitFor(() => client.view?.status === "WAITING_FOR_HUMAN");
    expect(client.view?.channelCode).toBe(NAVER_CHANNEL_CODE);
    expect(client.view?.executionMode).toBe("ACTION_WINDOW");
    const highlight = client.events.find((e) => e.type === "TARGET_HIGHLIGHTED");
    expect(highlight?.payload.targetRef).toMatch(/^[0-9a-f]{16}$/);
    expect(client.eventTypes()).not.toContain("USER_ACTION_OBSERVED");

    // 2) The test driver reports the user's action (the Runtime never clicks). Observation ≠ completion.
    const revBeforeAction = client.view!.revision;
    handle.driver().completeUserAction(true);
    await session.whenSettled();
    await waitFor(() => client.eventTypes().includes("USER_ACTION_OBSERVED") && (client.view?.revision ?? 0) > revBeforeAction);

    // 3) Recheck → verify → real detect → quarantine validate → synthetic ingest → completed.
    client.send("REQUEST_STEP_RECHECK");
    await session.whenSettled();
    await waitFor(() => client.view?.status === "COMPLETED");
    expect(client.view?.progress).toEqual({ completedSteps: 3, totalSteps: 3 });
    expect(client.view?.blocker).toBeUndefined();
    expect(client.eventTypes()).toContain("RUN_COMPLETED");
    const detected = client.events.find((e) => e.type === "DOWNLOAD_DETECTED");
    expect(detected?.payload.artifactRef).toMatch(/^[0-9a-f]{16}$/);

    // The real quarantine ran offline and left nothing on disk; the driver did the full downstream once.
    expect(readdirSync(handle.quarantineDir)).toEqual([]);
    expect(handle.driver().downstreamCalls).toEqual({ detect: 1, validate: 1, ingest: 1 });

    // Strictly monotonic, gapless ordering over the real wire.
    const seqs = client.events.map((e) => e.sequence);
    expect(seqs).toEqual(seqs.map((_, i) => i + 1));

    assertSanitizedWire(client, "naver-ws-happy");
    // The quarantine dir path never appears in any frame.
    expect(JSON.stringify(client.serverFrames).includes(handle.quarantineDir)).toBe(false);
  });

  it("survives an agent COLD RESTART: a fresh boot resumes the persisted naver run and completes through downstream", async () => {
    const dirs = makeDirs();
    const first = await bootNaverAwBridge(dirs);
    const firstSession = first.bridge.actionWindowSession!;
    const { client, token, runId } = await openClient(first);
    await waitFor(() => client.announcement);
    client.send("START_RUN", { channelCode: NAVER_CHANNEL_CODE });
    await firstSession.whenSettled();
    await waitFor(() => client.view?.status === "WAITING_FOR_HUMAN");

    // Persisted at the checkpoint, sanitized, needle-free (channelCode naver survives).
    const persisted = loadOperationRun(dirs.persistDir, runId)!;
    expect(persisted.channelCode).toBe(NAVER_CHANNEL_CODE);
    expect(persisted.resumeState).toBe("RESUME_AT_CHECKPOINT");
    expect(findProhibitedFields(persisted)).toEqual([]);
    expectNoNeedle(persisted, "persisted-checkpoint");

    // The agent process "dies": close the bridge but keep the persist + pairing dirs.
    client.close();
    await first.bridge.close();

    // A fresh agent boots over the SAME dirs → findResumableRun resumes the run, parked at PAUSED.
    const second = await bootNaverAwBridge(dirs);
    const secondSession = second.bridge.actionWindowSession!;
    const { client: rejoined, runId: resumedRunId } = await openClient(second, token, "r");
    await waitFor(() => rejoined.announcement);
    expect(resumedRunId).toBe(runId); // the resumed identity wins the announcement
    expect(rejoined.announcement?.runId).toBe(runId);
    rejoined.resync(0);
    await waitFor(() => rejoined.view?.status === "PAUSED");

    // Explicit RESUME_RUN re-drives the read-only chain; the user acts; the fresh artifact runs the
    // real detect → quarantine validate → ingest chain over the restored driver → completed.
    rejoined.send("RESUME_RUN");
    await secondSession.whenSettled();
    await waitFor(() => rejoined.view?.status === "WAITING_FOR_HUMAN");
    second.driver().completeUserAction(true);
    await secondSession.whenSettled();
    rejoined.send("REQUEST_STEP_RECHECK");
    await secondSession.whenSettled();
    await waitFor(() => rejoined.view?.status === "COMPLETED");
    expect(second.driver().downstreamCalls).toEqual({ detect: 1, validate: 1, ingest: 1 });
    expect(readdirSync(second.quarantineDir)).toEqual([]);

    const final = loadOperationRun(dirs.persistDir, runId)!;
    expect(final.channelCode).toBe(NAVER_CHANNEL_CODE);
    expect(final.resumeState).toBe("TERMINAL");
    expect(findProhibitedFields(final)).toEqual([]);
    expectNoNeedle(final, "persisted-final");
    expect(JSON.stringify(final)).not.toContain("processed"); // the ingest count never persists
    assertSanitizedWire(rejoined, "naver-ws-resumed");
  });
});
