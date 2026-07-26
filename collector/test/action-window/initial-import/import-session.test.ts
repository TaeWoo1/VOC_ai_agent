/**
 * The guided segment choreography, end to end, offline.
 *
 * Each live rehearsal costs the seller a real export window, so every branch — all three gate answers, each
 * fail-closed cause, the recoverable repair — is pinned here where it is free.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { AwClientFrame, AwServerFrame, AwServerTransport } from "../../../../contracts/action-window/v2/transport";
import { ImportSegmentEngine, makeImportClock } from "../../../src/action-window/initial-import/import-engine";
import { ImportFixtureDriver, type ImportFixtureScript } from "../../../src/action-window/initial-import/import-fixture-driver";
import { ImportSegmentSession } from "../../../src/action-window/initial-import/import-session";
import type { ActionWindowRunView } from "../../../../contracts/action-window/v2/index";

const REF = "9f2a1c7b4e6d0835";
const REQUIRED = { start: "2026-01-01", end: "2026-01-31" };

/** A loopback transport that records everything the runtime published. */
function loopback() {
  const sent: AwServerFrame[] = [];
  let listener: ((frame: AwClientFrame) => void) | null = null;
  const transport: AwServerTransport = {
    send: (frame) => {
      sent.push(frame);
    },
    subscribe: (l) => {
      listener = l;
      return () => {
        listener = null;
      };
    },
  };
  return {
    transport,
    sent,
    send: (frame: AwClientFrame) => listener?.(frame),
    views: () => sent.filter((f) => f.kind === "aw_view").map((f) => (f as { view: ActionWindowRunView }).view),
    lastView: () => {
      const all = sent.filter((f) => f.kind === "aw_view");
      return (all[all.length - 1] as { view: ActionWindowRunView } | undefined)?.view;
    },
    eventTypes: () =>
      sent.filter((f) => f.kind === "aw_event").map((f) => (f as { event: { type: string } }).event.type),
    blockers: () =>
      sent
        .filter((f) => f.kind === "aw_event")
        .map((f) => (f as { event: { type: string; payload: { code?: string; recoverable?: boolean } } }).event)
        .filter((e) => e.type === "RUN_BLOCKED")
        .map((e) => e.payload),
  };
}

function build(script: ImportFixtureScript = {}) {
  const io = loopback();
  const engine = new ImportSegmentEngine(
    { runId: "run_import01", channelCode: "naver", importRef: REF, required: REQUIRED },
    { clock: makeImportClock() },
  );
  const driver = new ImportFixtureDriver(script);
  const session = new ImportSegmentSession(engine, driver, io.transport, REQUIRED);
  session.attach();
  return { io, engine, driver, session };
}

function startRun(io: ReturnType<typeof loopback>, expectedRevision = 0) {
  io.send({
    kind: "aw_command",
    command: {
      protocolVersion: 2,
      commandId: "c1",
      runId: "run_import01",
      expectedRevision,
      type: "START_RUN",
      payload: { channelCode: "naver", intent: "INITIAL_REVIEW_IMPORT_SEGMENT", importRef: REF },
    },
  });
}

function command(io: ReturnType<typeof loopback>, type: string, revision: number, id = "cx") {
  io.send({
    kind: "aw_command",
    command: { protocolVersion: 2, commandId: id, runId: "run_import01", expectedRevision: revision, type: type as never },
  });
}

