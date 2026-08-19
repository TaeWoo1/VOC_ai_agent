import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import {
  BRIDGE_ONLY_FLAG,
  bridgeOnlyRefusalMessage,
  resolveBridgeOnlyMode,
} from "../../src/cli/bridge-only-gate";
import { ACTION_WINDOW_IMPORT_FLAG, OTHER_CARRIER_FLAGS } from "../../src/cli/import-mode-gate";
import { decideRun, runBridgeOnlyBoot, shouldExitAfterBoot } from "../../src/cli/local-agent";

const DEV = { NODE_ENV: "test" } as NodeJS.ProcessEnv;

// ── the gate (pure) ────────────────────────────────────────────────────────────────────────────────
describe("resolveBridgeOnlyMode", () => {
  it("is closed by default and refuses to combine with --connections or any carrier", () => {
    expect(resolveBridgeOnlyMode([], DEV)).toEqual({ host: false, reason: "NOT_REQUESTED" });
    expect(resolveBridgeOnlyMode(["--connections", "c.json"], DEV)).toEqual({ host: false, reason: "NOT_REQUESTED" });
    expect(resolveBridgeOnlyMode([BRIDGE_ONLY_FLAG], DEV)).toEqual({ host: true });
    expect(resolveBridgeOnlyMode([BRIDGE_ONLY_FLAG, "--connections", "c.json"], DEV)).toEqual({
      host: false,
      reason: "CONNECTIONS_CONFLICT",
    });
    for (const carrier of [ACTION_WINDOW_IMPORT_FLAG, ...OTHER_CARRIER_FLAGS]) {
      expect(resolveBridgeOnlyMode([BRIDGE_ONLY_FLAG, carrier], DEV)).toEqual({ host: false, reason: "CARRIER_CONFLICT" });
    }
    // production does not change the answer: nothing live is opened by this mode.
    expect(resolveBridgeOnlyMode([BRIDGE_ONLY_FLAG], { NODE_ENV: "production" } as NodeJS.ProcessEnv)).toEqual({ host: true });
  });

  it("refusals are one operator line; NOT_REQUESTED is silent", () => {
    expect(bridgeOnlyRefusalMessage("NOT_REQUESTED")).toBeNull();
    expect(bridgeOnlyRefusalMessage("CONNECTIONS_CONFLICT")).toContain("--connections");
    expect(bridgeOnlyRefusalMessage("CARRIER_CONFLICT")).toContain("carrier");
  });
});

