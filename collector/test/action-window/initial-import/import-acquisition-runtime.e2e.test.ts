/**
 * **Offline headless E2E — the Acquisition Supervisor wired in front of the REAL import runtime, no FE, no
 * browser, no socket, no NAVER.**
 *
 * The unit tests pin each piece; this proves them together the way the live boot assembles them: a real
 * `ImportSegmentHost` + `InitialImportEndpoint`, the real `ImportAcquisitionCoordinator` as the BEFORE_WORK
 * admission gate, and the real `ReadinessObservingImportDriver` decorator feeding readiness off each run's own
 * `prepareSurface` — over the scriptable `ImportFixtureDriver` standing in for the seller's clicks. The one
 * thing that cannot be real offline is the backend, so `resolveScope` is a stub, exactly as the cross-stack
 * suite does it.
 *
 * What it proves end to end:
 *  - the four probe moments fire at their real sites (AGENT_START at boot; BEFORE_WORK / SESSION_FAILURE /
 *    MANUAL_RECHECK off the runtime);
 *  - `adapterId === NONE` blocks a run before anything is assembled;
 *  - a bound adapter dispatches, and a session that fails recoverably recovers on the seller's retry;
 *  - **equivalence**: the choreography the driver sees is byte-for-byte identical to a run with no coordinator.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearLogSink, getLogSink } from "../../../src/log";
import { InitialImportEndpoint } from "../../../src/bridge/initial-import-endpoint";
import { ImportSegmentHost, type ResolvedLaunchScope } from "../../../src/action-window/initial-import/import-host";
import {
  ImportFixtureDriver,
  type ImportFixtureScript,
} from "../../../src/action-window/initial-import/import-fixture-driver";
import { ImportAcquisitionCoordinator } from "../../../src/action-window/initial-import/import-acquisition-coordinator";
import { ReadinessObservingImportDriver } from "../../../src/action-window/initial-import/readiness-observing-driver";
import { ImportSegmentEngine, makeImportClock } from "../../../src/action-window/initial-import/import-engine";
import { ImportSegmentSession } from "../../../src/action-window/initial-import/import-session";
import type { ActionWindowRunView } from "../../../../contracts/action-window/v2/index";
import type { AwClientFrame, AwServerFrame } from "../../../../contracts/action-window/v2/transport";

const REF_A = "9f2a1c7b4e6d0835";
const REF_B = "1122334455667788";

function scope(): ResolvedLaunchScope {
  return { kind: "SEGMENT", channelCode: "naver", requiredStart: "2026-06-01", requiredEnd: "2026-06-30" };
}

function startRun(importRef: string): AwClientFrame {
  return {
    kind: "aw_command",
    command: {
      protocolVersion: 2,
      commandId: `c-${importRef}`,
      runId: "run_announce",
      expectedRevision: 0,
      type: "START_RUN",
      payload: { channelCode: "naver", intent: "INITIAL_REVIEW_IMPORT_SEGMENT", importRef },
    },
  } as AwClientFrame;
}

/** A real host wired the way the live boot wires it, over a scriptable driver. */
function buildWired(opts: { script?: ImportFixtureScript; coordinator?: ImportAcquisitionCoordinator } = {}) {
  const coordinator = opts.coordinator ?? new ImportAcquisitionCoordinator("naver");
  const fixture = new ImportFixtureDriver(opts.script ?? {});
  const driver = new ReadinessObservingImportDriver(fixture, (res) => coordinator.observeSurfaceReading(res));
  const endpoint = new InitialImportEndpoint({ runId: "run_announce", channelCode: "naver" });
  const host = new ImportSegmentHost({
    endpoint,
    channelCode: "naver",
    resolveScope: async (ref) => (ref === REF_A || ref === REF_B ? scope() : null),
    driver,
    admit: () => coordinator.admitSegment(),
  });
  host.attach();
  return { coordinator, fixture, endpoint, host };
}

/** A bare host with NO coordinator and the plain fixture driver — the equivalence baseline. */
function buildBaseline(script: ImportFixtureScript = {}) {
  const fixture = new ImportFixtureDriver(script);
  const endpoint = new InitialImportEndpoint({ runId: "run_announce", channelCode: "naver" });
  const host = new ImportSegmentHost({
    endpoint,
    channelCode: "naver",
    resolveScope: async (ref) => (ref === REF_A || ref === REF_B ? scope() : null),
    driver: fixture,
  });
  host.attach();
  return { fixture, endpoint, host };
}

async function settle(host: ImportSegmentHost) {
  for (let i = 0; i < 60; i++) await new Promise((r) => setTimeout(r, 0));
  await host.activeSession()?.whenSettled();
}

const readinessProbes = () => getLogSink().filter((e) => e.event === "readiness_probe");