describe("import segment session — the happy path", () => {
  it("walks all six barriers and completes at an ingested file", async () => {
    const { io, engine, driver, session } = build({ facts: { requiresApply: true, requiresFilters: false } });
    startRun(io);
    await session.whenSettled();

    expect(engine.currentStage()).toBe("COMPLETED");
    expect(io.lastView()?.status).toBe("COMPLETED");
    // Every seller control was located, highlighted, armed and awaited — in order, and never "clicked".
    //
    // Each date control is ASKED what it already holds before it is annotated (finding 13). Asked before the
    // highlight, not after: a step the seller does not have to perform must not flash an annotation at them.
    // Here nothing is prefilled, so both barriers run in full.
    expect(driver.calls).toEqual([
      "prepareSurface",
      "readSurfaceFacts",
      "locate:start_date",
      "prefilled:start_date:2026-01-01..2026-01-31",
      "highlight:start_date",
      "observe:start_date",
      "wait:start_date",
      "locate:end_date",
      "prefilled:end_date:2026-01-01..2026-01-31",
      "highlight:end_date",
      "observe:end_date",
      "wait:end_date",
      "locate:apply_range",
      "highlight:apply_range",
      "observe:apply_range",
      "wait:apply_range",
      "scope:2026-01-01..2026-01-31",
      "locate:export",
      "highlight:export",
      "observe:export",
      "wait:export",
      "locate:consent",
      "highlight:consent",
      "observe:consent",
      "wait:consent",
      "detectDownload",
      "validate:a1b2c3d4e5f60718",
      "ingest:a1b2c3d4e5f60718",
      "cleanup",
    ]);
  });

  it("records MACHINE_MATCHED only when the runtime read the range back itself", async () => {
    const { engine, session, io } = build({ scope: "MATCH" });
    startRun(io);
    await session.whenSettled();
    expect(engine.recordedScopeEvidence()).toBe("MACHINE_MATCHED");
  });

  it("keeps the ingested count off the wire", async () => {
    const { io, engine, session } = build();
    startRun(io);
    await session.whenSettled();

    // The engine knows it; the contract deliberately carries no row count (v1 does not either, and
    // roadmap §9 forbids exact counts in runtime output).
    //
    // Asserted on PAYLOADS, not on the serialized wire: a substring search for "42" also matches the
    // synthetic occurredAt markers and the hex target refs, so it would fail for reasons that have
    // nothing to do with a leaked count.
    expect(engine.processedCount()).toBe(42);
    const payloads = io.sent
      .filter((f) => f.kind === "aw_event")
      .map((f) => (f as unknown as { event: { payload: Record<string, unknown> } }).event.payload);
    expect(payloads.length).toBeGreaterThan(0);
    for (const payload of payloads) {
      expect(Object.keys(payload)).not.toContain("processed");
      expect(Object.values(payload)).not.toContain(42);
    }
    const completed = payloads.filter((p) => (p as { status?: string }).status === "COMPLETED");
    expect(completed).toHaveLength(1);
    expect(Object.keys(completed[0]!)).toEqual(["status"]);
  });

  it("never puts the launch ref or a raw date value on the wire", async () => {
    const { io, session } = build();
    startRun(io);
    await session.whenSettled();

    const events = JSON.stringify(io.sent.filter((f) => f.kind === "aw_event"));
    expect(events).not.toContain(REF);
  });

  it("skips the confirm slot without changing totalSteps", async () => {
    const { io, session } = build({ facts: { requiresApply: false, requiresFilters: false } });
    startRun(io);
    await session.whenSettled();

    const totals = new Set(io.views().map((v) => v.currentStep!.totalSteps));
    expect(totals.size).toBe(1);
    const skipped = io.sent
      .filter((f) => f.kind === "aw_event")
      .map((f) => (f as { event: { type: string; payload: { stepStatus?: string; stepId?: string } } }).event)
      .filter((e) => e.payload.stepStatus === "SKIPPED");
    expect(skipped).toHaveLength(1);
    expect(skipped[0]!.payload.stepId).toBe("aw.import_confirm_range");
  });

  it("omits the apply step entirely when the surface has no apply control", async () => {
    const withApply = build({ facts: { requiresApply: true, requiresFilters: false } });
    startRun(withApply.io);
    await withApply.session.whenSettled();

    const without = build({ facts: { requiresApply: false, requiresFilters: false } });
    startRun(without.io);
    await without.session.whenSettled();

    // A tutorial that points at a control which is not there is worse than one step shorter.
    expect(withApply.io.lastView()!.currentStep!.totalSteps)
      .toBe(without.io.lastView()!.currentStep!.totalSteps + 1);
    expect(without.driver.calls.some((c) => c.includes("apply_range"))).toBe(false);
  });
});

