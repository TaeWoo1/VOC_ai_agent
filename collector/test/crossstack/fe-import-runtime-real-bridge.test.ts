/**
 * **Cross-stack hermetic E2E — the REAL frontend guided-import runtime against the REAL agent-hosted IMPORT
 * carrier.** The import-side counterpart of `fe-reply-runtime-real-bridge.test.ts` (v2 reply) and
 * `fe-transport-real-bridge.test.ts` (v1 export).
 *
 * ## Why this suite has to exist, specifically for import
 *
 * Every other import test proves ONE side against a stand-in: the collector's `import-session.test.ts` drives
 * the real engine over an in-process loopback, and the frontend's `import/*.test.ts` drive the real runtime
 * against a fake transport. Neither crosses a socket — and the import carrier is the one carrier where the seam
 * between them carries load, for two reasons.
 *
 * **Run identity changes mid-session.** An export or reply agent hosts one run for its lifetime; an onboarding
 * import is a sequence, so `ImportSegmentHost` mints a new identity per run and re-announces it. A frontend that
 * kept its attach-time runId would address the second run's commands to the first one forever.
 *
 * **And copy now travels the other way.** Guidance moved into the marketplace page (2026-07-26), so the
 * frontend hands its prose down as an `aw_guidance_pack` and the agent renders it there. That crossing is only
 * real over a socket: the pack has to survive serialization, reach the session the host just built, and be
 * re-sent for the NEXT segment's session — and a press on that in-page panel has to come back as an ordinary
 * gated command. Neither side alone can show any of it.
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
import type {
  AwClientTransport as AwClientTransportV2,
  AwGuidancePack,
} from "../../../contracts/action-window/v2/transport";
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
/**
 * A ticket kind the agent no longer hosts. Kept in this suite precisely to prove the refusal crosses the wire
 * as silence-then-timeout rather than as a run that appears to start (see the test below).
 */
const DISCOVERY_SCOPE: ResolvedLaunchScope = {
  kind: "DISCOVERY",
  channelCode: CHANNEL,
  requiredStart: "",
  requiredEnd: "",
};

/**
 * A guidance pack in the shape the frontend actually sends, trimmed to what these tests read.
 *
 * The words are deliberately recognizable rather than realistic: what is being proven is that the RUNTIME
 * renders exactly what the FRONTEND wrote, and a marker string makes a substitution failure obvious. The real
 * seller-facing pack is built by `frontend/src/lib/reviewImport.ts` and pinned by its own tests.
 */