beforeEach(() => clearLogSink());
afterEach(() => clearLogSink());

describe("offline E2E: supervisor-gated import runtime", () => {
  it("AGENT_START records the channel UNOBSERVED before any run", () => {
    const { coordinator } = buildWired();
    coordinator.onAgentStart();
    expect(coordinator.readiness()).toBe("UNOBSERVED_EXTERNAL");
    expect(readinessProbes().at(-1)?.meta).toMatchObject({ reason: "AGENT_START", readiness: "UNOBSERVED_EXTERNAL" });
  });

  it("dispatches a bound adapter, drives the run to ingest, and records READY via BEFORE_WORK", async () => {
    const { coordinator, fixture, endpoint, host } = buildWired();
    coordinator.onAgentStart();

    endpoint.replayClientFrame(startRun(REF_A));
    await settle(host);

    // The run actually ran end to end (a real host, session, and engine) and ingested.
    expect(fixture.calls).toContain("prepareSurface");
    expect(fixture.calls.some((c) => c.startsWith("ingest:"))).toBe(true);
    expect(endpoint.hostedRunId()).toMatch(/^run_[0-9a-f]{12}$/);
    // BEFORE_WORK: the run's own pre-work probe read a usable session.
    expect(coordinator.readiness()).toBe("READY");
    expect(readinessProbes().some((e) => e.meta.reason === "BEFORE_WORK" && e.meta.readiness === "READY")).toBe(true);
    // The admission that let it start was recorded as a DISPATCH-able bound adapter.
    const admit = getLogSink().find((e) => e.event === "acquisition_admit");
    expect(admit?.meta).toMatchObject({ admit: true, adapter: "NAVER_ACTION_WINDOW_IMPORT" });
  });

  it("auto-resumes each barrier on the seller's observed action (the Action Window mechanic)", async () => {
    const { fixture, host, endpoint } = buildWired();
    endpoint.replayClientFrame(startRun(REF_A));
    await settle(host);
    // Each barrier armed observation and, once the seller acted, the chain advanced automatically to the next
    // step without any command — observe → advance, all the way to ingest.
    expect(fixture.calls).toContain("observe:start_date");
    expect(fixture.calls).toContain("observe:consent");
    expect(fixture.calls.some((c) => c.startsWith("ingest:"))).toBe(true);
  });

  it("BLOCKS a run when no adapter is bound (adapterId === NONE), assembling nothing", async () => {
    // A coordinator bound to a channel §4.1 has not integrated → NONE. The server still authorizes the ticket,
    // but there is no adapter to carry the work, so the host must not start a run.
    const noneCoordinator = new ImportAcquisitionCoordinator("coupang");
    const { fixture, endpoint, host } = buildWired({ coordinator: noneCoordinator });

    endpoint.replayClientFrame(startRun(REF_A));
    await settle(host);

    expect(host.activeSession()).toBeNull();
    expect(fixture.calls).toEqual([]); // the marketplace surface was never touched
    expect(endpoint.hostedRunId()).toBe("run_announce"); // no re-announcement of a run that cannot exist
    expect(getLogSink().some((e) => e.event === "aw_import_host_acquisition_refused")).toBe(true);
  });

  it("recovers a recoverable session failure on the seller's retry (SESSION_FAILURE → MANUAL_RECHECK)", async () => {
    const script: ImportFixtureScript = { surface: { ok: false, blockerCode: "LOGIN_REQUIRED" } };
    const { coordinator, fixture, endpoint, host } = buildWired({ script });

    // Run 1: the pre-work probe finds the seller is not logged in. The run fails recoverably; nothing ingests.
    endpoint.replayClientFrame(startRun(REF_A));
    await settle(host);
    expect(coordinator.readiness()).toBe("LOGIN_REQUIRED");
    expect(readinessProbes().at(-1)?.meta).toMatchObject({ reason: "SESSION_FAILURE", readiness: "LOGIN_REQUIRED" });
    expect(fixture.calls.some((c) => c.startsWith("ingest:"))).toBe(false);

    // The seller logs in (their own action) and retries with a fresh ticket. The retry's probe re-checks.
    script.surface = true;
    endpoint.replayClientFrame(startRun(REF_B));
    await settle(host);
    expect(coordinator.readiness()).toBe("READY");
    expect(readinessProbes().at(-1)?.meta).toMatchObject({ reason: "MANUAL_RECHECK", readiness: "READY" });
    // The work resumed automatically once the session was usable again — the second run completed to ingest.
    expect(fixture.calls.some((c) => c.startsWith("ingest:"))).toBe(true);
  });

  it("is EQUIVALENT: the coordinator-wired run drives the driver identically to a bare run", async () => {
    const script = (): ImportFixtureScript => ({ facts: { requiresApply: true, requiresFilters: false } });

    const base = buildBaseline(script());
    base.endpoint.replayClientFrame(startRun(REF_A));
    await settle(base.host);

    const wired = buildWired({ script: script() });
    wired.endpoint.replayClientFrame(startRun(REF_A));
    await settle(wired.host);

    // Same choreography, same order, same targets — the readiness decorator and the admission gate added
    // nothing the run can see. (The fixture's `calls` excludes panel renders by design, so this is the full
    // marketplace-facing sequence.)
    expect(wired.fixture.calls).toEqual(base.fixture.calls);
  });
});

