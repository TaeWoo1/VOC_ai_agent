/**
 * **Offline headless E2E — the NAVER repeated review-operations loop, proven for its RECOVERY properties.
 * No browser, no socket, no NAVER.**
 *
 * The per-piece suites pin each mechanism; this is the consolidated loop-recovery proof the PR needs — the
 * four ways a repeated import sitting can be interrupted or repeated, asserted together over the SAME runtime
 * the live boot assembles (`ImportSegmentHost` + `InitialImportEndpoint` + the real per-segment
 * `assembleImportRun`, driven by the scriptable `ImportFixtureDriver` standing in for the seller's clicks; the
 * one thing that cannot be real offline is the backend, so `resolveScope` is a stub, exactly as the
 * cross-stack and acquisition-runtime suites do it).
 *
 * What it proves end to end:
 *  1. RESTART mid-run: a non-terminal run's marker is ABANDONED by `recoverImportRuns` at reboot, no launch
 *     ref (or path/filename/date) was ever written, and the same segment is re-hosted on a FRESHLY minted
 *     server ticket — the agent never persists or re-issues a ref.
 *  2. SESSION EXPIRY mid-run: an unusable session PARKS at `SESSION_BLOCKED` (WAITING_FOR_HUMAN, not FAILED),
 *     and `REQUEST_STEP_RECHECK` re-runs PREPARE on the SAME segment and ticket, then proceeds to completion.
 *  3. DUPLICATE guard: a second `START_RUN` for the hosted ref is IGNORE_ALREADY_HOSTED; a concurrent
 *     different start while the host is mid-build is IGNORE_BUSY.
 *  4. REPEATED loop in one sitting: the host guides segment after segment (≥2) from ONE browser without a
 *     restart, re-arming a fresh run identity per `START_RUN`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { clearLogSink, getLogSink } from "../../../src/log";
import { InitialImportEndpoint } from "../../../src/bridge/initial-import-endpoint";
import { ImportSegmentHost, type ResolvedLaunchScope } from "../../../src/action-window/initial-import/import-host";
import {
  ImportFixtureDriver,
  type ImportFixtureScript,
} from "../../../src/action-window/initial-import/import-fixture-driver";
import {
  listImportRuns,
  readImportRun,
  recoverImportRuns,
} from "../../../src/action-window/initial-import/import-run-store";
import { makeImportRunMarker } from "../../../src/action-window/initial-import/import-dispatch";
import { IMPORT_TERMINAL_STAGES } from "../../../src/action-window/initial-import/import-stages";
import { ImportSegmentEngine, makeImportClock } from "../../../src/action-window/initial-import/import-engine";
import { ImportSegmentSession } from "../../../src/action-window/initial-import/import-session";
import { findProhibitedFields } from "../../../../contracts/action-window/v2/index";
import type { ActionWindowRunView } from "../../../../contracts/action-window/v2/index";
import type { AwClientFrame, AwServerFrame } from "../../../../contracts/action-window/v2/transport";

/** The first server ticket for a segment, and the FRESH ticket the server re-mints for the same segment. */
const REF_A = "9f2a1c7b4e6d0835";
const REF_B = "1122334455667788";

