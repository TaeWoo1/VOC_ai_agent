/**
 * **Cross-stack hermetic E2E — the REAL frontend guided-import runtime against the REAL agent-hosted IMPORT
 * carrier.** The import-side counterpart of `fe-reply-runtime-real-bridge.test.ts` (v2 reply) and
 * `fe-transport-real-bridge.test.ts` (v1 export).
 *
 * ## Why this suite has to exist, specifically for import
 *
 * Every other import test proves ONE side against a stand-in: the collector's `discovery-session.test.ts` and
 * `import-session.test.ts` drive the real engines over an in-process loopback, and the frontend's
 * `import/*.test.ts` drive the real runtime against a fake transport. Neither crosses a socket — and the import
 * carrier is the one carrier where the seam between them carries load, because **run identity changes mid-
 * session**. An export or reply agent hosts one run for its lifetime; an onboarding import is a sequence, so
 * `ImportSegmentHost` mints a new identity per run and re-announces it. A frontend that kept its attach-time
 * runId would address the second run's commands to the first one forever, and no single-sided test can see it.
 *
 * So this runs the ACTUAL frontend modules —
 *   - `wsTransport.ts`   → `connectAwBridgeSession` with `expectedCarrier: import`,
 *   - `importRuntime.ts` → `createGuidedImportRuntime` (acknowledged START_RUN, view-adopted runId,
 *                          allowedCommands-gated sends),
 * over a genuine `BridgeServer` + `InitialImportEndpoint` + `ImportSegmentHost` + the real discovery and
 * segment engines/sessions, connected by a real `ws` loopback socket. It mirrors `connectImportSession` exactly
 * MINUS its `import.meta.env` base-URL read and its non-injectable deps (only a browser could exercise those) —
 * the same shape the other two cross-stack suites use.
 *
 * Hermetic & synthetic: no browser, NO NAVER contact, no backend, no credentials, no real seller data. The
 * seller's clicks are delivered by the fixture driver; the runtime never clicks. No production code is changed.
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
import { InitialImportEndpoint } from "../../src/bridge/initial-import-endpoint";
import { ImportSegmentHost, type ResolvedLaunchScope } from "../../src/action-window/initial-import/import-host";
import {
  ImportFixtureDriver,
  type ImportFixtureScript,
} from "../../src/action-window/initial-import/import-fixture-driver";

// ── frontend — the REAL client side (imported, never modified) ───────────────
import { connectAwBridgeSession, type AwWsDeps } from "../../../frontend/src/lib/actionWindow/wsTransport";
import {
  createGuidedImportRuntime,
  type GuidedImportRuntime,
  type GuidedImportSnapshot,
} from "../../../frontend/src/lib/actionWindow/import/importRuntime";
import type { AwClientTransport as AwClientTransportV2 } from "../../../contracts/action-window/v2/transport";
import { AW_CARRIER_IMPORT, AW_CARRIER_EXPORT, type AwCarrierKind } from "../../../contracts/action-window/aw-carrier-kind";
import { BRIDGE_TOKEN_KEY, type StorageLike, type WebSocketLike } from "../../../frontend/src/lib/bridge/bridgeClient";

const APP = "http://localhost:5173";
const approval = fakeApprovalPresenter();
const CHANNEL = "naver";
const ANNOUNCE_RUN = "run_import_announce";
const DISCOVERY_REF = "0f1e2d3c4b5a6978";
const SEGMENT_REF = "9a8b7c6d5e4f3021";
const SEGMENT_REF_2 = "1122334455667788";

const SEGMENT_SCOPE: ResolvedLaunchScope = {
  kind: "SEGMENT",
  channelCode: CHANNEL,
  requiredStart: "2026-06-01",
  requiredEnd: "2026-06-30",
};
const DISCOVERY_SCOPE: ResolvedLaunchScope = {
  kind: "DISCOVERY",
  channelCode: CHANNEL,
  requiredStart: "",
  requiredEnd: "",
};

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

/**
 * One real BridgeServer hosting the IMPORT carrier, with the real host waiting for a launch ref.
 *
 * `resolveScope` stands in for the backend — the ONE thing that cannot be real here without a Postgres and a
 * seller account. Everything downstream of it is production code.
 */