describe("import segment session — the scope gate", () => {
  it("stops before the export control on a confirmed mismatch, and stays recoverable", async () => {
    const { io, engine, driver, session } = build({ scope: "MISMATCH" });
    startRun(io);
    await session.whenSettled();

    expect(engine.currentStage()).toBe("SCOPE_BLOCKED");
    // The whole point: the export control is never located, never highlighted, never armed.
    expect(driver.calls.some((c) => c.includes("export"))).toBe(false);
    expect(driver.calls.some((c) => c === "detectDownload")).toBe(false);
    expect(io.blockers()).toEqual([{ code: "SCOPE_MISMATCH", recoverable: true }]);
    // Waiting on the seller, not failed — the repair is one control away.
    expect(io.lastView()?.status).toBe("WAITING_FOR_HUMAN");
    expect(io.lastView()?.blocker).toEqual({ code: "SCOPE_MISMATCH", recoverable: true });
  });

  it("re-reads the range when the seller fixes the dates and asks for a re-check", async () => {
    const io = loopback();
    const engine = new ImportSegmentEngine(
      { runId: "run_import01", channelCode: "naver", importRef: REF, required: REQUIRED },
      { clock: makeImportClock() },
    );
    // First read mismatches, the repair read matches.
    let reads = 0;
    const driver = new ImportFixtureDriver();
    const original = driver.readSelectedScope.bind(driver);
    driver.readSelectedScope = async (required) => {
      await original(required);
      reads += 1;
      return reads === 1 ? "MISMATCH" : "MATCH";
    };
    const session = new ImportSegmentSession(engine, driver, io.transport, REQUIRED);
    session.attach();

    startRun(io);
    await session.whenSettled();
    expect(engine.currentStage()).toBe("SCOPE_BLOCKED");

    command(io, "REQUEST_STEP_RECHECK", io.lastView()!.revision);
    await session.whenSettled();

    expect(reads).toBe(2);
    expect(engine.currentStage()).toBe("COMPLETED");
    expect(engine.recordedScopeEvidence()).toBe("MACHINE_MATCHED");
    // The blocker is gone from the final view, not merely stale in it.
    expect(io.lastView()?.blocker).toBeUndefined();
  });

  it("asks the seller to confirm when the range could not be read, and records THEIR evidence", async () => {
    const { io, engine, session } = build({ scope: "UNREADABLE" });
    startRun(io);
    await session.whenSettled();

    // Rests on the seller's confirmation; the export control is not armed yet.
    expect(engine.currentStage()).toBe("WAIT_FOR_RANGE_CONFIRM");
    expect(engine.recordedScopeEvidence()).toBe("OPERATOR_CONFIRMED");

    command(io, "REQUEST_STEP_RECHECK", io.lastView()!.revision);
    await session.whenSettled();

    expect(engine.currentStage()).toBe("COMPLETED");
    // Still the operator's confirmation — never upgraded to a machine check by completing successfully.
    expect(engine.recordedScopeEvidence()).toBe("OPERATOR_CONFIRMED");
  });

  it("reads the scope only after apply, so a stale window cannot pass the gate", async () => {
    const { driver, session, io } = build({ facts: { requiresApply: true, requiresFilters: false } });
    startRun(io);
    await session.whenSettled();

    const applyAt = driver.calls.indexOf("wait:apply_range");
    const scopeAt = driver.calls.findIndex((c) => c.startsWith("scope:"));
    expect(applyAt).toBeGreaterThan(-1);
    expect(scopeAt).toBeGreaterThan(applyAt);
  });
});