function scope(overrides: Partial<ResolvedLaunchScope> = {}): ResolvedLaunchScope {
  return {
    kind: "SEGMENT",
    channelCode: "naver",
    accountSlot: "aabbccddeeff00112233abcd",
    requiredStart: "2026-06-01",
    requiredEnd: "2026-06-30",
    ...overrides,
  };
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
function buildHost(opts: {
  script?: ImportFixtureScript;
  resolveScope?: (ref: string) => Promise<ResolvedLaunchScope | null>;
  persistDir?: string;
} = {}) {
  const driver = new ImportFixtureDriver(opts.script ?? {});
  const endpoint = new InitialImportEndpoint({ runId: "run_announce", channelCode: "naver" });
  const host = new ImportSegmentHost({
    endpoint,
    channelCode: "naver",
    resolveScope: opts.resolveScope ?? (async () => scope()),
    driver,
    ...(opts.persistDir ? { persistDir: opts.persistDir } : {}),
  });
  host.attach();
  return { driver, endpoint, host };
}

async function settle(host: ImportSegmentHost) {
  for (let i = 0; i < 60; i++) await new Promise((r) => setTimeout(r, 0));
  await host.activeSession()?.whenSettled();
}

beforeEach(() => clearLogSink());
afterEach(() => clearLogSink());

describe("offline E2E: NAVER review-ops loop recovery", () => {
  it("RESTART mid-run: recovery ABANDONS the interrupted run, persists no launch ref, and a fresh ticket re-mints the same segment", async () => {
    const dir = mkdtempSync(join(tmpdir(), "review-ops-loop-recovery-"));
    try {
      // Boot 1 — the seller's session is not usable, so the run parks NON-terminally before it can finish.
      // The host persists a sanitized marker for it, exactly as the live boot does under `.import-runs/`.
      const boot1 = buildHost({
        script: { surface: { ok: false, blockerCode: "LOGIN_REQUIRED" } },
        persistDir: dir,
      });
      boot1.endpoint.replayClientFrame(startRun(REF_A));
      await settle(boot1.host);

      const parked = listImportRuns(dir);
      expect(parked).toHaveLength(1);
      const parkedRunId = parked[0]!.runId;
      expect(parked[0]!.stage).toBe("SESSION_BLOCKED");
      expect(IMPORT_TERMINAL_STAGES.includes(parked[0]!.stage)).toBe(false);
      expect(parked[0]!.abandoned).toBe(false);

      // The agent process goes away mid-sitting (a restart). The host is torn down.
      await boot1.host.close();

      // Reboot — recovery marks the interrupted run ABANDONED and re-drives NOTHING (no ref was persisted to
      // resume from). This is what `agent-bridge` calls at boot before the host is attached.
      const recovered = recoverImportRuns(dir, makeImportRunMarker());
      expect(recovered.abandoned).toEqual([parkedRunId]);
      expect(readImportRun(dir, parkedRunId)?.abandoned).toBe(true);

      // No launch ref was EVER written — the constraint that rules resumption out — and neither was any
      // filename, path, or date. Assert both by raw text and by the store's own prohibited-content guard.
      for (const name of readdirSync(dir)) {
        const raw = readFileSync(join(dir, name), "utf8");
        expect(raw).not.toContain(REF_A);
        expect(raw).not.toContain(REF_B);
        expect(raw).not.toContain("2026-06-01");
        expect(raw).not.toContain(".xlsx");
        expect(findProhibitedFields(JSON.parse(raw))).toEqual([]);
      }

      // Boot 2 — the SAME segment (same required window) comes back on a FRESHLY minted server ticket
      // (REF_B, not REF_A). The agent never re-issues a ref; the server re-mints and the host hosts it to
      // completion on a brand-new run identity.
      const boot2 = buildHost({ resolveScope: async () => scope(), persistDir: dir });
      boot2.endpoint.replayClientFrame(startRun(REF_B));
      await settle(boot2.host);

      const freshRunId = boot2.endpoint.hostedRunId();
      expect(freshRunId).toMatch(/^run_[0-9a-f]{12}$/);
      expect(freshRunId).not.toBe(parkedRunId); // a fresh identity, not the abandoned one re-driven
      expect(boot2.driver.calls.some((c) => c.startsWith("ingest:"))).toBe(true);
      expect(readImportRun(dir, freshRunId)?.stage).toBe("COMPLETED");
      await boot2.host.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("SESSION EXPIRY mid-run: parks recoverably at SESSION_BLOCKED (not FAILED), and a re-check re-runs PREPARE on the SAME segment and ticket, then proceeds", async () => {
    // Driven at the engine+session level — recovery is a session concern; the host only assembles. The
    // fixture reports an unusable session first, then a usable one after the seller logs in on their own screen.
    const script: ImportFixtureScript = { surface: { ok: false, blockerCode: "SESSION_EXPIRED" } };
    const driver = new ImportFixtureDriver(script);
    const io = loopback();
    const required = { start: "2026-06-01", end: "2026-06-30" };
    const engine = new ImportSegmentEngine(
      { runId: "run_rec01", channelCode: "naver", importRef: REF_A, required },
      { clock: makeImportClock() },
    );
    const session = new ImportSegmentSession(engine, driver, io.transport, required);
    session.attach();

    // Start — the pre-work session probe finds the session unusable → recoverable PARK, not a terminal FAILED.
    io.send(startRunCmd("run_rec01"));
    await session.whenSettled();
    expect(engine.currentStage()).toBe("SESSION_BLOCKED");
    expect(io.lastView()?.status).toBe("WAITING_FOR_HUMAN");
    expect(io.lastView()?.status).not.toBe("FAILED");
    expect(io.lastView()?.allowedCommands).toContain("REQUEST_STEP_RECHECK");
    // The run is bound to one segment/ticket, and recovery does not change either.
    const boundRef = engine.boundImportRef();
    expect(boundRef).toBe(REF_A);
    expect(driver.calls.filter((c) => c === "prepareSurface")).toHaveLength(1);
    expect(driver.calls.some((c) => c.startsWith("ingest:"))).toBe(false);

    // The seller logs in on their own screen, then presses re-check. No ticket expiry, no re-mint — PREPARE
    // is re-run on the SAME segment and ticket, and the run drives to completion.
    script.surface = true;
    io.send(clientCmd("run_rec01", io.lastView()!.revision, "REQUEST_STEP_RECHECK"));
    await session.whenSettled();

    expect(engine.currentStage()).toBe("COMPLETED");
    expect(engine.boundImportRef()).toBe(boundRef); // still the same ticket the run began on
    expect(driver.calls.filter((c) => c === "prepareSurface")).toHaveLength(2); // re-probed, not re-ticketed
    expect(driver.calls.filter((c) => c.startsWith("ingest:"))).toHaveLength(1);
  });

  it("DUPLICATE guard: a second START_RUN for the hosted ref is IGNORE_ALREADY_HOSTED", async () => {
    const resolveSpy = vi.fn(async () => scope());
    const h = buildHost({ resolveScope: resolveSpy });

    h.endpoint.replayClientFrame(startRun(REF_A));
    await settle(h.host);
    const runId = h.endpoint.hostedRunId();
    expect(runId).toMatch(/^run_[0-9a-f]{12}$/);

    // The same authorization arriving again does NOT mint a second run — one ticket, one run.
    h.endpoint.replayClientFrame(startRun(REF_A));
    await settle(h.host);

    expect(resolveSpy).toHaveBeenCalledTimes(1);
    expect(h.endpoint.hostedRunId()).toBe(runId);
    await h.host.close();
  });

  it("DUPLICATE guard: a concurrent different START_RUN while the host is mid-build is IGNORE_BUSY", async () => {
    // Hold the scope resolve open so the host stays in its `building` window while a second start arrives.
    let release: (() => void) | null = null;
    const gate = new Promise<void>((r) => (release = r));
    const resolveSpy = vi.fn(async () => {
      await gate;
      return scope();
    });
    const h = buildHost({ resolveScope: resolveSpy });

    clearLogSink();
    h.endpoint.replayClientFrame(startRun(REF_A)); // begins resolving → building = true
    // A different ref lands before the first resolve settles → the concurrent-start race, dropped not queued.
    h.endpoint.replayClientFrame(startRun(REF_B));
    expect(getLogSink().some((e) => e.event === "aw_import_host_start_ignored_busy")).toBe(true);

    release!();
    await settle(h.host);

    // Only the first start was ever resolved and hosted; the busy one was refused, not enqueued behind it.
    expect(resolveSpy).toHaveBeenCalledTimes(1);
    expect(h.endpoint.hostedRunId()).toMatch(/^run_[0-9a-f]{12}$/);
    expect(h.driver.calls.filter((c) => c.startsWith("ingest:"))).toHaveLength(1);
    await h.host.close();
  });

  it("REPEATED loop in one sitting: the host guides segment after segment from ONE browser, re-arming per START_RUN", async () => {
    // One host, one driver (one browser), no restart between segments.
    const h = buildHost({ resolveScope: async () => scope() });

    h.endpoint.replayClientFrame(startRun(REF_A));
    await settle(h.host);
    const first = h.endpoint.hostedRunId();
    expect(first).toMatch(/^run_[0-9a-f]{12}$/);
    expect(h.driver.calls.filter((c) => c.startsWith("ingest:"))).toHaveLength(1);

    // The next monthly segment, on a fresh ticket — hosted without the seller restarting their agent.
    h.endpoint.replayClientFrame(startRun(REF_B));
    await settle(h.host);
    const second = h.endpoint.hostedRunId();

    expect(second).toMatch(/^run_[0-9a-f]{12}$/);
    expect(second).not.toBe(first); // a fresh run identity was re-armed per START_RUN
    // Two full segments, two ingests, from the same driver — the repeated loop ran twice end to end.
    expect(h.driver.calls.filter((c) => c.startsWith("ingest:"))).toHaveLength(2);
    await h.host.close();
  });
});

/* ── loopback transport for the engine+session level (test 2), mirroring the acquisition-runtime suite ── */

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

function startRunCmd(runId: string): AwClientFrame {
  return clientCmd(runId, 0, "START_RUN", {
    payload: { channelCode: "naver", intent: "INITIAL_REVIEW_IMPORT_SEGMENT", importRef: REF_A },
  });
}

function clientCmd(
  runId: string,
  expectedRevision: number,
  type: string,
  extra: Record<string, unknown> = {},
): AwClientFrame {
  return {
    kind: "aw_command",
    command: { protocolVersion: 2, commandId: `c-${type}-${expectedRevision}`, runId, expectedRevision, type, ...extra },
  } as AwClientFrame;
}
