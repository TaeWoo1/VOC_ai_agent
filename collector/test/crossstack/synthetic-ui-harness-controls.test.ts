/**
 * **Cross-stack hermetic E2E — the synthetic UI-verification harness's loopback controls driving the REAL
 * frontend transport over the REAL Bridge.** Where `fe-transport-real-bridge.test.ts` drove the connection
 * states with TEST-owned socket-close/rehost injection, this suite proves the SHIPPED control surface
 * (`agent/synthetic-ui-harness.ts` + `cli/action-window-ui-harness.ts`) does the same over loopback HTTP —
 * closing the gap that the previous synthetic agent exposed no operator drive controls. Each protocol step
 * is driven exclusively through `POST /control/...`, and the assertions are on the FE's own
 * `wsTransport` → `bridgeAdapter` → `bridgeSource` state.
 *
 * Hermetic & synthetic: no browser, no marketplace, no backend, no credentials. The only "browser" behaviour
 * modelled is the auto Origin header on `fetch`/`ws`.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";

import { startSyntheticUiHarness, type RunningSyntheticUiHarness } from "../../src/agent/synthetic-ui-harness";
import { findProhibitedFields, validateRunView, type ActionWindowRunView } from "../../../contracts/action-window/v1/index";

import { connectAwBridgeSession, type AwBridgeSession, type AwConnectionStatus } from "../../../frontend/src/lib/actionWindow/wsTransport";
import { createBridgeClient } from "../../../frontend/src/lib/actionWindow/bridgeAdapter";
import { createBridgeSource, type BridgeBackedSource } from "../../../frontend/src/lib/actionWindow/bridgeSource";
import { BRIDGE_TOKEN_KEY, type StorageLike, type WebSocketLike } from "../../../frontend/src/lib/bridge/bridgeClient";
import type { SourceConnection, SourceUpdate } from "../../../frontend/src/lib/actionWindow/source";

const APP = "http://localhost:5173";

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

async function startHarness(runId = "run_synthetic_a"): Promise<RunningSyntheticUiHarness> {
  const dir = mkdtempSync(join(tmpdir(), `aw-ui-controls-${randomUUID()}-`));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const h = await startSyntheticUiHarness({
    bridgePort: 0,
    controlPort: 0,
    allowedOrigins: [APP],
    pairingFile: join(dir, "pairings.json"),
    runId,
    channelCode: "synthetic",
    now: () => Date.now(),
  });
  cleanups.push(() => h.close());
  return h;
}

function control(port: number, path: string, body?: unknown) {
  return fetch(`http://127.0.0.1:${port}/control${path}`, {
    method: "POST",
    ...(body !== undefined ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
}

// ── Browser-modelling injected transport (Origin header) + real ws sockets ───────────────────────
function makeBrowserDeps(opened: WebSocket[]) {
  const fetchFn = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
    fetch(input, { ...init, headers: { ...(init?.headers as Record<string, string> | undefined), Origin: APP } })) as typeof fetch;
  const wsFactory = (url: string): WebSocketLike => {
    const raw = new WebSocket(url, { origin: APP });
    opened.push(raw);
    const like: WebSocketLike = { onopen: null, onmessage: null, onclose: null, onerror: null, send: (d) => raw.send(d), close: () => raw.close() };
    raw.on("open", () => like.onopen?.());
    raw.on("message", (data: WebSocket.RawData, isBinary: boolean) => {
      if (!isBinary) like.onmessage?.({ data: data.toString() });
    });
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

/** Auto-approve pairing → poll returns the token. */
async function pairToken(bridgePort: number): Promise<string> {
  const post = (path: string, body: unknown) =>
    fetch(`http://127.0.0.1:${bridgePort}${path}`, { method: "POST", headers: { "Content-Type": "application/json", Origin: APP }, body: JSON.stringify(body) });
  const req = await (await post("/bridge/pair/request", { workspaceLabel: "ui-controls" })).json();
  const poll = await (await post("/bridge/pair/poll", { requestId: req.requestId })).json();
  return poll.pairingToken as string;
}

async function connectFe(bridgePort: number, token: string, opened: WebSocket[]) {
  const updates: SourceUpdate[] = [];
  const statuses: AwConnectionStatus[] = [];
  let source: BridgeBackedSource | null = null;
  const { fetchFn, wsFactory } = makeBrowserDeps(opened);
  const session: AwBridgeSession | null = await connectAwBridgeSession({
    httpBase: `http://127.0.0.1:${bridgePort}`,
    wsBase: `ws://127.0.0.1:${bridgePort}`,
    fetchFn,
    wsFactory,
    storage: seededStorage(token),
    sessionTimeoutMs: 400,
    retryDelayMs: 30,
    maxReconnectAttempts: 4,
    onStatus: (s) => {
      statuses.push(s);
      source?.notifyStatus(s as SourceConnection);
    },
  });
  if (!session) throw new Error("FE stack failed to establish a live session over the harness Bridge");
  const client = createBridgeClient(session.transport, { runId: session.runId, channelCode: session.channelCode });
  source = createBridgeSource(client);
  const unsub = source.subscribe((u) => updates.push(u));
  cleanups.push(() => {
    unsub();
    source?.close();
    session.close();
  });
  return { session, source, updates, statuses };
}

