/**
 * The guided segment choreography, end to end, offline.
 *
 * Each live rehearsal costs the seller a real export window, so every branch — all three gate answers, each
 * fail-closed cause, the recoverable repair — is pinned here where it is free.
 */
import { describe, expect, it } from "vitest";
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
    expect(driver.calls).toEqual([
      "prepareSurface",
      "readSurfaceFacts",
      "locate:start_date",
      "highlight:start_date",
      "observe:start_date",
      "wait:start_date",
      "locate:end_date",
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
  it("parks recoverably on a login requirement the seller can clear themselves", async () => {
    const { io, engine, session } = build({ surface: { ok: false, blockerCode: "LOGIN_REQUIRED" } });
    startRun(io);
    await session.whenSettled();

    expect(engine.currentStage()).toBe("FAILED");
    expect(io.blockers()).toContainEqual({ code: "LOGIN_REQUIRED", recoverable: true });
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
