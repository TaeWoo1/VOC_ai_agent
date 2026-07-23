/**
 * **Cross-stack hermetic E2E — the REAL frontend transport against the REAL Local Agent Bridge.**
 *
 * Runtime-verification workstream. Every other Action Window E2E proves ONE side against a stand-in of
 * the other: `collector/test/action-window/bridge-transport.test.ts` drives the real `BridgeServer`
 * with a hand-rolled raw-`ws` client (`AwWireClient`), while `frontend/src/lib/actionWindow/*.test.ts`
 * drive the real FE transport against a MOCK `WebSocket`/`fetch`. Neither exercises the FE's own wire
 * code across a real socket to the real runtime. This suite closes that gap: it imports the ACTUAL
 * frontend modules —
 *   - `wsTransport.ts`      → `connectAwBridgeSession` (ticket mint, `aw_session` gate, opaque `{type:"aw"}`
 *                             framing, reconnect + `aw_resync`, different-run → offline never-splice),
 *   - `bridgeAdapter.ts`    → `createBridgeClient` (real `CommandEnvelope` minting, event dedupe/order,
 *                             highest-revision view adoption),
 *   - `bridgeSource.ts`     → `createBridgeSource` (reframes client state as `SourceUpdate` the store consumes),
 * and runs them over a genuine `BridgeServer` + `ActionWindowEndpoint` + `ActionWindowSession` +
 * `SyntheticProbeDriver`, connected by a real `ws` loopback socket.
 *
 * The composition mirrors the FE's own `connectBridgeIfEnabled` (bridgeSource.ts) exactly, MINUS the
 * `import.meta.env` DEV gate and the store adoption — i.e. the wiring that only a live agent could
 * exercise. The only "browser" behaviour we model is the Origin header the browser sends automatically
 * (injected into `fetchFn` and the `ws` handshake); all of the Bridge's real security checks
 * (origin allowlist, single-use ticket, pairing) run unmodified.
 *
 * Hermetic & synthetic: no browser, no marketplace, no backend, no credentials, no real run/seller data.
 * The "user action" is delivered by the test driver (`completeUserAction`) — the Runtime never clicks.
 * NO production code is changed and NO new synthetic control is added. The different-run case uses
 * TEST-OWNED rehosting — a SECOND real `BridgeServer` (a different hosted run, sharing the first's
 * pairing store) that the injected transport redirects the FE's reconnect to — rather than mutating any
 * runtime object's state (the endpoint's run identity stays `readonly`, set only via its constructor).
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";

// ── collector (runtime + bridge) — the REAL server side ──────────────────────
import { BridgeServer } from "../../src/bridge/bridge-server";
import { fakeApprovalPresenter } from "../bridge/helpers";
import { FilePairingStore } from "../../src/bridge/pairing-store";
import { ActionWindowEndpoint } from "../../src/bridge/action-window-endpoint";
import { ActionWindowEngine } from "../../src/action-window/engine";
import { ActionWindowSession, SyntheticProbeDriver } from "../../src/action-window/session";
import { findProhibitedFields, validateRunView, type ActionWindowRunView } from "../../../contracts/action-window/v1/index";

// ── frontend — the REAL client side (imported, never modified) ───────────────
import { connectAwBridgeSession, type AwBridgeSession, type AwConnectionStatus } from "../../../frontend/src/lib/actionWindow/wsTransport";
import { createBridgeClient } from "../../../frontend/src/lib/actionWindow/bridgeAdapter";
import { createBridgeSource, type BridgeBackedSource } from "../../../frontend/src/lib/actionWindow/bridgeSource";
import { BRIDGE_TOKEN_KEY, type StorageLike, type WebSocketLike } from "../../../frontend/src/lib/bridge/bridgeClient";
import type { SourceConnection, SourceUpdate } from "../../../frontend/src/lib/actionWindow/source";

const APP = "http://localhost:5173";
/** Stands in for the human console — pairing is fail-closed without a presenter. One shared instance per file: `lastCode()` is the most recent presentation, and request→confirm is sequential. */
const approval = fakeApprovalPresenter(); // the Vite dev origin the browser would send (allowlisted below)
const RUN_ID = "run_crossstack_e2e";
const RUN_ID_B = "run_crossstack_e2e_b"; // a DIFFERENT hosted run, for the never-splice case
const CHANNEL = "synthetic";
const RUN_COPY = "actionWindow.run.synthetic";

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