function latestRun(updates: SourceUpdate[]): ActionWindowRunView | null {
  for (let i = updates.length - 1; i >= 0; i--) {
    const u = updates[i]!;
    if (u.kind === "view" && u.run) return u.run;
  }
  return null;
}
const connectionFrames = (updates: SourceUpdate[]): SourceConnection[] => updates.flatMap((u) => (u.kind === "connection" ? [u.connection] : []));
async function waitFor<T>(get: () => T | undefined | null | false, timeoutMs = 8000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = get();
    if (v) return v as T;
    if (Date.now() - start > timeoutMs) throw new Error("waitFor: condition not met in time");
    await new Promise((r) => setTimeout(r, 10));
  }
}
function assertSanitizedViews(updates: SourceUpdate[]): void {
  for (const u of updates) {
    if ((u.kind === "view" || u.kind === "snapshot") && u.run) {
      expect(validateRunView(u.run)).toEqual({ ok: true });
      expect(findProhibitedFields(u.run)).toEqual([]);
    }
  }
}

/** Drive START_RUN over the real transport and settle at the human checkpoint. */
async function startToCheckpoint(h: RunningSyntheticUiHarness, fe: Awaited<ReturnType<typeof connectFe>>): Promise<ActionWindowRunView> {
  fe.source.dispatch({ commandId: "c1", type: "START_RUN", expectedRevision: null });
  await h.session.whenSettled();
  return waitFor(() => {
    const run = latestRun(fe.updates);
    return run && run.status === "WAITING_FOR_HUMAN" ? run : null;
  });
}

describe("Synthetic UI harness controls driving the real FE transport over the real Bridge", () => {
  it("POST /control/complete-user-action advances the synthetic checkpoint (then recheck completes)", async () => {
    const h = await startHarness();
    const token = await pairToken(h.bridgePort);
    const fe = await connectFe(h.bridgePort, token, []);
    const atCheckpoint = await startToCheckpoint(h, fe);

    const done = await (await control(h.controlPort, "/complete-user-action")).json();
    expect(done).toEqual({ ok: true, observed: true });
    await h.session.whenSettled();
    await waitFor(() => {
      const run = latestRun(fe.updates);
      return run && run.revision > atCheckpoint.revision ? run : null;
    });

    fe.source.dispatch({ commandId: "c2", type: "REQUEST_STEP_RECHECK", expectedRevision: latestRun(fe.updates)!.revision });
    await h.session.whenSettled();
    const completed = await waitFor(() => {
      const run = latestRun(fe.updates);
      return run && run.status === "COMPLETED" ? run : null;
    });
    expect(completed.progress).toEqual({ completedSteps: 3, totalSteps: 3 });
    assertSanitizedViews(fe.updates);
  });

  it("POST /control/drop-socket → FE reconnects the SAME run and resyncs", async () => {
    const h = await startHarness();
    const token = await pairToken(h.bridgePort);
    const opened: WebSocket[] = [];
    const fe = await connectFe(h.bridgePort, token, opened);
    const before = await startToCheckpoint(h, fe);
    const socketsBefore = opened.length;

    const dropped = await (await control(h.controlPort, "/drop-socket")).json();
    expect(dropped.ok).toBe(true);
    expect(dropped.dropped).toBeGreaterThanOrEqual(1);

    await waitFor(() => fe.statuses.includes("reconnecting"));
    await waitFor(() => opened.length > socketsBefore);
    await waitFor(() => {
      const i = fe.statuses.indexOf("reconnecting");
      return i >= 0 && fe.statuses.lastIndexOf("connected") > i;
    });
    const frames = connectionFrames(fe.updates);
    expect(frames).toContain("reconnecting");
    expect(frames.lastIndexOf("connected")).toBeGreaterThan(frames.indexOf("reconnecting"));

    const resynced = await waitFor(() => {
      const run = latestRun(fe.updates);
      return run && run.status === "WAITING_FOR_HUMAN" && run.revision >= before.revision ? run : null;
    });
    expect(resynced.status).toBe("WAITING_FOR_HUMAN");
    assertSanitizedViews(fe.updates);
  });

  it("POST /control/host {up:false} + drop → FE settles OFFLINE after its retry envelope", async () => {
    const h = await startHarness();
    const token = await pairToken(h.bridgePort);
    const opened: WebSocket[] = [];
    const fe = await connectFe(h.bridgePort, token, opened);
    await startToCheckpoint(h, fe);

    await control(h.controlPort, "/host", { up: false }); // agent "down" for the AW channel
    await control(h.controlPort, "/drop-socket");

    await waitFor(() => fe.statuses.includes("offline"), 12000);
    const frames = connectionFrames(fe.updates);
    expect(frames[frames.length - 1]).toBe("offline");
    assertSanitizedViews(fe.updates);
  });

  it("POST /control/host {runId:<different>} + drop → FE reconnect settles OFFLINE, never spliced", async () => {
    const h = await startHarness("run_synthetic_a");
    const token = await pairToken(h.bridgePort);
    const opened: WebSocket[] = [];
    const fe = await connectFe(h.bridgePort, token, opened);
    const before = await startToCheckpoint(h, fe);
    expect(fe.session.runId).toBe("run_synthetic_a");

    // Rehost a DIFFERENT run id, then drop: the FE's automatic reconnect sees run B != A → offline.
    await control(h.controlPort, "/host", { up: true, runId: "run_synthetic_b" });
    await control(h.controlPort, "/drop-socket");

    await waitFor(() => fe.statuses.includes("offline"), 12000);
    const frames = connectionFrames(fe.updates);
    expect(frames).toContain("reconnecting");
    expect(frames[frames.length - 1]).toBe("offline");

    // Never spliced: the FE's adopted run is still A at its checkpoint; run B was never rendered.
    const run = latestRun(fe.updates);
    expect(run?.status).toBe("WAITING_FOR_HUMAN");
    expect(run?.revision).toBe(before.revision);
    assertSanitizedViews(fe.updates);
  });
});