// ── the boot ───────────────────────────────────────────────────────────────────────────────────────
describe("runBridgeOnlyBoot", () => {
  const cleanups: Array<() => Promise<void> | void> = [];
  afterEach(async () => {
    while (cleanups.length) await cleanups.pop()!();
  });

  it("boots with no connections file, serves /bridge/health, launches nothing, and stays resident until a signal", async () => {
    const dir = mkdtempSync(join(tmpdir(), `bridge-only-${randomUUID()}-`));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const lines: string[] = [];
    const handlers: Record<string, () => void> = {};
    let exited = 0;
    // No marketplace env at all (no NAVER_*, no STORAGE_*, no approval flag) — the boot must not need any.
    const env = { NODE_ENV: "test" } as NodeJS.ProcessEnv;
    const handle = await runBridgeOnlyBoot([BRIDGE_ONLY_FLAG], env, {
      bridgeConfigOverride: { port: 0, pairingFile: join(dir, "pairings.json") },
      onSignal: (sig, h) => void (handlers[sig] = h),
      print: (l) => void lines.push(l),
      exit: () => void exited++,
    });
    cleanups.push(() => handle.shutdown());
    expect(handle.listen.ok).toBe(true);
    const port = (handle.listen as { ok: true; port: number }).port;

    const boot = JSON.parse(lines[0]!);
    expect(boot).toMatchObject({ mode: "BRIDGE_ONLY", ok: true, port, browserLaunched: false, marketplaceOpened: false });
    expect(boot.approvalPresenter).toBe("dev_tty_stderr");

    const health = await fetch(`http://127.0.0.1:${port}/bridge/health`, { headers: { Origin: "http://localhost:5173" } });
    expect(health.status).toBe(200);
    const body = (await health.json()) as Record<string, unknown>;
    expect(body).toHaveProperty("agentVersion");
    // The health answer is sanitized — no connections, no paths, no env.
    expect(JSON.stringify(body)).not.toMatch(/pairings\.json|NAVER|STORAGE/);

    // Both signals are registered; still resident before either fires.
    expect(Object.keys(handlers).sort()).toEqual(["SIGINT", "SIGTERM"]);
    let settled = false;
    void handle.stopped.then(() => (settled = true));
    await new Promise((r) => setTimeout(r, 20));
    expect(settled).toBe(false);

    // SIGTERM → idempotent shutdown → the bridge is torn down exactly once even on a double signal (process.exit
    // itself is harmlessly idempotent, so only the teardown count matters).
    handlers.SIGTERM!();
    handlers.SIGINT!();
    await handle.stopped;
    await new Promise((r) => setTimeout(r, 20));
    expect(exited).toBeGreaterThanOrEqual(1);
    const stoppedLine = JSON.stringify({ mode: "BRIDGE_ONLY", stopped: true });
    expect(lines.filter((l) => l === stoppedLine)).toHaveLength(1);
    expect(lines.at(-1)).toBe(stoppedLine);
    await expect(fetch(`http://127.0.0.1:${port}/bridge/health`)).rejects.toBeTruthy();
  });

  it("reuses an existing pairings file rather than starting a new pairing store", async () => {
    const dir = mkdtempSync(join(tmpdir(), `bridge-only-${randomUUID()}-`));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const pairingFile = join(dir, "pairings.json");
    // Same store format the connector boot writes; a bridge-only boot must read it, not replace it.
    writeFileSync(pairingFile, JSON.stringify({ version: 1, pairings: [] }));
    const handle = await runBridgeOnlyBoot([BRIDGE_ONLY_FLAG], DEV, {
      bridgeConfigOverride: { port: 0, pairingFile },
      onSignal: () => {},
      print: () => {},
      exit: () => {},
    });
    cleanups.push(() => handle.shutdown());
    expect(handle.listen.ok).toBe(true);
  });

  it("a bound port is a skipped listen (no resident process), never a second silent helper", async () => {
    const dir = mkdtempSync(join(tmpdir(), `bridge-only-${randomUUID()}-`));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const first = await runBridgeOnlyBoot([BRIDGE_ONLY_FLAG], DEV, {
      bridgeConfigOverride: { port: 0, pairingFile: join(dir, "a.json") },
      onSignal: () => {},
      print: () => {},
      exit: () => {},
    });
    cleanups.push(() => first.shutdown());
    const port = (first.listen as { ok: true; port: number }).port;
    const second = await runBridgeOnlyBoot([BRIDGE_ONLY_FLAG], DEV, {
      bridgeConfigOverride: { port, pairingFile: join(dir, "b.json") },
      onSignal: () => {},
      print: () => {},
      exit: () => {},
    });
    expect(second.listen).toEqual({ ok: false, skipped: true, reason: "already_running" });
  });
});

// ── the existing path is untouched ─────────────────────────────────────────────────────────────────
describe("--connections path regression", () => {
  it("decideRun still rejects an empty connections set, and an all-SKIPPED connector boot still exits", () => {
    expect(decideRun([], "[]", DEV)).toMatchObject({ mode: "PARSE_ERROR" });
    expect(shouldExitAfterBoot({ managedConnectionCount: 0, hostsBridgeCarrier: false })).toBe(true);
    // the new flag is invisible to decideRun — it never reaches it
    expect(decideRun([BRIDGE_ONLY_FLAG], "[]", DEV)).toMatchObject({ mode: "PARSE_ERROR" });
  });
});