// ── One real BridgeServer hosting one synthetic Action Window run over a shared pairing store ────
async function startAwServerOn(opts: { runId: string; store: FilePairingStore }) {
  const driver = new SyntheticProbeDriver();
  const endpoint = new ActionWindowEndpoint({ runId: opts.runId, channelCode: CHANNEL });
  const engine = new ActionWindowEngine({ runId: opts.runId, channelCode: CHANNEL, runCopyKey: RUN_COPY });
  const session = new ActionWindowSession(engine, driver, endpoint.transport);
  session.attach();
  // Pairing is fail-closed in every environment: without an injected presenter the bridge refuses to pair.
  // This suite drives a real request→confirm→poll, so it stands in for the human console.
  const server = new BridgeServer({ store: opts.store, allowedOrigins: [APP], agentVersion: "test", port: 0, actionWindow: endpoint, approvalPresenter: approval.presenter });
  const { port } = await server.listen();
  cleanups.push(async () => server.close());
  return { server, port, driver, session, endpoint };
}

/** The common single-server setup used by the loop + same-run reconnect tests. */
async function startAwServer() {
  const dir = mkdtempSync(join(tmpdir(), `aw-crossstack-${randomUUID()}-`));
  const store = new FilePairingStore(join(dir, "pairings.json"), { now: () => Date.now() });
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const s = await startAwServerOn({ runId: RUN_ID, store });
  return { ...s, store };
}

// ── Browser-modelling injected transport (Origin header + port redirect) — NOT production behaviour ──
/** Replace the loopback port in a URL — models the test rehosting the "agent" the FE reconnects to. */
function rewritePort(url: string, from: number, to: number): string {
  return from === to ? url : url.split(`127.0.0.1:${from}`).join(`127.0.0.1:${to}`);
}

/**
 * A `fetchFn` + `wsFactory` pair the FE transport can inject. Both route to `portRef.port` (flipped by a
 * test to rehost the agent) and add the Origin a browser sends automatically; the `ws` sockets are
 * recorded in `opened` so a test can force a real drop.
 */
function makeBrowserDeps(basePort: number, portRef: { port: number }, opened: WebSocket[]) {
  const fetchFn = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
    fetch(rewritePort(String(input), basePort, portRef.port), {
      ...init,
      headers: { ...(init?.headers as Record<string, string> | undefined), Origin: APP },
    })) as typeof fetch;

  const wsFactory = (url: string): WebSocketLike => {
    const raw = new WebSocket(rewritePort(url, basePort, portRef.port), { origin: APP });
    opened.push(raw);
    const like: WebSocketLike = {
      onopen: null,
      onmessage: null,
      onclose: null,
      onerror: null,
      send: (data) => raw.send(data),
      close: () => raw.close(),
    };
    raw.on("open", () => like.onopen?.());
    raw.on("message", (data: WebSocket.RawData, isBinary: boolean) => {
      if (isBinary) return; // Action Window frames are text; the FE ignores binary too
      like.onmessage?.({ data: data.toString() });
    });
    raw.on("close", () => like.onclose?.());
    raw.on("error", () => like.onerror?.());
    return like;
  };
  return { fetchFn, wsFactory };
}