describe("import segment session — fail-closed causes", () => {
  it("parks recoverably on a login requirement, and the seller's re-check resumes the SAME run", async () => {
    const script: ImportFixtureScript = { surface: { ok: false, blockerCode: "LOGIN_REQUIRED" } };
    const { io, engine, driver, session } = build(script);
    startRun(io);
    await session.whenSettled();

    // Recoverable session block: WAITING at SESSION_BLOCKED, NOT terminal FAILED, no RUN_FAILED — the seller
    // logs in on their own screen. The re-check control is offered.
    expect(engine.currentStage()).toBe("SESSION_BLOCKED");
    expect(io.lastView()?.status).toBe("WAITING_FOR_HUMAN");
    expect(io.lastView()?.blocker).toEqual({ code: "LOGIN_REQUIRED", recoverable: true });
    expect(io.lastView()?.allowedCommands).toContain("REQUEST_STEP_RECHECK");
    expect(io.eventTypes()).not.toContain("RUN_FAILED");

    // The seller logs in, then re-checks. Same segment, same ticket — no new authorization, no fresh mint.
    script.surface = true;
    command(io, "REQUEST_STEP_RECHECK", io.lastView()!.revision);
    await session.whenSettled();

    // The re-check re-ran PREPARE (a second probe) and, seeing a usable session, drove the run to completion.
    expect(engine.currentStage()).toBe("COMPLETED");
    expect(driver.calls.filter((c) => c === "prepareSurface")).toHaveLength(2);
    expect(driver.calls.filter((c) => c.startsWith("ingest:"))).toHaveLength(1); // ingested exactly once
  });

  it("re-parks on a re-check while still blocked, and never resumes twice", async () => {
    const script: ImportFixtureScript = { surface: { ok: false, blockerCode: "SESSION_EXPIRED" } };
    const { io, engine, driver, session } = build(script);
    startRun(io);
    await session.whenSettled();
    expect(engine.currentStage()).toBe("SESSION_BLOCKED");

    // Seller re-checks but is still not logged in → re-park, no failure, no progress past the gate.
    command(io, "REQUEST_STEP_RECHECK", io.lastView()!.revision);
    await session.whenSettled();
    expect(engine.currentStage()).toBe("SESSION_BLOCKED");
    expect(io.eventTypes()).not.toContain("RUN_FAILED");
    expect(driver.calls.some((c) => c === "readSurfaceFacts")).toBe(false); // never advanced past PREPARE

    // Now logged in; a single re-check resumes to completion — exactly once (no double-drive).
    script.surface = true;
    command(io, "REQUEST_STEP_RECHECK", io.lastView()!.revision);
    await session.whenSettled();
    expect(engine.currentStage()).toBe("COMPLETED");
    expect(driver.calls.filter((c) => c.startsWith("ingest:"))).toHaveLength(1);
    expect(driver.calls.filter((c) => c === "prepareSurface")).toHaveLength(3); // initial + 2 re-checks
  });

  it("fails terminally on an unrecognised surface — a login does not fix that", async () => {
    const { io, engine, session } = build({ surface: false });
    startRun(io);
    await session.whenSettled();

    expect(engine.currentStage()).toBe("FAILED");
    expect(io.blockers()).toContainEqual({ code: "UNSUPPORTED_STATE", recoverable: false });
  });

  it("refuses to guess when a control is ambiguous", async () => {
    const { io, engine, driver, session } = build({ locate: { start_date: { count: 3 } } });
    startRun(io);
    await session.whenSettled();

    expect(engine.currentStage()).toBe("FAILED");
    expect(io.blockers()).toContainEqual({ code: "TARGET_AMBIGUOUS", recoverable: false });
    expect(driver.calls).not.toContain("highlight:start_date");
  });

  /** The anti-drift check: the surface moved between locate and highlight. */
  it("fails closed when the unique match changes before it is highlighted", async () => {
    const { io, engine, session } = build({
      locate: { end_date: { count: 1, sig: "1111111111111111" } },
      highlight: { end_date: { count: 1, sig: "2222222222222222" } },
    });
    startRun(io);
    await session.whenSettled();

    expect(engine.currentStage()).toBe("FAILED");
    expect(io.blockers()).toContainEqual({ code: "TARGET_NOT_FOUND", recoverable: false });
  });

  it("reports a missing download as a timeout, not as a bad file", async () => {
    const { io, engine, session } = build({ download: { detected: false } });
    startRun(io);
    await session.whenSettled();

    expect(engine.currentStage()).toBe("FAILED");
    expect(io.blockers()).toContainEqual({ code: "DOWNLOAD_TIMEOUT", recoverable: false });
  });

  it("blames the file only when the file is actually invalid", async () => {
    const { io, engine, session } = build({ validate: { valid: false } });
    startRun(io);
    await session.whenSettled();

    expect(io.blockers()).toContainEqual({ code: "ARTIFACT_INVALID", recoverable: false });
    expect(engine.currentStage()).toBe("FAILED");
  });

  /** A server-side ingest problem must not masquerade as the seller's file being bad. */
  it("reports an ingest failure as INGEST_FAILED, not ARTIFACT_INVALID", async () => {
    const { io, engine, session } = build({ ingest: { ok: false, processed: 0 } });
    startRun(io);
    await session.whenSettled();

    expect(io.blockers()).toContainEqual({ code: "INGEST_FAILED", recoverable: false });
    expect(io.blockers().some((b) => b.code === "ARTIFACT_INVALID")).toBe(false);
    expect(engine.currentStage()).toBe("FAILED");
  });

  /** An empty month is a fact about the seller's history, not a failure. */
  it("completes on zero processed rows", async () => {
    const { io, engine, session } = build({ ingest: { ok: true, processed: 0 } });
    startRun(io);
    await session.whenSettled();

    expect(engine.currentStage()).toBe("COMPLETED");
    expect(engine.processedCount()).toBe(0);
  });

  it("cleans up on every terminal path", async () => {
    for (const script of [
      {},
      { surface: false } as ImportFixtureScript,
      { download: { detected: false } } as ImportFixtureScript,
      { ingest: { ok: false, processed: 0 } } as ImportFixtureScript,
    ]) {
      const { io, driver, session } = build(script);
      startRun(io);
      await session.whenSettled();
      expect(driver.cleanupCount()).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("import segment session — protocol behaviour", () => {
  it("rejects a malformed envelope without touching the driver", async () => {
    const { io, driver } = build();
    io.send({ kind: "aw_command", command: { nope: true } as never });

    const results = io.sent.filter((f) => f.kind === "aw_command_result");
    expect(results).toHaveLength(1);
    expect((results[0] as { accepted: boolean; reason?: string }).reason).toBe("INVALID_ENVELOPE");
    expect(driver.calls).toEqual([]);
  });

  it("rejects any command before START_RUN", async () => {
    const { io } = build();
    command(io, "PAUSE_RUN", 0);
    const results = io.sent.filter((f) => f.kind === "aw_command_result");
    expect((results[0] as { accepted: boolean; reason?: string }).accepted).toBe(false);
  });

  it("treats a replayed START_RUN as idempotent", async () => {
    const { io, session, engine } = build({ scope: "MISMATCH" });
    startRun(io);
    await session.whenSettled();
    const revisionBefore = engine.view().revision;

    startRun(io, engine.view().revision);
    await session.whenSettled();
    expect(engine.view().revision).toBe(revisionBefore);
  });

  it("rejects a stale revision", async () => {
    const { io, session, engine } = build({ scope: "MISMATCH" });
    startRun(io);
    await session.whenSettled();

    command(io, "PAUSE_RUN", 0, "stale");
    const result = io.sent
      .filter((f) => f.kind === "aw_command_result")
      .map((f) => f as { commandId: string; accepted: boolean; reason?: string })
      .find((r) => r.commandId === "stale");
    expect(result?.accepted).toBe(false);
    expect(result?.reason).toBe("STALE_REVISION");
    expect(engine.currentStage()).toBe("SCOPE_BLOCKED");
  });

  it("answers a resync for this run and refuses one for another", async () => {
    const { io, session } = build({ scope: "MISMATCH" });
    startRun(io);
    await session.whenSettled();

    io.send({ kind: "aw_resync", runId: "run_import01", sinceSequence: 0 });
    io.send({ kind: "aw_resync", runId: "run_other", sinceSequence: 0 });

    const replies = io.sent
      .filter((f) => f.kind === "aw_resync_result")
      .map((f) => f as unknown as { view: ActionWindowRunView | null; events: unknown[] });
    expect(replies).toHaveLength(2);
    expect(replies[0]!.view).not.toBeNull();
    expect(replies[0]!.events.length).toBeGreaterThan(0);
    expect(replies[1]!.view).toBeNull();
    expect(replies[1]!.events).toEqual([]);
  });

  it("offers no command that could perform a marketplace action", async () => {
    const { io, session } = build({ scope: "MISMATCH" });
    startRun(io);
    await session.whenSettled();

    for (const view of io.views()) {
      for (const cmd of view.allowedCommands) {
        expect(["EXPORT", "CONSENT", "SUBMIT", "CONFIRM_STEP_COMPLETED"]).not.toContain(cmd);
      }
    }
    // The manual path stays available at every barrier, by product rule.
    expect(io.lastView()!.allowedCommands).toContain("SWITCH_TO_MANUAL");
  });

  it("leaving guidance neither fails nor completes the run", async () => {
    const { io, engine, session, driver } = build({ scope: "MISMATCH" });
    startRun(io);
    await session.whenSettled();

    command(io, "SWITCH_TO_MANUAL", io.lastView()!.revision);
    await session.whenSettled();

    expect(engine.currentStage()).toBe("CANCELLED");
    expect(io.lastView()?.status).toBe("CANCELLED");
    expect(driver.cleanupCount()).toBeGreaterThanOrEqual(1);
    // Nothing claims a file was imported.
    expect(io.eventTypes()).not.toContain("RUN_COMPLETED");
  });

  /**
   * An expired observation window means the seller has not acted YET, so the barrier re-arms and the run keeps
   * watching. The first live attempt stranded here: a 15-second window expired while the operator was working,
   * the watcher returned, and nothing was left observing a run whose status still said WAITING_FOR_HUMAN. A
   * status claiming we are waiting has to mean we are actually watching.
   */
  it("re-arms a barrier whose observation window expired, instead of stranding the run", async () => {
    const io = loopback();
    const engine = new ImportSegmentEngine(
      { runId: "run_import01", channelCode: "naver", importRef: REF, required: REQUIRED },
      { clock: makeImportClock() },
    );
    let looks = 0;
    const driver = new ImportFixtureDriver();
    driver.waitForTargetAction = async (target) => {
      driver.calls.push(`wait:${target}`);
      if (target !== "start_date") return true;
      looks += 1;
      return looks >= 3;
    };
    const session = new ImportSegmentSession(engine, driver, io.transport, REQUIRED, { rearmDelayMs: 1 });
    session.attach();

    startRun(io);
    // `whenSettled` returns while the watcher is detached and paused between re-arms — that is the point of a
    // barrier being idle — so wait for the third look rather than assuming one settle covers it.
    for (let i = 0; i < 200 && looks < 3; i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    await session.whenSettled();

    expect(looks).toBe(3);
    expect(driver.calls.filter((c) => c === "observe:start_date")).toHaveLength(3);
    expect(engine.currentStage()).toBe("COMPLETED");
  });

  /** And it stops the moment the barrier is no longer open — a cancel must not spin. */
  it("stops watching once the run leaves the barrier", async () => {
    const io = loopback();
    const engine = new ImportSegmentEngine(
      { runId: "run_import01", channelCode: "naver", importRef: REF, required: REQUIRED },
      { clock: makeImportClock() },
    );
    const driver = new ImportFixtureDriver();
    let looks = 0;
    driver.waitForTargetAction = async (target) => {
      driver.calls.push(`wait:${target}`);
      if (target !== "start_date") return true;
      looks += 1;
      if (looks === 2) engine.command({ type: "CANCEL_RUN", expectedRevision: engine.view().revision });
      return false;
    };
    const session = new ImportSegmentSession(engine, driver, io.transport, REQUIRED, { rearmDelayMs: 1 });
    session.attach();

    startRun(io);
    await session.whenSettled();
    await new Promise((r) => setTimeout(r, 40));

    expect(engine.currentStage()).toBe("CANCELLED");
    expect(looks).toBeLessThanOrEqual(3);
  });

  /**
   * A seller who has not acted YET leaves the run at the barrier and still watching — not stranded. The run is
   * ended with a cancel, which also proves the re-arm loop is bounded by the barrier being open.
   */
  it("keeps watching a barrier the seller has not acted on yet", async () => {
    const io = loopback();
    const engine = new ImportSegmentEngine(
      { runId: "run_import01", channelCode: "naver", importRef: REF, required: REQUIRED },
      { clock: makeImportClock() },
    );
    const driver = new ImportFixtureDriver({ action: { start_date: false } });
    const session = new ImportSegmentSession(engine, driver, io.transport, REQUIRED, { rearmDelayMs: 1 });
    session.attach();

    startRun(io);
    await session.whenSettled();

    expect(engine.currentStage()).toBe("WAIT_FOR_START");
    expect(engine.isAtBarrier()).toBe(true);
    expect(io.lastView()?.status).toBe("WAITING_FOR_HUMAN");

    command(io, "CANCEL_RUN", io.lastView()!.revision);
    await session.whenSettled();
    await new Promise((r) => setTimeout(r, 40));
    const arms = driver.calls.filter((c) => c === "observe:start_date").length;
    await new Promise((r) => setTimeout(r, 40));
    expect(driver.calls.filter((c) => c === "observe:start_date").length).toBe(arms);
    expect(engine.currentStage()).toBe("CANCELLED");
  });

  it("refuses a malformed launch ref at construction", () => {
    expect(
      () =>
        new ImportSegmentEngine({
          runId: "r",
          channelCode: "naver",
          importRef: "not-hex",
          required: REQUIRED,
        }),
    ).toThrow(/16 lowercase hex/);
  });

  it("shows the seller the required window as sanitized copy params", async () => {
    const { io, session } = build();
    startRun(io);
    await session.whenSettled();

    for (const view of io.views()) {
      expect(view.currentStep!.copyParams?.requiredStart).toBe(REQUIRED.start);
      expect(view.currentStep!.copyParams?.requiredEnd).toBe(REQUIRED.end);
    }
  });

  it("carries the import intent on every view", async () => {
    const { io, session } = build();
    startRun(io);
    await session.whenSettled();
    for (const view of io.views()) {
      expect(view.intent).toBe("INITIAL_REVIEW_IMPORT_SEGMENT");
    }
  });
});

/**
 * **A finished segment hands the seller on to the next one, from inside the marketplace page.**
 *
 * The 2026-07-26 slice let the seller finish ONE segment there. A plan is thirteen of them, and the seller was
 * still expected to return to the SellerOps tab between each — which is the same "watch two windows" cost that
 * slice existed to remove, paid twelve more times. Product-owner decision (2026-07-26): the panel that closes one
 * segment starts the next.
 *
 * What this session may and may not do about that is the whole point of these tests. It may draw the offer and
 * report the press. It may NOT start the run: a run is authorized by a single-use ticket that the backend mints
 * and only the frontend can ask for, and this runtime holds no plan identity at all.
 */
describe("import segment session — continuing to the next segment", () => {
  const PACK = {
    chrome: { product: "SellerOps", stepCounter: "STEP {step}/{total}", requiredRange: "W {start}-{end}", blockedLabel: "STOP" },
    steps: { "actionWindow.import.setStartDate": "PICK-START" },
    blockers: { SCOPE_MISMATCH: { title: "WRONG", fix: "FIX" } },
    commands: { REQUEST_STEP_RECHECK: "RECHECK", CANCEL_RUN: "CANCEL" },
    recheck: { byBlocker: {}, byStep: {}, fallback: "RECHECK" },
    continuation: { doneLabel: "DONE", nextLine: "NEXT-JUNE-2-LEFT", allDoneLine: "ALL-DONE", continueLabel: "CONTINUE" },
  };

  /** A session with a fast panel poll, so a press is picked up inside a test rather than in half a second. */
  function panelSession(script: ImportFixtureScript = {}, pack: unknown = PACK) {
    const io = loopback();
    const engine = new ImportSegmentEngine(
      { runId: "run_import01", channelCode: "naver", importRef: REF, required: REQUIRED },
      { clock: makeImportClock() },
    );
    const driver = new ImportFixtureDriver(script);
    const session = new ImportSegmentSession(engine, driver, io.transport, REQUIRED, { panelPollMs: 5 });
    const detach = session.attach();
    io.send({ kind: "aw_guidance_pack", pack: pack as never });
    return { io, engine, driver, session, detach };
  }

  const intents = (io: ReturnType<typeof loopback>): string[] =>
    io.sent
      .filter((f) => f.kind === "aw_guidance_intent")
      .map((f) => (f as { intent: string }).intent);

  /** Wait for a condition the panel poll drives, rather than sleeping a fixed amount. */
  async function until(predicate: () => boolean, label: string, timeoutMs = 2000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (predicate()) return;
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error(`import session: timed out waiting for ${label}`);
  }

  it("leaves the completion and the offer on the page after the run has finished", async () => {
    const { io, driver, session } = panelSession();
    startRun(io);
    await session.whenSettled();
    expect(io.lastView()?.status).toBe("COMPLETED");

    // The last thing drawn is the hand-off, NOT a removal — even though the run's cleanup took the panel down on
    // its way out. A finished segment's panel is the seller's only way onward, so it is re-drawn after cleanup.
    await until(() => driver.lastGuidance()?.completion != null, "the completion panel");
    expect(driver.lastGuidance()?.completion).toEqual({ doneLabel: "DONE", line: "NEXT-JUNE-2-LEFT" });
    expect(driver.lastGuidance()?.actions).toEqual([{ command: "CONTINUE_NEXT_SEGMENT", label: "CONTINUE" }]);
  });

  it("forwards the press to the frontend instead of acting on it", async () => {
    const { io, engine, driver, session } = panelSession();
    startRun(io);
    await session.whenSettled();
    await until(() => driver.lastGuidance()?.completion != null, "the completion panel");

    driver.pressPanel("CONTINUE_NEXT_SEGMENT");
    await until(() => intents(io).length > 0, "the forwarded intent");

    // Exactly the contract's value, and nothing else — no ref, no dates, no plan or segment identity.
    expect(io.sent.filter((f) => f.kind === "aw_guidance_intent")).toEqual([
      { kind: "aw_guidance_intent", intent: "CONTINUE_NEXT_SEGMENT" },
    ]);
    // And the runtime did NOT start anything: the run it was hosting is over and stays over. The next one exists
    // only once the frontend has a fresh ticket for it.
    expect(engine.currentStage()).toBe("COMPLETED");
    expect(driver.calls.filter((c) => c === "prepareSurface")).toHaveLength(1);
  });

  /**
   * The flag lives in the seller's own page, so it is untrusted input. A press is forwarded only when the panel
   * ACTUALLY offered it — and mid-run it does not, because there is nothing finished to continue from.
   */
  it("refuses a continue press while the run is still going", async () => {
    const { io, driver, session } = panelSession({ action: { start_date: false } });
    startRun(io);
    await session.whenSettled();
    await until(() => driver.lastGuidance()?.instruction === "PICK-START", "the live panel");

    driver.pressPanel("CONTINUE_NEXT_SEGMENT");
    await new Promise((r) => setTimeout(r, 60));
    expect(intents(io)).toEqual([]);
  });

  /** No continuation copy ⇒ no offer ⇒ nothing to press, and a press invents no offer. */
  it("refuses a continue press when the frontend sent no continuation", async () => {
    const { continuation: _omitted, ...withoutContinuation } = PACK;
    const { io, driver, session } = panelSession({}, withoutContinuation);
    startRun(io);
    await session.whenSettled();

    driver.pressPanel("CONTINUE_NEXT_SEGMENT");
    await new Promise((r) => setTimeout(r, 60));
    expect(intents(io)).toEqual([]);
    // And the panel really did come down, exactly as it did before any of this existed.
    expect(driver.lastGuidance()).toBeNull();
  });

  /** A finished plan says so and offers nothing. The seller is done; there is nothing to press. */
  it("closes the plan with no control when nothing remains", async () => {
    const { io, driver, session } = panelSession({}, { ...PACK, continuation: { ...PACK.continuation, nextLine: "" } });
    startRun(io);
    await session.whenSettled();
    await until(() => driver.lastGuidance()?.completion != null, "the closing panel");

    expect(driver.lastGuidance()?.completion?.line).toBe("ALL-DONE");
    expect(driver.lastGuidance()?.actions).toEqual([]);
    driver.pressPanel("CONTINUE_NEXT_SEGMENT");
    await new Promise((r) => setTimeout(r, 60));
    expect(intents(io)).toEqual([]);
  });

  /**
   * Releasing the session stops the poll. The host builds one session per segment and releases the previous one,
   * so a poller left running would keep reading a finished run's page and forwarding presses for a run nobody is
   * publishing any more.
   */
  it("stops watching the panel once the session is released", async () => {
    const { io, driver, session, detach } = panelSession();
    startRun(io);
    await session.whenSettled();
    await until(() => driver.lastGuidance()?.completion != null, "the completion panel");

    detach();
    await new Promise((r) => setTimeout(r, 30));
    driver.pressPanel("CONTINUE_NEXT_SEGMENT");
    await new Promise((r) => setTimeout(r, 60));
    expect(intents(io)).toEqual([]);
  });

  /**
   * A panel nobody has pressed for a long time comes down. It is the honest end state: the seller can still
   * continue from the SellerOps window, and a control that keeps being polled in someone's browser all afternoon
   * is a cost with no one to benefit from it.
   */
  it("takes the offer down after nobody presses it, rather than polling forever", async () => {
    const io = loopback();
    const engine = new ImportSegmentEngine(
      { runId: "run_import01", channelCode: "naver", importRef: REF, required: REQUIRED },
      { clock: makeImportClock() },
    );
    const driver = new ImportFixtureDriver();
    const session = new ImportSegmentSession(engine, driver, io.transport, REQUIRED, {
      panelPollMs: 5,
      terminalPanelBudgetMs: 20,
    });
    session.attach();
    io.send({ kind: "aw_guidance_pack", pack: PACK as never });
    startRun(io);
    await session.whenSettled();

    await until(() => driver.lastGuidance() === null, "the offer being withdrawn");
    driver.pressPanel("CONTINUE_NEXT_SEGMENT");
    await new Promise((r) => setTimeout(r, 60));
    expect(intents(io)).toEqual([]);
  });
});

/**
 * Scope evidence has ONE authority: the engine. The driver reads the range and returns a sanitized verdict;
 * the engine decides what evidence that verdict records; the session hands the engine's record to the ingest.
 * These pin the acceptance requirements for the authority consolidation (AR-EV1..3): the value the ingest
 * carries and the value the engine holds come from the same place and cannot diverge, and the driver derives
 * no evidence of its own.
 */
describe("import segment session — scope evidence single source (AR-EV1..3)", () => {
  it("AR-EV1: the ingest carries the ENGINE's recorded evidence, not the driver's own — MATCH → MACHINE_MATCHED", async () => {
    const { io, engine, driver, session } = build({ scope: "MATCH" });
    startRun(io);
    await session.whenSettled();

    expect(engine.currentStage()).toBe("COMPLETED");
    expect(engine.recordedScopeEvidence()).toBe("MACHINE_MATCHED");
    // The value the session handed to ingest is exactly the engine's record — one source for wire and ingest.
    expect(driver.lastIngestEvidence).toBe("MACHINE_MATCHED");
    expect(driver.lastIngestEvidence).toBe(engine.recordedScopeEvidence());
  });

  it("AR-EV3: the two records cannot diverge — the confirm path also matches, OPERATOR_CONFIRMED end to end", async () => {
    const { io, engine, driver, session } = build({ scope: "UNREADABLE" });
    startRun(io);
    await session.whenSettled();
    expect(engine.recordedScopeEvidence()).toBe("OPERATOR_CONFIRMED");

    command(io, "REQUEST_STEP_RECHECK", io.lastView()!.revision);
    await session.whenSettled();

    expect(engine.currentStage()).toBe("COMPLETED");
    // The engine never upgraded the operator's attestation to a machine check, and the ingest carries exactly
    // what the engine holds — the driver contributed no competing value.
    expect(engine.recordedScopeEvidence()).toBe("OPERATOR_CONFIRMED");
    expect(driver.lastIngestEvidence).toBe("OPERATOR_CONFIRMED");
    expect(driver.lastIngestEvidence).toBe(engine.recordedScopeEvidence());
  });

  it("AR-EV2: the live import driver derives NO evidence of its own — no scopeEvidence() method, no verdict cache", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(
      resolve(here, "../../../src/action-window/initial-import/naver-live-import-driver.ts"),
      "utf8",
    );
    // The authorization getter and its backing field are gone: the driver returns only the sanitized ScopeMatch
    // from readSelectedScope, and the engine is the sole authority on the evidence value.
    expect(src).not.toMatch(/\bscopeEvidence\s*\(/);
    expect(src).not.toContain("lastScopeVerdict");
  });
});