// ── the on-demand guided walk (2026-08-19) ─────────────────────────────────────────────────────────
import WebSocket from "ws";
import { randomBytes } from "node:crypto";
import {
  ACTION_WINDOW_PROTOCOL_VERSION,
  type ActionWindowRunView,
} from "../../../contracts/action-window/v2/index";
import { deserializeFrame, serializeFrame, type AwServerFrame } from "../../../contracts/action-window/v2/transport";
import { AW_CARRIER_ISSUANCE } from "../../../contracts/action-window/aw-carrier-kind";
import {
  activateCoupangGuidedWalk,
  activateNaverGuidedWalk,
  activateResidentCarrier,
  RESIDENT_ON_DEMAND_CARRIERS,
  type CoupangIssuanceLiveCarrier,
  type NaverIssuanceLiveCarrier,
} from "../../src/cli/local-agent";
import { CoupangIssuanceFixtureDriver } from "../../src/action-window/coupang-issuance/coupang-issuance-fixture-driver";
import { IssuanceFixtureDriver } from "../../src/action-window/api-issuance/issuance-fixture-driver";

const APP = "http://localhost:5173";

/** A carrier shaped like the live one, driven by the SYNTHETIC fixture — no browser can open in a test. */
function fixtureCarrier(): CoupangIssuanceLiveCarrier & { closed: number } {
  const driver = new CoupangIssuanceFixtureDriver();
  const c = {
    closed: 0,
    config: { runId: `run_${randomBytes(6).toString("hex")}`, channelCode: "coupang", createDriver: () => driver },
    closeSurface: async () => void c.closed++,
    isSurfaceOpen: () => false,
  };
  return c;
}

/** The NAVER twin of {@link fixtureCarrier} — the real session/engine over the SYNTHETIC API-center driver. */
function naverFixtureCarrier(): NaverIssuanceLiveCarrier & { closed: number } {
  const driver = new IssuanceFixtureDriver();
  const c = {
    closed: 0,
    config: { runId: `run_${randomBytes(6).toString("hex")}`, channelCode: "naver", createDriver: () => driver },
    closeSurface: async () => void c.closed++,
    isSurfaceOpen: () => false,
  };
  return c;
}

async function pairedTicket(port: number): Promise<string> {
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(`http://127.0.0.1:${port}${path}`, { method: "POST", headers: { "Content-Type": "application/json", Origin: APP, ...headers }, body: JSON.stringify(body) });
  const req = (await (await post("/bridge/pair/request", { workspaceLabel: "t" })).json()) as { requestId: string };
  const token = ((await (await post("/bridge/pair/poll", { requestId: req.requestId })).json()) as { pairingToken: string }).pairingToken;
  return ((await (await post("/bridge/ws-ticket", { clientProtocolVersion: 1 }, { Authorization: `Bearer ${token}` })).json()) as { ticket: string }).ticket;
}