async function startImportServer(opts?: { script?: ImportFixtureScript; carrier?: "import" | "export" }) {
  const dir = mkdtempSync(join(tmpdir(), `aw-import-crossstack-${randomUUID()}-`));
  const store = new FilePairingStore(join(dir, "pairings.json"), { now: () => Date.now() });
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));

  const script: ImportFixtureScript = opts?.script ?? {};
  const driver = new ImportFixtureDriver(script);
  const endpoint = new InitialImportEndpoint({ runId: ANNOUNCE_RUN, channelCode: CHANNEL });
  const resolved: string[] = [];
  const host = new ImportSegmentHost({
    endpoint,
    channelCode: CHANNEL,
    resolveScope: async (ref) => {
      resolved.push(ref);
      if (ref === DISCOVERY_REF) return DISCOVERY_SCOPE;
      if (ref === SEGMENT_REF || ref === SEGMENT_REF_2) return SEGMENT_SCOPE;
      return null;
    },
    driver,
  });
  host.attach();
  cleanups.push(() => host.close());

  const server = new BridgeServer({
    store,
    allowedOrigins: [APP],
    agentVersion: "test",
    port: 0,
    actionWindow: endpoint,
    approvalPresenter: approval.presenter,
  });
  const { port } = await server.listen();
  cleanups.push(async () => server.close());
  return { port, endpoint, host, driver, script, resolved };
}

/** Browser-modelling injected transport (the Origin header a browser adds automatically). */
function makeBrowserDeps(port: number, opened: WebSocket[]): Pick<AwWsDeps, "fetchFn" | "wsFactory"> {
  const fetchFn = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
    fetch(String(input), {
      ...init,
      headers: { ...(init?.headers as Record<string, string> | undefined), Origin: APP },
    })) as typeof fetch;
  const wsFactory = (url: string): WebSocketLike => {
    const raw = new WebSocket(url, { origin: APP });
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
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

function post(port: number, path: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: APP, ...headers },
    body: JSON.stringify(body),
  });
}

async function pairToken(port: number): Promise<string> {
  const req = await (await post(port, "/bridge/pair/request", { workspaceLabel: "crossstack" })).json();
  await post(
    port,
    "/bridge/pair/confirm",
    { requestId: req.requestId, decision: "allow", approvalCode: approval.lastCode() },
    { Origin: `http://127.0.0.1:${port}` },
  );
  const poll = await (await post(port, "/bridge/pair/poll", { requestId: req.requestId })).json();
  return poll.pairingToken as string;
}

/** Compose the REAL FE import stack over a real socket, exactly as `connectImportSession` does. */
async function connectImportRuntime(
  port: number,
  opened: WebSocket[],
  expectedCarrier: AwCarrierKind = AW_CARRIER_IMPORT,
  options: { startTimeoutMs?: number } = {},
): Promise<
  | { ok: true; runtime: GuidedImportRuntime; seen: GuidedImportSnapshot[]; close: () => void }
  | { ok: false; reason: string }
> {
  const token = await pairToken(port);
  const result = await connectAwBridgeSession({
    httpBase: `http://127.0.0.1:${port}`,
    wsBase: `ws://127.0.0.1:${port}`,
    storage: seededStorage(token),
    expectedCarrier,
    ...makeBrowserDeps(port, opened),
  });
  if (!result.ok) return { ok: false, reason: result.reason };
  const frames = result.session.transport as unknown as AwClientTransportV2;
  const runtime = createGuidedImportRuntime(
    { transport: frames, runId: result.session.runId, channelCode: result.session.channelCode },
    options,
  );
  const seen: GuidedImportSnapshot[] = [];
  runtime.subscribe((s) => {
    if (s) seen.push(s);
  });
  return { ok: true, runtime, seen, close: () => result.session.close() };
}

/** Wait until the published state satisfies a predicate, or fail with what was actually seen. */
async function waitFor(
  runtime: GuidedImportRuntime,
  predicate: (s: GuidedImportSnapshot) => boolean,
  label: string,
  timeoutMs = 6000,
): Promise<GuidedImportSnapshot> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const snapshot = runtime.snapshot();
    if (snapshot && predicate(snapshot)) return snapshot;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`cross-stack import: timed out waiting for ${label} (last: ${JSON.stringify(runtime.snapshot())})`);
}