/**
 * The in-run recovery, observed by the supervisor. A session block no longer ends the run at terminal FAILED
 * with a stuck ticket — it parks at SESSION_BLOCKED, and REQUEST_STEP_RECHECK re-probes the SAME segment and
 * ticket. Driven at the engine+session level (recovery is a session concern; the host only assembles), with
 * the real coordinator + decorator wired so the readiness sequence is proven end to end.
 */
const REC_WINDOW = { start: "2026-06-01", end: "2026-06-30" };

function loopback() {
  let listener: ((f: AwClientFrame) => void) | null = null;
  const sent: AwServerFrame[] = [];
  const transport = {
    subscribe: (l: (f: AwClientFrame) => void) => {
      listener = l;
      return () => {
        listener = null;
      };
    },
    send: (f: AwServerFrame) => void sent.push(f),
  };
  return {
    transport,
    send: (f: AwClientFrame) => listener?.(f),
    lastView: (): ActionWindowRunView | undefined => {
      const views = sent.filter((f) => f.kind === "aw_view") as Array<{ view: ActionWindowRunView }>;
      return views[views.length - 1]?.view;
    },
  };
}

function clientFrame(runId: string, expectedRevision: number, type: string, extra: Record<string, unknown> = {}): AwClientFrame {
  return {
    kind: "aw_command",
    command: { protocolVersion: 2, commandId: `c-${type}-${expectedRevision}`, runId, expectedRevision, type, ...extra },
  } as AwClientFrame;
}

describe("offline E2E: supervisor observes the in-run recoverable-session recovery", () => {
  it("SESSION_FAILURE parks recoverably; the seller's re-check re-observes READY (MANUAL_RECHECK) on the SAME ticket", async () => {
    const coordinator = new ImportAcquisitionCoordinator("naver");
    const script: ImportFixtureScript = { surface: { ok: false, blockerCode: "LOGIN_REQUIRED" } };
    const fixture = new ImportFixtureDriver(script);
    const driver = new ReadinessObservingImportDriver(fixture, (res) => coordinator.observeSurfaceReading(res));
    const io = loopback();
    const engine = new ImportSegmentEngine(
      { runId: "run_rec01", channelCode: "naver", importRef: REF_A, required: REC_WINDOW },
      { clock: makeImportClock() },
    );
    const session = new ImportSegmentSession(engine, driver, io.transport, REC_WINDOW);
    session.attach();

    // Start: the session probe finds a not-usable (not-logged-in) session → recoverable park, not FAILED.
    io.send(clientFrame("run_rec01", 0, "START_RUN", { payload: { channelCode: "naver", intent: "INITIAL_REVIEW_IMPORT_SEGMENT", importRef: REF_A } }));
    await session.whenSettled();
    expect(engine.currentStage()).toBe("SESSION_BLOCKED");
    expect(io.lastView()?.status).toBe("WAITING_FOR_HUMAN");
    expect(io.lastView()?.allowedCommands).toContain("REQUEST_STEP_RECHECK");
    expect(coordinator.readiness()).toBe("LOGIN_REQUIRED");
    expect(readinessProbes().at(-1)?.meta).toMatchObject({ reason: "SESSION_FAILURE", readiness: "LOGIN_REQUIRED" });

    // The seller logs in on their own screen, then presses re-check. No ticket expire, no re-mint.
    script.surface = true;
    io.send(clientFrame("run_rec01", io.lastView()!.revision, "REQUEST_STEP_RECHECK"));
    await session.whenSettled();

    // The re-check re-ran PREPARE, the coordinator recorded the recovery as MANUAL_RECHECK, and the run drove
    // to completion — one ingest, one authorization.
    expect(engine.currentStage()).toBe("COMPLETED");
    expect(coordinator.readiness()).toBe("READY");
    expect(readinessProbes().at(-1)?.meta).toMatchObject({ reason: "MANUAL_RECHECK", readiness: "READY" });
    expect(fixture.calls.filter((c) => c.startsWith("ingest:"))).toHaveLength(1);
    expect(fixture.calls.filter((c) => c === "prepareSurface")).toHaveLength(2);
  });
});