function openTab(port: number, ticket: string) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/bridge/ws?ticket=${encodeURIComponent(ticket)}`, { headers: { Origin: APP } });
  const announcements: Array<Record<string, unknown>> = [];
  const frames: AwServerFrame[] = [];
  let view: ActionWindowRunView | null = null;
  ws.on("message", (data: WebSocket.RawData) => {
    const msg = JSON.parse(data.toString()) as Record<string, unknown>;
    if (msg.type === "aw_session") announcements.push(msg);
    if (msg.type === "aw" && typeof msg.payload === "string") {
      const f = deserializeFrame(msg.payload) as AwServerFrame;
      frames.push(f);
      if (f.kind === "aw_view") view = f.view;
      if (f.kind === "aw_resync_result" && f.view) view = f.view;
    }
  });
  const opened = new Promise<void>((r) => ws.once("open", () => r()));
  const until = async (pred: () => boolean, ms = 3000) => {
    const t0 = Date.now();
    while (!pred()) {
      if (Date.now() - t0 > ms) throw new Error("timeout");
      await new Promise((r) => setTimeout(r, 15));
    }
  };
  return { ws, opened, announcements, frames, view: () => view, until };
}

describe("activateCoupangGuidedWalk", () => {
  it("serves exactly issuance/coupang and nothing else; building it opens no window", () => {
    expect(activateCoupangGuidedWalk({ carrier: "import", channelCode: "naver" })).toBeNull();
    expect(activateCoupangGuidedWalk({ carrier: AW_CARRIER_ISSUANCE, channelCode: "naver" })).toBeNull();
    expect(activateCoupangGuidedWalk({ carrier: "locate", channelCode: "coupang" })).toBeNull();
    const live = fixtureCarrier();
    let built = 0;
    const c = activateCoupangGuidedWalk({ carrier: AW_CARRIER_ISSUANCE, channelCode: "coupang" }, { buildCarrier: () => (built++, live) });
    expect(c).not.toBeNull();
    expect(built).toBe(1);
    expect(c!.isSettled()).toBe(true); // no run started yet
    expect(c!.isSurfaceOpen()).toBe(false);
  });
});

describe("runBridgeOnlyBoot — the guided walk on demand", () => {
  const cleanups: Array<() => Promise<void> | void> = [];
  afterEach(async () => {
    while (cleanups.length) await cleanups.pop()!();
  });

  it("idle announces nothing; aw_attach issuance/coupang activates + announces; START_RUN runs the walk on the EXISTING session; release → idle; shutdown tears down", async () => {
    const dir = mkdtempSync(join(tmpdir(), `bridge-only-od-${randomUUID()}-`));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const lines: string[] = [];
    const live = fixtureCarrier();
    const handle = await runBridgeOnlyBoot([BRIDGE_ONLY_FLAG], { NODE_ENV: "test" } as NodeJS.ProcessEnv, {
      bridgeConfigOverride: { port: 0, pairingFile: join(dir, "pairings.json"), autoApprovePairing: true },
      onSignal: () => undefined,
      print: (l) => void lines.push(l),
      exit: () => undefined,
      activateCarrier: (req) => activateCoupangGuidedWalk(req, { buildCarrier: () => live }),
    });
    cleanups.push(() => handle.shutdown());
    expect(handle.listen.ok).toBe(true);
    const port = (handle.listen as { ok: true; port: number }).port;
    const boot = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(boot).toMatchObject({
      mode: "BRIDGE_ONLY",
      browserLaunched: false,
      marketplaceOpened: false,
      onDemandCarriers: ["issuance/coupang", "issuance/naver", "renewal/coupang", "locate/coupang", "import/naver"],
    });

    // 1. A tab that does not ask sees bridge-only as it always was: hello + snapshot, NO aw_session.
    const ticket1 = await pairedTicket(port);
    const quiet = openTab(port, ticket1);
    await quiet.opened;
    await new Promise((r) => setTimeout(r, 150));
    expect(quiet.announcements).toHaveLength(0);
    expect(handle.carrierHost.state().active).toBe(false);

    // 2. The connect screen asks for the guided walk → activation + announcement, to the asking tab AND the quiet one.
    const tab = openTab(port, await pairedTicket(port));
    await tab.opened;
    // Malformed / unknown requests are dropped at the server before any endpoint sees them.
    tab.ws.send(JSON.stringify({ type: "aw_attach", carrier: AW_CARRIER_ISSUANCE, channelCode: "Coupang; drop" }));
    tab.ws.send(JSON.stringify({ type: "aw_attach", carrier: "not-a-carrier", channelCode: "coupang" }));
    await new Promise((r) => setTimeout(r, 100));
    expect(handle.carrierHost.state().active).toBe(false);
    tab.ws.send(JSON.stringify({ type: "aw_attach", carrier: AW_CARRIER_ISSUANCE, channelCode: "coupang" }));
    await tab.until(() => tab.announcements.length > 0);
    expect(tab.announcements[0]).toMatchObject({ type: "aw_session", carrier: AW_CARRIER_ISSUANCE, channelCode: "coupang", runId: live.config.runId });
    await quiet.until(() => quiet.announcements.length > 0);
    expect(handle.carrierHost.state()).toMatchObject({ active: true, carrier: "issuance", channelCode: "coupang", attachedClients: 1 });
    expect(live.closed).toBe(0); // nothing opened, nothing closed

    // 3. START_RUN on the announced run → the real engine/session publish a view (fixture driver, no browser).
    tab.ws.send(JSON.stringify({ type: "aw", payload: serializeFrame({ kind: "aw_command", command: {
      protocolVersion: ACTION_WINDOW_PROTOCOL_VERSION, commandId: `${live.config.runId}-t1`, runId: live.config.runId, expectedRevision: 0,
      type: "START_RUN" as never, payload: { channelCode: "coupang", intent: "API_ISSUANCE_GUIDANCE" } as never } }) }));
    await tab.until(() => tab.view() !== null);
    expect(tab.view()!.runId).toBe(live.config.runId);
    expect(tab.view()!.channelCode).toBe("coupang");
    expect(JSON.stringify(tab.view())).not.toMatch(/secret|password|token/i);

    // 4. The fixture walk runs to COMPLETED on the runtime's own advances (no FE step). The tab leaves: settled +
    //    no window → the host releases and the helper is bridge-only again.
    await tab.until(() => tab.view()!.status === "COMPLETED", 5000);
    tab.ws.close();
    await new Promise((r) => setTimeout(r, 100));
    expect(await handle.carrierHost.maybeRelease()).toBe(true);
    expect(handle.carrierHost.state().active).toBe(false);
    expect(live.closed).toBe(1);

    // 5. Idle again: a fresh tab gets no announcement until it asks; a fresh ask activates a NEW run.
    const tab3 = openTab(port, await pairedTicket(port));
    await tab3.opened;
    await new Promise((r) => setTimeout(r, 100));
    expect(tab3.announcements).toHaveLength(0);
    quiet.ws.close();
    tab3.ws.close();
    await handle.shutdown();
    expect(lines.at(-1)).toBe(JSON.stringify({ mode: "BRIDGE_ONLY", stopped: true }));
  });
});

// ── the NAVER guided walk, on demand from the SAME resident helper (2026-08-19) ────────────────────
describe("activateNaverGuidedWalk", () => {
  it("serves exactly issuance/naver and nothing else; building it opens no window", () => {
    expect(activateNaverGuidedWalk({ carrier: "import", channelCode: "naver" })).toBeNull();
    expect(activateNaverGuidedWalk({ carrier: AW_CARRIER_ISSUANCE, channelCode: "coupang" })).toBeNull();
    expect(activateNaverGuidedWalk({ carrier: "locate", channelCode: "naver" })).toBeNull();
    const live = naverFixtureCarrier();
    let built = 0;
    const c = activateNaverGuidedWalk({ carrier: AW_CARRIER_ISSUANCE, channelCode: "naver" }, { buildCarrier: () => (built++, live) });
    expect(c).not.toBeNull();
    expect(built).toBe(1);
    expect(c!.isSettled()).toBe(true); // no run started yet
    expect(c!.isSurfaceOpen()).toBe(false);
  });
});

describe("activateResidentCarrier", () => {
  it("routes every wired carrier and refuses everything else — the seller never picks a carrier", () => {
    // Each activator builds its own real carrier here (no injected fixture), which is safe precisely because
    // building opens NO window — the lazy driver launches on the run's first call, and no run is started.
    // That property is the whole reason the resident helper can host five carriers and still be idle.
    const wired: readonly (readonly [string, string])[] = [
      [AW_CARRIER_ISSUANCE, "coupang"],
      [AW_CARRIER_ISSUANCE, "naver"],
      // The renewal walk is its OWN carrier. It used to ask for `issuance`/`coupang`, so the first-time engine
      // answered a 갱신 page and every step arrived under a copy key that screen cannot render.
      ["renewal", "coupang"],
      // Live-proven since 2026-08-15 and 2026-07-25 respectively, but hosted only by seated-operator harnesses
      // until now — a seller with the resident helper paired pressed [쿠팡에서 보기] / 가져오기 into nothing.
      ["locate", "coupang"],
      ["import", "naver"],
    ];
    for (const [carrier, channelCode] of wired) {
      const activated = activateResidentCarrier({ carrier, channelCode });
      expect(activated, `${carrier}/${channelCode}`).not.toBeNull();
      // Building opened NOTHING. This is the assertion that keeps "idle helper" true as carriers are added.
      expect(activated!.isSurfaceOpen(), `${carrier}/${channelCode}`).toBe(false);
    }
    // Still unwired, and refused rather than served by the wrong walk: the NAVER guided REPLY carrier is
    // hosted by its own boot, and no channel other than the three named above has any of these surfaces.
    expect(activateResidentCarrier({ carrier: "reply", channelCode: "naver" })).toBeNull();
    expect(activateResidentCarrier({ carrier: AW_CARRIER_ISSUANCE, channelCode: "cafe24" })).toBeNull();
    expect(activateResidentCarrier({ carrier: "renewal", channelCode: "naver" })).toBeNull();
    expect(activateResidentCarrier({ carrier: "locate", channelCode: "naver" })).toBeNull();
    expect(activateResidentCarrier({ carrier: "import", channelCode: "coupang" })).toBeNull();
    // The advertised names and what is actually servable are the same list — a boot line that promised a
    // carrier nobody serves would send a seller to a screen that then reports "no agent".
    expect([...RESIDENT_ON_DEMAND_CARRIERS]).toEqual([
      "issuance/coupang",
      "issuance/naver",
      "renewal/coupang",
      "locate/coupang",
      "import/naver",
    ]);
    for (const name of RESIDENT_ON_DEMAND_CARRIERS) {
      const [carrier, channelCode] = name.split("/") as [string, string];
      expect(activateResidentCarrier({ carrier, channelCode }), name).not.toBeNull();
    }
  });
});

describe("runBridgeOnlyBoot — the NAVER guided walk on demand", () => {
  const cleanups: Array<() => Promise<void> | void> = [];
  afterEach(async () => {
    while (cleanups.length) await cleanups.pop()!();
  });

  it("aw_attach issuance/naver activates + announces the NAVER walk on the resident helper; a second, different carrier is refused; shutdown tears the window down", async () => {
    const dir = mkdtempSync(join(tmpdir(), `bridge-only-naver-${randomUUID()}-`));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const lines: string[] = [];
    const live = naverFixtureCarrier();
    const handle = await runBridgeOnlyBoot([BRIDGE_ONLY_FLAG], { NODE_ENV: "test" } as NodeJS.ProcessEnv, {
      bridgeConfigOverride: { port: 0, pairingFile: join(dir, "pairings.json"), autoApprovePairing: true },
      onSignal: () => undefined,
      print: (l) => void lines.push(l),
      exit: () => undefined,
      // The COMPOSED activator, with only the NAVER carrier's construction replaced by the fixture — so this
      // exercises the same routing the product boot uses.
      activateCarrier: (req) =>
        activateCoupangGuidedWalk(req) ?? activateNaverGuidedWalk(req, { buildCarrier: () => live }),
    });
    cleanups.push(() => handle.shutdown());
    expect(handle.listen.ok).toBe(true);
    const port = (handle.listen as { ok: true; port: number }).port;

    const tab = openTab(port, await pairedTicket(port));
    await tab.opened;
    await new Promise((r) => setTimeout(r, 100));
    expect(tab.announcements).toHaveLength(0); // idle: the resident helper announces nothing

    tab.ws.send(JSON.stringify({ type: "aw_attach", carrier: AW_CARRIER_ISSUANCE, channelCode: "naver" }));
    await tab.until(() => tab.announcements.length > 0);
    expect(tab.announcements[0]).toMatchObject({ type: "aw_session", carrier: AW_CARRIER_ISSUANCE, channelCode: "naver", runId: live.config.runId });
    expect(handle.carrierHost.state()).toMatchObject({ active: true, carrier: "issuance", channelCode: "naver", attachedClients: 1 });
    expect(live.closed).toBe(0); // attaching opens nothing and closes nothing

    // START_RUN drives the REAL engine/session over the synthetic API-center driver — no browser exists.
    tab.ws.send(JSON.stringify({ type: "aw", payload: serializeFrame({ kind: "aw_command", command: {
      protocolVersion: ACTION_WINDOW_PROTOCOL_VERSION, commandId: `${live.config.runId}-n1`, runId: live.config.runId, expectedRevision: 0,
      type: "START_RUN" as never, payload: { channelCode: "naver", intent: "API_ISSUANCE_GUIDANCE" } as never } }) }));
    await tab.until(() => tab.view() !== null);
    expect(tab.view()!.runId).toBe(live.config.runId);
    expect(tab.view()!.channelCode).toBe("naver");
    expect(JSON.stringify(tab.view())).not.toMatch(/secret|password|token|apicenter/i);

    // ONE slot: a Coupang tab asking while the NAVER walk is live gets no announcement (it takes its own
    // fallback), and the live walk is untouched.
    const other = openTab(port, await pairedTicket(port));
    await other.opened;
    other.ws.send(JSON.stringify({ type: "aw_attach", carrier: AW_CARRIER_ISSUANCE, channelCode: "coupang" }));
    await new Promise((r) => setTimeout(r, 150));
    expect(handle.carrierHost.state()).toMatchObject({ active: true, channelCode: "naver" });
    other.ws.close();

    tab.ws.close();
    await new Promise((r) => setTimeout(r, 80));
    await handle.shutdown();
    expect(live.closed).toBe(1); // the window the walk would have opened is closed with the helper
    expect(handle.carrierHost.state().active).toBe(false);
  });
});

describe("the NAVER live carrier — the same structural promises the WING one is held to", () => {
  const HERE = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(resolve(HERE, "../../src/cli/local-agent.ts"), "utf8");
  const fn = (() => {
    const from = src.indexOf("export function buildNaverIssuanceLiveConfig");
    return src.slice(from, src.indexOf("\nexport function activateNaverGuidedWalk", from));
  })();
  const codeOnly = fn.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

  it("opens NO window at agent boot, and navigates EXACTLY ONCE — the landing, screened first", () => {
    // Lazily: the launch lives inside `open()`, which the session calls on the seller's own START_RUN.
    expect(codeOnly).toContain("new LazyNaverIssuanceDriver({");
    expect(codeOnly).toContain("open: async () =>");
    // ONE navigation, and it is named. A second goto would be a route THROUGH the flow — a different capability.
    expect(codeOnly.split(".goto(").length - 1).toBe(1);
    expect(codeOnly).toContain("NAVER_API_CENTER_GUIDED_WALK_LANDING_URL");
    // Screened BEFORE it is used — an off-target destination opens nothing.
    expect(codeOnly.indexOf("screenApiCenterUrl")).toBeLessThan(codeOnly.indexOf(".goto("));
    expect(codeOnly).toContain("if (screened.ok)");
    // ONE driver for the carrier's lifetime — a re-attach reuses the seller's window, never opens a second.
    expect(codeOnly).toContain("createDriver: () => driver");
    // Release RETIRES the driver; `markClosed` alone means "re-open on the next call", which is what brought
    // the WING window back on the first on-demand release (2026-08-19).
    expect(codeOnly).toContain("driver.retire()");
  });

  it("never clicks, types, submits, or reads a value — it has no method that could", () => {
    for (const name of ["click(", ".fill(", ".type(", ".press(", "setInputFiles(", "textContent", "innerText"]) {
      expect(codeOnly, name).not.toContain(name);
    }
  });

  it("lands on the SAME API-center entry the product's own text checklist opens", () => {
    const tutorial = readFileSync(
      resolve(HERE, "../../../frontend/src/lib/guidedConnection/tutorial.ts"),
      "utf8",
    );
    const landing = /NAVER_API_CENTER_GUIDED_WALK_LANDING_URL = "([^"]+)"/.exec(src)?.[1];
    const checklist = /NAVER_API_CENTER_URL = "([^"]+)"/.exec(tutorial)?.[1];
    expect(landing).toBeTruthy();
    // Guided and text must not drift apart about where the seller goes.
    expect(landing).toBe(checklist);
  });
});