function seededStorage(token: string): StorageLike {
  const map = new Map<string, string>([[BRIDGE_TOKEN_KEY, token]]);
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

// ── Real pairing (request → local confirm → poll) to obtain the token the FE stores ──────────────
function post(port: number, path: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: APP, ...headers },
    body: JSON.stringify(body),
  });
}
async function pairToken(port: number): Promise<string> {
  const req = await (await post(port, "/bridge/pair/request", { workspaceLabel: "crossstack" })).json();
  await post(port, "/bridge/pair/confirm", { requestId: req.requestId, decision: "allow", approvalCode: approval.lastCode() }, { Origin: `http://127.0.0.1:${port}` });
  const poll = await (await post(port, "/bridge/pair/poll", { requestId: req.requestId })).json();
  return poll.pairingToken as string;
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

/**
 * Compose the REAL FE stack over a real socket: `connectAwBridgeSession` → `createBridgeClient` →
 * `createBridgeSource`. This is `bridgeSource.connectBridgeIfEnabled` minus the DEV env-gate + store
 * adoption. `basePort` is what the FE addresses; `portRef` is where the injected transport actually
 * routes (flip it to rehost the agent). Returns collected `SourceUpdate`s and `AwConnectionStatus`es.
 */
async function connectRealFeStack(basePort: number, portRef: { port: number }, token: string, opened: WebSocket[]) {
  const httpBase = `http://127.0.0.1:${basePort}`;
  const wsBase = `ws://127.0.0.1:${basePort}`;
  const updates: SourceUpdate[] = [];
  const statuses: AwConnectionStatus[] = [];
  let source: BridgeBackedSource | null = null;
  const { fetchFn, wsFactory } = makeBrowserDeps(basePort, portRef, opened);

  const result = await connectAwBridgeSession({
    httpBase,
    wsBase,
    fetchFn,
    wsFactory,
    storage: seededStorage(token),
    sessionTimeoutMs: 2000,
    retryDelayMs: 30,
    maxReconnectAttempts: 5,
    onStatus: (s) => {
      statuses.push(s);
      source?.notifyStatus(s as SourceConnection); // exactly the relay connectBridgeIfEnabled sets up
    },
  });
  // The refusal now carries WHY, so a cross-stack failure names its cause instead of being a bare
  // "failed" — and this is also the end-to-end proof that the EXPORT carrier still attaches.
  if (!result.ok) throw new Error(`FE stack failed to establish a live session over the real Bridge: ${result.reason}`);
  const session: AwBridgeSession = result.session;

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
const connectionFrames = (updates: SourceUpdate[]): SourceConnection[] =>
  updates.flatMap((u) => (u.kind === "connection" ? [u.connection] : []));

/** Every run view the FE consumed must be contract-valid and carry no prohibited (raw) field. */
function assertSanitizedViews(updates: SourceUpdate[]): void {
  for (const u of updates) {
    if ((u.kind === "view" || u.kind === "snapshot") && u.run) {
      expect(validateRunView(u.run)).toEqual({ ok: true });
      expect(findProhibitedFields(u.run)).toEqual([]);
    }
  }
}

describe("Action Window: the real frontend transport over the real Bridge (cross-stack, synthetic)", () => {
  it("drives the full loop end-to-end: pairing token → ws-ticket → aw_session → start → checkpoint → recheck → completed", async () => {
    const { port, driver, session } = await startAwServer();
    const token = await pairToken(port);
    const opened: WebSocket[] = [];
    const fe = await connectRealFeStack(port, { port }, token, opened);

    // The run identity came from the agent's `aw_session` announcement — the FE never invented it.
    expect(fe.session.runId).toBe(RUN_ID);
    expect(fe.session.channelCode).toBe(CHANNEL);

    // 1) Start the run through the real FE source → adapter → wsTransport → real Bridge → runtime.
    fe.source.dispatch({ commandId: "c1", type: "START_RUN", expectedRevision: null });
    await session.whenSettled();
    const atCheckpoint = await waitFor(() => {
      const run = latestRun(fe.updates);
      return run && run.status === "WAITING_FOR_HUMAN" ? run : null;
    });
    expect(atCheckpoint.executionMode).toBe("ACTION_WINDOW");
    expect(atCheckpoint.currentStep?.status).toBe("AWAITING_USER");
    expect(atCheckpoint.allowedCommands).toContain("REQUEST_STEP_RECHECK");
    const revAtCheckpoint = atCheckpoint.revision;

    // 2) The test driver reports the user's action (observation ≠ completion). Wait for the bumped view.
    driver.completeUserAction(true);
    await session.whenSettled();
    await waitFor(() => {
      const run = latestRun(fe.updates);
      return run && run.status === "WAITING_FOR_HUMAN" && run.revision > revAtCheckpoint ? run : null;
    });

    // 3) Recheck → verify → downstream → completed. Runtime alone completes the step.
    fe.source.dispatch({ commandId: "c2", type: "REQUEST_STEP_RECHECK", expectedRevision: latestRun(fe.updates)!.revision });
    await session.whenSettled();
    const done = await waitFor(() => {
      const run = latestRun(fe.updates);
      return run && run.status === "COMPLETED" ? run : null;
    });
    expect(done.progress).toEqual({ completedSteps: 3, totalSteps: 3 });
    expect(done.blocker).toBeUndefined();
    assertSanitizedViews(fe.updates);
  });

  it("reconnects and resyncs the SAME run through the real Bridge after a socket drop, restoring commands", async () => {
    const { port, driver, session } = await startAwServer();
    const token = await pairToken(port);
    const opened: WebSocket[] = [];
    const fe = await connectRealFeStack(port, { port }, token, opened);

    // Reach the human checkpoint, then force the established socket to drop.
    fe.source.dispatch({ commandId: "c1", type: "START_RUN", expectedRevision: null });
    await session.whenSettled();
    const beforeDrop = await waitFor(() => {
      const run = latestRun(fe.updates);
      return run && run.status === "WAITING_FOR_HUMAN" ? run : null;
    });
    const socketsBeforeDrop = opened.length;

    opened[opened.length - 1]!.close(); // real socket drop (not a graceful FE close)

    // The FE transport must walk connected → reconnecting → connected on its own, re-minting a fresh
    // ticket from the SAME pairing token and opening a NEW socket.
    await waitFor(() => fe.statuses.includes("reconnecting"));
    await waitFor(() => opened.length > socketsBeforeDrop); // a new socket was opened for the reconnect
    await waitFor(() => {
      const i = fe.statuses.indexOf("reconnecting");
      return i >= 0 && fe.statuses.lastIndexOf("connected") > i;
    });

    // The real bridgeSource propagated those transport transitions into the store seam.
    const frames = connectionFrames(fe.updates);
    expect(frames).toContain("reconnecting");
    expect(frames.lastIndexOf("connected")).toBeGreaterThan(frames.indexOf("reconnecting"));

    // Resync restored the same run (never spliced, revision did not regress) — still at the checkpoint.
    const resynced = await waitFor(() => {
      const run = latestRun(fe.updates);
      return run && run.status === "WAITING_FOR_HUMAN" && run.revision >= beforeDrop.revision ? run : null;
    });
    expect(resynced.status).toBe("WAITING_FOR_HUMAN");

    // Commands work again after the reconnect: finish the run over the rejoined socket.
    driver.completeUserAction(true);
    await session.whenSettled();
    await waitFor(() => {
      const run = latestRun(fe.updates);
      return run && run.revision > resynced.revision ? run : null;
    });
    fe.source.dispatch({ commandId: "c2", type: "REQUEST_STEP_RECHECK", expectedRevision: latestRun(fe.updates)!.revision });
    await session.whenSettled();
    const done = await waitFor(() => {
      const run = latestRun(fe.updates);
      return run && run.status === "COMPLETED" ? run : null;
    });
    expect(done.progress).toEqual({ completedSteps: 3, totalSteps: 3 });
    assertSanitizedViews(fe.updates);
  });

  it("goes offline (never splices) when the agent rehosts a DIFFERENT run on reconnect", async () => {
    // Two real BridgeServers sharing ONE pairing store (so the token stays valid), hosting DIFFERENT
    // runs. The FE addresses A; after the drop the injected transport reroutes its reconnect to B —
    // test-owned rehosting, no runtime object mutated.
    const dir = mkdtempSync(join(tmpdir(), `aw-crossstack-${randomUUID()}-`));
    const store = new FilePairingStore(join(dir, "pairings.json"), { now: () => Date.now() });
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const a = await startAwServerOn({ runId: RUN_ID, store });
    const b = await startAwServerOn({ runId: RUN_ID_B, store });

    const token = await pairToken(a.port);
    const opened: WebSocket[] = [];
    const portRef = { port: a.port }; // FE addresses A initially
    const fe = await connectRealFeStack(a.port, portRef, token, opened);

    // Reach A's checkpoint.
    fe.source.dispatch({ commandId: "c1", type: "START_RUN", expectedRevision: null });
    await a.session.whenSettled();
    await waitFor(() => {
      const run = latestRun(fe.updates);
      return run && run.status === "WAITING_FOR_HUMAN" ? run : null;
    });
    expect(fe.session.runId).toBe(RUN_ID);

    // Rehost: the agent the FE reconnects to now serves run B. Drop the live socket.
    portRef.port = b.port;
    opened[opened.length - 1]!.close();

    // The FE re-mints a valid ticket and opens a socket to B, sees runId B ≠ A, and settles OFFLINE —
    // never splicing the two runs.
    await waitFor(() => fe.statuses.includes("offline"));
    const frames = connectionFrames(fe.updates);
    expect(frames).toContain("reconnecting");
    expect(frames[frames.length - 1]).toBe("offline");

    // Never spliced: the FE's adopted run is still A at its checkpoint; run B was never rendered.
    const run = latestRun(fe.updates);
    expect(run?.status).toBe("WAITING_FOR_HUMAN");
    expect(fe.session.runId).toBe(RUN_ID);
    assertSanitizedViews(fe.updates);
  });
});