describe("cross-stack: FE guided-import runtime ↔ real agent-hosted IMPORT carrier", () => {
  it("runs range DISCOVERY from the frontend's own START_RUN, to COMPLETED", async () => {
    const opened: WebSocket[] = [];
    const { port, resolved } = await startImportServer({
      script: { selectedRange: { start: "2023-08-01", end: "2026-07-25" } },
    });
    const c = await connectImportRuntime(port, opened);
    expect(c.ok).toBe(true);
    if (!c.ok) return;

    await c.runtime.start({ launchRef: DISCOVERY_REF, kind: "DISCOVERY" });

    // The SERVER decided the kind; the ref is what was presented.
    expect(resolved).toEqual([DISCOVERY_REF]);
    const done = await waitFor(c.runtime, (s) => s.status === "COMPLETED", "discovery completion");
    expect(done.intent).toBe("INITIAL_REVIEW_IMPORT_DISCOVERY");
    expect(done.step?.totalSteps).toBe(5);
    // A finished run offers nothing to press.
    expect(done.allowedCommands).toEqual([]);
  });

  it("guides a SEGMENT run to COMPLETED, showing the seller the window it must match", async () => {
    const opened: WebSocket[] = [];
    const { port } = await startImportServer();
    const c = await connectImportRuntime(port, opened);
    expect(c.ok).toBe(true);
    if (!c.ok) return;

    await c.runtime.start({ launchRef: SEGMENT_REF, kind: "SEGMENT" });
    const done = await waitFor(c.runtime, (s) => s.status === "COMPLETED", "segment completion");
    expect(done.intent).toBe("INITIAL_REVIEW_IMPORT_SEGMENT");

    // Every view of a segment run carries the SERVER-resolved window as sanitized copy params, which is what
    // lets the card say which dates to pick instead of just highlighting a field.
    const withWindow = c.seen.filter((s) => s.step?.copyParams.requiredStart === "2026-06-01");
    expect(withWindow.length).toBeGreaterThan(0);
    expect(withWindow[0]!.step?.copyParams.requiredEnd).toBe("2026-06-30");
  });

  /**
   * The gap the live run exposed, closed end to end: the runtime reported `SCOPE_MISMATCH` correctly and the
   * seller's screen did not change, because no frontend was attached to hear it.
   */
  it("delivers SCOPE_MISMATCH to the frontend, and the recheck repairs the run", async () => {
    const opened: WebSocket[] = [];
    const { port, script } = await startImportServer({ script: { scope: "MISMATCH" } });
    const c = await connectImportRuntime(port, opened);
    expect(c.ok).toBe(true);
    if (!c.ok) return;

    await c.runtime.start({ launchRef: SEGMENT_REF, kind: "SEGMENT" });
    const blocked = await waitFor(c.runtime, (s) => s.blocker !== null, "scope block");
    expect(blocked.blocker).toEqual({ code: "SCOPE_MISMATCH", recoverable: true });
    // Recoverable, not failed — and the repair is offered.
    expect(blocked.status).toBe("WAITING_FOR_HUMAN");
    expect(blocked.allowedCommands).toContain("REQUEST_STEP_RECHECK");

    // The seller fixes the dates on NAVER; the FE says "look again". It does not complete the step itself.
    script.scope = "MATCH";
    c.runtime.send("REQUEST_STEP_RECHECK");

    const done = await waitFor(c.runtime, (s) => s.status === "COMPLETED", "recovery to completion");
    expect(done.blocker).toBeNull();
  });

  /**
   * The property no single-sided test can see: the host mints a NEW identity per run, so the frontend has to
   * adopt it from the view stream or spend the rest of the sitting addressing a finished run.
   */
  it("carries a full sitting — discovery then a segment — on ONE socket, adopting each new run identity", async () => {
    const opened: WebSocket[] = [];
    const { port } = await startImportServer();
    const c = await connectImportRuntime(port, opened);
    expect(c.ok).toBe(true);
    if (!c.ok) return;

    await c.runtime.start({ launchRef: DISCOVERY_REF, kind: "DISCOVERY" });
    const discovery = await waitFor(
      c.runtime,
      (s) => s.status === "COMPLETED" && s.intent === "INITIAL_REVIEW_IMPORT_DISCOVERY",
      "discovery completion",
    );

    await c.runtime.start({ launchRef: SEGMENT_REF, kind: "SEGMENT" });
    const segment = await waitFor(
      c.runtime,
      (s) => s.status === "COMPLETED" && s.intent === "INITIAL_REVIEW_IMPORT_SEGMENT",
      "segment completion",
    );

    expect(segment.runId).not.toBe(discovery.runId);
    expect(segment.runId).toMatch(/^run_[0-9a-f]{12}$/);
    // One socket for the whole sitting: no reconnect was needed to host a second run.
    expect(opened).toHaveLength(1);
  });

  it("runs a second segment after the first, still on the same socket", async () => {
    const opened: WebSocket[] = [];
    const { port } = await startImportServer();
    const c = await connectImportRuntime(port, opened);
    expect(c.ok).toBe(true);
    if (!c.ok) return;

    await c.runtime.start({ launchRef: SEGMENT_REF, kind: "SEGMENT" });
    const first = await waitFor(c.runtime, (s) => s.status === "COMPLETED", "first segment");

    await c.runtime.start({ launchRef: SEGMENT_REF_2, kind: "SEGMENT" });
    const second = await waitFor(
      c.runtime,
      (s) => s.status === "COMPLETED" && s.runId !== first.runId,
      "second segment",
    );
    expect(second.runId).not.toBe(first.runId);
    expect(opened).toHaveLength(1);
  });

  /**
   * A ticket the server refuses must never look like a started run.
   *
   * The host builds no session for an unresolvable ref, so NOTHING answers the command — there is no engine to
   * refuse it. The bounded start is what turns that silence into an answer the card can act on, and it is the
   * only reason a spent or expired ticket does not leave the seller staring at a button that did nothing.
   */
  it("gives up on START_RUN for a ref the server refuses, rather than waiting forever", async () => {
    const opened: WebSocket[] = [];
    const { port, resolved } = await startImportServer();
    const c = await connectImportRuntime(port, opened, AW_CARRIER_IMPORT, { startTimeoutMs: 400 });
    expect(c.ok).toBe(true);
    if (!c.ok) return;

    await expect(c.runtime.start({ launchRef: "dead0dead0dead00", kind: "SEGMENT" })).rejects.toThrow(
      /never acknowledged/,
    );
    // It really did reach the server and really was refused there — not a client-side shortcut.
    expect(resolved).toEqual(["dead0dead0dead00"]);
    expect(c.runtime.snapshot()).toBeNull();
  });

  it("refuses to attach when the agent hosts a different carrier", async () => {
    const opened: WebSocket[] = [];
    const { port } = await startImportServer();
    // The agent announces `import`; this client declares it speaks the v1 export world.
    const c = await connectImportRuntime(port, opened, AW_CARRIER_EXPORT);
    expect(c.ok).toBe(false);
    if (c.ok) return;
    expect(c.reason).toBe("carrier-mismatch");
  });

  it("never puts a launch ref on the wire back to the frontend", async () => {
    const opened: WebSocket[] = [];
    const { port } = await startImportServer();
    const c = await connectImportRuntime(port, opened);
    expect(c.ok).toBe(true);
    if (!c.ok) return;

    await c.runtime.start({ launchRef: SEGMENT_REF, kind: "SEGMENT" });
    await waitFor(c.runtime, (s) => s.status === "COMPLETED", "segment completion");

    const published = JSON.stringify(c.seen);
    expect(published).not.toContain(SEGMENT_REF);
    expect(published).not.toContain(DISCOVERY_REF);
  });
});

describe("cross-stack: the frontend cannot drive what the runtime does not allow", () => {
  it("a command absent from allowedCommands never reaches the agent", async () => {
    const opened: WebSocket[] = [];
    const { port, driver } = await startImportServer({ script: { action: { start_date: false } } });
    const c = await connectImportRuntime(port, opened);
    expect(c.ok).toBe(true);
    if (!c.ok) return;

    await c.runtime.start({ launchRef: SEGMENT_REF, kind: "SEGMENT" });
    const atBarrier = await waitFor(c.runtime, (s) => s.status === "WAITING_FOR_HUMAN", "first barrier");
    expect(atBarrier.allowedCommands).not.toContain("RESUME_RUN");

    const before = driver.calls.length;
    c.runtime.send("RESUME_RUN");
    await new Promise((r) => setTimeout(r, 100));
    // Nothing was driven: the runtime never saw the command, because the FE never sent it.
    expect(driver.calls.length).toBe(before);
  });
});