const PACK: AwGuidancePack = {
  chrome: {
    product: "SellerOps",
    stepCounter: "STEP {step}/{total}",
    requiredRange: "WINDOW {start} - {end}",
    blockedLabel: "STOPPED",
  },
  steps: {
    "actionWindow.import.setStartDate": "PICK-START",
    "actionWindow.import.setEndDate": "PICK-END",
    "actionWindow.import.applyRange": "PRESS-APPLY",
    "actionWindow.import.export": "PRESS-EXPORT",
    "actionWindow.import.consent": "PRESS-CONFIRM",
  },
  blockers: { SCOPE_MISMATCH: { title: "WRONG-WINDOW", fix: "FIX-THE-DATES" } },
  commands: { CANCEL_RUN: "STOP", REQUEST_STEP_RECHECK: "RECHECK" },
  recheck: {
    byBlocker: { SCOPE_MISMATCH: "RECHECK-DATES" },
    byStep: { "actionWindow.import.export": "RECHECK-EXPORT" },
    fallback: "RECHECK",
  },
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

/**
 * Wait until the panel the driver was last asked to render satisfies a predicate.
 *
 * Separate from {@link waitFor} because the panel is a SECOND publication of the same transition, on a queue: the
 * frontend can already be showing a blocker while the page render is still in flight, and asserting on the panel
 * the moment the snapshot changes would be a race.
 */
async function waitForPanel(
  driver: ImportFixtureDriver,
  predicate: (panel: ReturnType<ImportFixtureDriver["lastGuidance"]>) => boolean,
  label: string,
  timeoutMs = 6000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (driver.guidanceRenders.length > 0 && predicate(driver.lastGuidance())) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(
    `cross-stack import: timed out waiting for ${label} (last panel: ${JSON.stringify(driver.lastGuidance())})`,
  );
}

describe("cross-stack: FE guided-import runtime ↔ real agent-hosted IMPORT carrier", () => {
  /**
   * Range discovery is gone from the product path (2026-07-26): how far back to import is the seller's own
   * choice, made in SellerOps before any marketplace window opens. What a stale client presenting a DISCOVERY
   * ticket must NOT get is a run that looks started, and the bounded start is what makes the refusal legible.
   */
  it("hosts nothing for a DISCOVERY ticket, and says so instead of hanging", async () => {
    const opened: WebSocket[] = [];
    const { port, resolved, driver } = await startImportServer();
    const c = await connectImportRuntime(port, opened, AW_CARRIER_IMPORT, { startTimeoutMs: 400 });
    expect(c.ok).toBe(true);
    if (!c.ok) return;

    await expect(c.runtime.start({ launchRef: DISCOVERY_REF, kind: "DISCOVERY" })).rejects.toThrow(
      /never acknowledged/,
    );
    // It reached the server and was refused THERE, on the kind — not shortcut on the client.
    expect(resolved).toEqual([DISCOVERY_REF]);
    // And the marketplace surface was never touched for work that cannot be hosted.
    expect(driver.calls).toEqual([]);
    expect(c.runtime.snapshot()).toBeNull();
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

/**
 * **The journey the product owner asked for: one start in SellerOps, then finish inside the marketplace window.**
 *
 * Everything here crosses the socket. The pack is authored on the frontend, serialized, delivered to the session
 * the host built, rendered as fully-worded panel state by the runtime, and pressed by the seller — and the press
 * comes back through the same gates a frontend command goes through.
 */
describe("cross-stack: guidance rendered inside the marketplace page", () => {
  it("renders the FRONTEND's words, with the runtime's own step numbers and window", async () => {
    const opened: WebSocket[] = [];
    // No apply control, and the seller does not act — so the run rests at the first date barrier and stays there.
    const { port, driver } = await startImportServer({ script: { action: { start_date: false } } });
    const c = await connectImportRuntime(port, opened);
    expect(c.ok).toBe(true);
    if (!c.ok) return;

    c.runtime.setGuidancePack(PACK);
    await c.runtime.start({ launchRef: SEGMENT_REF, kind: "SEGMENT" });
    await waitFor(c.runtime, (s) => s.status === "WAITING_FOR_HUMAN", "first barrier");
    await waitForPanel(driver, (p) => p.instruction === "PICK-START", "the start-date instruction");

    const panel = driver.lastGuidance();
    expect(panel?.product).toBe("SellerOps");
    // The counter and the window are the RUNTIME's facts substituted into the FRONTEND's templates: neither side
    // could have produced this line alone.
    expect(panel?.stepLine).toBe("STEP 3/8");
    expect(panel?.requiredRange).toBe("WINDOW 2026-06-01 - 2026-06-30");
    expect(panel?.blocked).toBeNull();
  });

  /**
   * The 2026-07-25 failure, closed where it happened. The gate stopped the run, and the seller — who was in the
   * marketplace window — saw an unchanged page with a stale highlight on the field they had just left.
   */
  it("shows the stop, its repair, and a situation-specific recheck control, and takes the highlight down", async () => {
    const opened: WebSocket[] = [];
    const { port, driver, script } = await startImportServer({ script: { scope: "MISMATCH" } });
    const c = await connectImportRuntime(port, opened);
    expect(c.ok).toBe(true);
    if (!c.ok) return;

    c.runtime.setGuidancePack(PACK);
    await c.runtime.start({ launchRef: SEGMENT_REF, kind: "SEGMENT" });
    await waitFor(c.runtime, (s) => s.blocker !== null, "scope block");
    await waitForPanel(driver, (p) => p.blocked !== null, "the blocked panel");

    const panel = driver.lastGuidance();
    // Cause AND repair, both in the window the seller is looking at.
    expect(panel?.blocked).toEqual({ label: "STOPPED", title: "WRONG-WINDOW", fix: "FIX-THE-DATES" });
    // The recheck label is the one for THIS blocker, not the generic fallback (contextual copy).
    expect(panel?.actions).toEqual([
      { command: "REQUEST_STEP_RECHECK", label: "RECHECK-DATES" },
      { command: "CANCEL_RUN", label: "STOP" },
    ]);
    // finding 12: nothing is left pointing at a control the run has stopped waiting for.
    expect(driver.calls).toContain("clearHighlight");

    // And the seller repairs it WITHOUT going back to SellerOps: they fix the dates, then press our panel.
    script.scope = "MATCH";
    driver.pressPanel("REQUEST_STEP_RECHECK");
    const done = await waitFor(c.runtime, (s) => s.status === "COMPLETED", "recovery from the panel alone");
    expect(done.blocker).toBeNull();
    // The panel comes down with the run — a finished run's instructions must not linger on the seller's page.
    await waitForPanel(driver, (p) => p === null, "the panel being removed");
  });

  /**
   * The in-page flag lives in the seller's own page, so it is untrusted input. Only the two commands the panel
   * ever renders may come back through it.
   */
  it("refuses a panel intent that was never a button", async () => {
    const opened: WebSocket[] = [];
    const { port, driver } = await startImportServer({ script: { action: { start_date: false } } });
    const c = await connectImportRuntime(port, opened);
    expect(c.ok).toBe(true);
    if (!c.ok) return;

    c.runtime.setGuidancePack(PACK);
    await c.runtime.start({ launchRef: SEGMENT_REF, kind: "SEGMENT" });
    const atBarrier = await waitFor(c.runtime, (s) => s.status === "WAITING_FOR_HUMAN", "first barrier");
    await waitForPanel(driver, (p) => p.instruction === "PICK-START", "the panel");

    // `SWITCH_TO_MANUAL` IS allowed by the runtime at this barrier — so this proves the panel gate, not the
    // command gate: the seller was never offered that button, so the page cannot press it for them.
    expect(atBarrier.allowedCommands).toContain("SWITCH_TO_MANUAL");
    driver.pressPanel("SWITCH_TO_MANUAL");
    await new Promise((r) => setTimeout(r, 900));
    expect(c.runtime.snapshot()?.status).toBe("WAITING_FOR_HUMAN");
  });

  /**
   * Each segment gets a NEW session on the agent, and a new session starts with no copy at all. Without a
   * re-send the seller would get a guidance panel on their first segment and a silent one on every segment
   * after — worse than never having had it, because by then they are relying on it.
   */
  it("re-sends the pack for the next segment, so the panel is never silent after the first one", async () => {
    const opened: WebSocket[] = [];
    const { port, driver, script } = await startImportServer();
    const c = await connectImportRuntime(port, opened);
    expect(c.ok).toBe(true);
    if (!c.ok) return;

    c.runtime.setGuidancePack(PACK);
    await c.runtime.start({ launchRef: SEGMENT_REF, kind: "SEGMENT" });
    const first = await waitFor(c.runtime, (s) => s.status === "COMPLETED", "first segment");

    // Park the SECOND run at its first barrier, so there is a live panel to read rather than a finished run's
    // teardown. This is also the honest shape of a sitting: the seller works one segment at a time.
    script.action = { start_date: false };
    await c.runtime.start({ launchRef: SEGMENT_REF_2, kind: "SEGMENT" });
    const second = await waitFor(
      c.runtime,
      (s) => s.status === "WAITING_FOR_HUMAN" && s.runId !== first.runId,
      "second segment's first barrier",
    );
    expect(second.runId).not.toBe(first.runId);

    // The second run drew its own panel, in the frontend's words: the pack reached the session the host built
    // for it, not just the one it was first sent to.
    await waitForPanel(driver, (p) => p?.instruction === "PICK-START", "the second run's panel");
    expect(driver.lastGuidance()?.product).toBe("SellerOps");
    expect(opened).toHaveLength(1);
  });

  /**
   * finding 13. The date barrier advances on a value CHANGE, so a field already holding the right date could
   * never satisfy it — the current-month segment's end date defaults to today, and the live run had to set a
   * deliberately wrong date and correct it. The step is skipped instead, and `totalSteps` does not move.
   */
  it("skips a date step whose field already holds the required value, without moving totalSteps", async () => {
    const opened: WebSocket[] = [];
    const { port, driver } = await startImportServer({
      script: { prefilled: { start_date: true, end_date: true } },
    });
    const c = await connectImportRuntime(port, opened);
    expect(c.ok).toBe(true);
    if (!c.ok) return;

    await c.runtime.start({ launchRef: SEGMENT_REF, kind: "SEGMENT" });
    const done = await waitFor(c.runtime, (s) => s.status === "COMPLETED", "segment completion");

    // Neither date control was annotated, armed, or awaited — the seller was asked for nothing they had
    // already done.
    expect(driver.calls).not.toContain("highlight:start_date");
    expect(driver.calls).not.toContain("observe:end_date");
    expect(driver.calls).toContain("prefilled:start_date:2026-06-01..2026-06-30");
    // The gate still ran: a skipped step is a step nobody needed, not a check nobody made.
    expect(driver.calls).toContain("scope:2026-06-01..2026-06-30");
    // Same denominator as a run where both dates were set by hand.
    expect(done.step?.totalSteps).toBe(8);
    const totals = new Set(c.seen.map((s) => s.step?.totalSteps));
    expect([...totals]).toEqual([8]);
  });

  it("never renders a panel at all when the frontend has sent no words", async () => {
    const opened: WebSocket[] = [];
    const { port, driver } = await startImportServer({ script: { action: { start_date: false } } });
    const c = await connectImportRuntime(port, opened);
    expect(c.ok).toBe(true);
    if (!c.ok) return;

    // No `setGuidancePack`. There is no runtime-authored fallback to fall back to — that absence is what makes
    // "the frontend owns every word" structural rather than remembered.
    await c.runtime.start({ launchRef: SEGMENT_REF, kind: "SEGMENT" });
    await waitFor(c.runtime, (s) => s.status === "WAITING_FOR_HUMAN", "first barrier");
    await new Promise((r) => setTimeout(r, 700));
    expect(driver.guidanceRenders).toEqual([]);
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
