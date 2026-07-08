/**
 * **Operation Run persistence & resume (R3 behavioral suite).** Runs the REAL engine + session +
 * synthetic driver over the loopback transport with the file store attached, then simulates process
 * restarts by rebuilding everything from disk. Proves: create/load, human-checkpoint restore,
 * restart recovery through the PAUSED barrier, duplicate-command idempotency and stale-revision
 * rejection ACROSS restarts, idempotent downstream resume, failed-run resume (and re-fail-closed),
 * terminal-state protection, gapless audit ordering across restarts, and the privacy boundary.
 * Offline and hermetic — no browser, no Bridge server, no backend; the "user action" is always the
 * test driver, never the Runtime.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  ACTION_WINDOW_PROTOCOL_VERSION,
  findProhibitedFields,
  type CommandEnvelope,
  type CommandType,
} from "../../../contracts/action-window/v1/index";
import { createLoopbackChannel, type AwClientTransport, type AwServerFrame } from "../../../contracts/action-window/v1/transport";
import { ActionWindowEngine } from "../../src/action-window/engine";
import { ActionWindowSession, SyntheticProbeDriver } from "../../src/action-window/session";
import { operationRunFrom, resumeStateFor, type OperationRun } from "../../src/action-window/operation-run";
import { loadOperationRun, saveOperationRun } from "../../src/action-window/run-store";
import {
  createPersistentRunSession,
  findResumableRun,
  openOrResumeRunSession,
  resumePersistedRunSession,
  type OpenedRunSession,
} from "../../src/action-window/run-lifecycle";

const CHANNEL = "synthetic";
const RUN_COPY = "actionWindow.run.synthetic";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});
function tmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), `aw-persist-${randomUUID()}-`));
  dirs.push(dir);
  return dir;
}

/** Minimal FE stand-in: sends commands with the engine's current revision, records acks. */
class Fe {
  results: Array<{ commandId: string; accepted: boolean; reason?: string }> = [];
  private n = 0;
  constructor(
    private readonly transport: AwClientTransport,
    private readonly engine: ActionWindowEngine,
  ) {
    transport.subscribe((f: AwServerFrame) => {
      if (f.kind === "aw_command_result") this.results.push({ commandId: f.commandId, accepted: f.accepted, reason: f.reason });
    });
  }
  envelope(type: CommandType, payload?: CommandEnvelope["payload"]): CommandEnvelope {
    return {
      protocolVersion: ACTION_WINDOW_PROTOCOL_VERSION,
      commandId: `${this.engine.view().runId}-fe${++this.n}-${randomUUID().slice(0, 8)}`,
      runId: this.engine.view().runId,
      expectedRevision: this.engine.view().revision,
      type,
      ...(payload ? { payload } : {}),
    };
  }
  send(type: CommandType, payload?: CommandEnvelope["payload"]): CommandEnvelope {
    const command = this.envelope(type, payload);
    this.sendRaw(command);
    return command;
  }
  sendRaw(command: CommandEnvelope): void {
    this.transport.send({ kind: "aw_command", command });
  }
  lastResult() {
    return this.results[this.results.length - 1];
  }
}

interface Process {
  opened: OpenedRunSession;
  fe: Fe;
  driver: SyntheticProbeDriver;
}

/** One "agent process": open-or-resume against the store dir, attach, and hand back an FE. */
function boot(dir: string, opts: { runId?: string; driver?: SyntheticProbeDriver } = {}): Process {
  const channel = createLoopbackChannel();
  const driver = opts.driver ?? new SyntheticProbeDriver();
  const opened = openOrResumeRunSession(
    { dir, transport: channel.server, driver },
    { runId: opts.runId ?? "run_persist", channelCode: CHANNEL, runCopyKey: RUN_COPY },
  );
  opened.session.attach();
  return { opened, fe: new Fe(channel.client, opened.engine), driver };
}

/** Drive a fresh process to the human checkpoint (started, waiting for the user). */
async function toCheckpoint(dir: string, runId = "run_persist"): Promise<Process> {
  const p = boot(dir, { runId });
  p.fe.send("START_RUN", { channelCode: CHANNEL });
  await p.opened.session.whenSettled();
  expect(p.opened.engine.view().status).toBe("WAITING_FOR_HUMAN");
  return p;
}

describe("Operation Run persistence & resume (R3)", () => {
  it("creates a Run from the live session and persists every published transition", async () => {
    const dir = tmpDir();
    const p = await toCheckpoint(dir);

    const run = loadOperationRun(dir, "run_persist");
    expect(run).not.toBeNull();
    expect(run!.runId).toBe("run_persist");
    expect(run!.channelCode).toBe(CHANNEL);
    expect(run!.resumeState).toBe("RESUME_AT_CHECKPOINT");
    expect(run!.latestView.status).toBe("WAITING_FOR_HUMAN");
    expect(run!.revision).toBe(p.opened.engine.view().revision);
    // Ordered tasks: prepare completed, human step awaiting the user, downstream pending.
    expect(run!.tasks.map((t) => [t.stepNumber, t.status])).toEqual([
      [1, "COMPLETED"],
      [2, "AWAITING_USER"],
      [3, "PENDING"],
    ]);
    expect(run!.humanCheckpoint).toMatchObject({ reached: true, observed: false });
    expect(run!.humanCheckpoint.targetRef).toMatch(/^[0-9a-f]{16}$/);
    // The persisted audit is the gapless ordered event log.
    expect(run!.engine.events.map((e) => e.sequence)).toEqual(run!.engine.events.map((_, i) => i + 1));
  });

  it("restores after a process restart and resumes back to the human checkpoint", async () => {
    const dir = tmpDir();
    const before = await toCheckpoint(dir);
    const seqBefore = before.opened.engine.runState().seq;
    // Process "dies" here (nothing torn down — exactly like a crash).

    const after = boot(dir);
    expect(after.opened.origin).toBe("RESUMED");
    expect(after.opened.resumeState).toBe("RESUME_AT_CHECKPOINT");
    // Parked at the PAUSED barrier — nothing ran on boot; the barrier itself is persisted.
    expect(after.opened.engine.view().status).toBe("PAUSED");
    expect(loadOperationRun(dir, "run_persist")!.latestView.status).toBe("PAUSED");

    // Only an explicit RESUME_RUN re-drives; the read-only chain re-verifies and lands at the checkpoint.
    after.fe.send("RESUME_RUN");
    await after.opened.session.whenSettled();
    expect(after.opened.engine.view().status).toBe("WAITING_FOR_HUMAN");
    expect(after.opened.engine.view().progress).toEqual({ completedSteps: 1, totalSteps: 3 });

    // The rest of the loop still works after the restart: user acts → recheck → completed.
    after.driver.completeUserAction(true);
    await after.opened.session.whenSettled();
    after.fe.send("REQUEST_STEP_RECHECK");
    await after.opened.session.whenSettled();
    expect(after.opened.engine.view().status).toBe("COMPLETED");
    expect(after.opened.engine.view().progress).toEqual({ completedSteps: 3, totalSteps: 3 });

    // Audit ordering: sequence continues gapless across the restart (never resets), and the restore
    // barrier itself is part of the recorded history.
    const seqs = after.opened.engine.events().map((e) => e.sequence);
    expect(seqs).toEqual(seqs.map((_, i) => i + 1));
    expect(seqs.length).toBeGreaterThan(seqBefore);
    const barrier = after.opened.engine.events().find((e) => e.sequence === seqBefore + 1)!;
    expect(barrier.type).toBe("RUN_STATUS_CHANGED");
    expect(barrier.payload.status).toBe("PAUSED");
    // The completed run is persisted terminal.
    expect(loadOperationRun(dir, "run_persist")!.resumeState).toBe("TERMINAL");
  });

  it("keeps a duplicate commandId a no-op across a restart (ledger persists)", async () => {
    const dir = tmpDir();
    const before = await toCheckpoint(dir);
    const cmd = before.fe.send("SET_GUIDANCE_ENABLED", { enabled: false });
    await before.opened.session.whenSettled();
    expect(before.opened.engine.view().guidanceEnabled).toBe(false);

    const after = boot(dir);
    const revisionAfterRestore = after.opened.engine.view().revision;
    after.fe.sendRaw(cmd); // exact same envelope replayed into the RESTORED process
    await after.opened.session.whenSettled();
    expect(after.fe.lastResult()).toMatchObject({ commandId: cmd.commandId, accepted: true });
    expect(after.opened.engine.view().revision).toBe(revisionAfterRestore); // no second mutation
    expect(after.opened.engine.view().guidanceEnabled).toBe(false); // still the FIRST application
  });

  it("rejects a stale revision against the restored run", async () => {
    const dir = tmpDir();
    const before = await toCheckpoint(dir);
    const staleRevision = before.opened.engine.view().revision; // pre-restart revision

    const after = boot(dir); // restore bumped the revision (PAUSED barrier)
    expect(after.opened.engine.view().revision).toBeGreaterThan(staleRevision);
    after.fe.sendRaw({
      protocolVersion: ACTION_WINDOW_PROTOCOL_VERSION,
      commandId: "stale-after-restore",
      runId: "run_persist",
      expectedRevision: staleRevision,
      type: "CANCEL_RUN",
    });
    await after.opened.session.whenSettled();
    expect(after.fe.lastResult()).toEqual({ commandId: "stale-after-restore", accepted: false, reason: "STALE_REVISION" });
    expect(after.opened.engine.view().status).toBe("PAUSED"); // unchanged
  });

  it("resumes downstream processing idempotently after an interruption between verify and completion", async () => {
    const dir = tmpDir();
    // Capture the exact mid-flight record: verified (step 2 done) but downstream not yet run.
    const channel = createLoopbackChannel();
    const driver = new SyntheticProbeDriver();
    const engine = new ActionWindowEngine({ runId: "run_mid", channelCode: CHANNEL, runCopyKey: RUN_COPY });
    const snapshots: OperationRun[] = [];
    const session = new ActionWindowSession(engine, driver, channel.server, {
      onStatePublished: () => snapshots.push(operationRunFrom(engine)),
    });
    session.attach();
    const fe = new Fe(channel.client, engine);
    fe.send("START_RUN", { channelCode: CHANNEL });
    await session.whenSettled();
    driver.completeUserAction(true);
    await session.whenSettled();
    fe.send("REQUEST_STEP_RECHECK");
    await session.whenSettled();
    const midFlight = snapshots.find((s) => s.engine.stage === "RUN_DUMMY_DOWNSTREAM");
    expect(midFlight).toBeDefined();
    expect(midFlight!.engine.completedSteps).toBe(2); // verified, not yet processed
    saveOperationRun(dir, midFlight!); // the state at the moment the "crash" hit

    const after = boot(dir, { runId: "run_mid" });
    expect(after.opened.origin).toBe("RESUMED");
    expect(after.opened.resumeState).toBe("RESUME_DOWNSTREAM");
    after.fe.send("RESUME_RUN");
    await after.opened.session.whenSettled();
    expect(after.opened.engine.view().status).toBe("COMPLETED");
    expect(after.opened.engine.view().progress).toEqual({ completedSteps: 3, totalSteps: 3 });
    // Idempotency: completion was recorded exactly once, and a second resume cannot re-run anything.
    expect(after.opened.engine.events().filter((e) => e.type === "RUN_COMPLETED")).toHaveLength(1);
    after.fe.send("RESUME_RUN");
    await after.opened.session.whenSettled();
    expect(after.fe.lastResult()).toMatchObject({ accepted: false, reason: "INVALID_FOR_STATE" });
  });

  it("resumes a failed run; a persistent cause fails closed again, a fixed cause completes", async () => {
    const dir = tmpDir();
    // Fail closed: two candidates → TARGET_AMBIGUOUS.
    const broken = boot(dir, { runId: "run_fail", driver: new SyntheticProbeDriver({ locate: { count: 2 } }) });
    broken.fe.send("START_RUN", { channelCode: CHANNEL });
    await broken.opened.session.whenSettled();
    expect(broken.opened.engine.view().status).toBe("FAILED");
    expect(loadOperationRun(dir, "run_fail")!.resumeState).toBe("RESUME_FROM_FAILURE");

    // Restart with the SAME broken page: resume re-enters the chain and fails closed again (no click).
    const stillBroken = boot(dir, { runId: "run_fail", driver: new SyntheticProbeDriver({ locate: { count: 2 } }) });
    expect(stillBroken.opened.resumeState).toBe("RESUME_FROM_FAILURE");
    expect(stillBroken.opened.engine.view().status).toBe("PAUSED");
    expect(stillBroken.opened.engine.view().blocker).toBeUndefined(); // barrier cleared it; probes decide
    stillBroken.fe.send("RESUME_RUN");
    await stillBroken.opened.session.whenSettled();
    expect(stillBroken.opened.engine.view().status).toBe("FAILED");
    expect(stillBroken.opened.engine.view().blocker?.code).toBe("TARGET_AMBIGUOUS");

    // Restart after the cause is fixed: the run resumes and completes end-to-end.
    const fixed = boot(dir, { runId: "run_fail" }); // healthy driver
    fixed.fe.send("RESUME_RUN");
    await fixed.opened.session.whenSettled();
    expect(fixed.opened.engine.view().status).toBe("WAITING_FOR_HUMAN");
    fixed.driver.completeUserAction(true);
    await fixed.opened.session.whenSettled();
    fixed.fe.send("REQUEST_STEP_RECHECK");
    await fixed.opened.session.whenSettled();
    expect(fixed.opened.engine.view().status).toBe("COMPLETED");
  });

  it("protects terminal runs: completed/cancelled never restart, restore is read-only", async () => {
    const dir = tmpDir();
    // Complete a run.
    const p = await toCheckpoint(dir, "run_done");
    p.driver.completeUserAction(true);
    await p.opened.session.whenSettled();
    p.fe.send("REQUEST_STEP_RECHECK");
    await p.opened.session.whenSettled();
    expect(p.opened.engine.view().status).toBe("COMPLETED");

    // Boot again: the terminal run is NOT resumed — a new run is minted instead; history stays intact.
    expect(findResumableRun(dir)).toBeNull();
    const next = boot(dir, { runId: "run_next" });
    expect(next.opened.origin).toBe("NEW");
    expect(next.opened.engine.view().runId).toBe("run_next");
    expect(loadOperationRun(dir, "run_done")!.latestView.status).toBe("COMPLETED");

    // An explicit restore of the terminal record is read-only: every command is rejected.
    const channel = createLoopbackChannel();
    const restored = resumePersistedRunSession(
      { dir, transport: channel.server, driver: new SyntheticProbeDriver() },
      loadOperationRun(dir, "run_done")!,
    );
    restored.session.attach();
    expect(restored.resumeState).toBe("TERMINAL");
    expect(restored.engine.view().status).toBe("COMPLETED");
    expect(restored.engine.view().allowedCommands).toEqual([]);
    const fe = new Fe(channel.client, restored.engine);
    for (const type of ["START_RUN", "RESUME_RUN", "REQUEST_STEP_RECHECK", "CANCEL_RUN"] as const) {
      fe.send(type, type === "START_RUN" ? { channelCode: CHANNEL } : undefined);
      await restored.session.whenSettled();
      expect(fe.lastResult()).toMatchObject({ accepted: false, reason: "INVALID_FOR_STATE" });
    }
    // The barrier API itself refuses terminal stages.
    expect(() => restored.engine.pauseForRestore("PREPARE_SESSION")).toThrowError(/terminal/);

    // Cancelled runs are protected the same way.
    const c = await toCheckpoint(dir, "run_cancel");
    c.fe.send("CANCEL_RUN");
    await c.opened.session.whenSettled();
    expect(c.opened.engine.view().status).toBe("CANCELLED");
    expect(resumeStateFor(loadOperationRun(dir, "run_cancel")!.engine)).toBe("TERMINAL");
    expect(findResumableRun(dir)).toBeNull();
  });

  it("holds the privacy boundary in everything persisted", async () => {
    const dir = tmpDir();
    const before = await toCheckpoint(dir, "run_privacy");
    before.driver.completeUserAction(true);
    await before.opened.session.whenSettled();

    const record = loadOperationRun(dir, "run_privacy")!;
    expect(findProhibitedFields(record)).toEqual([]);
    // Only the opaque 16-hex ref identifies the target — nothing else could even be stored.
    expect(record.humanCheckpoint.targetRef).toMatch(/^[0-9a-f]{16}$/);
    const raw = JSON.stringify(record);
    for (const needle of ["selector", "http://", "https://", "cookie", "password", "Authorization", "/Users/"]) {
      expect(raw).not.toContain(needle);
    }
  });

  it("createPersistentRunSession alone persists nothing until the first published transition", () => {
    const dir = tmpDir();
    const channel = createLoopbackChannel();
    createPersistentRunSession(
      { dir, transport: channel.server, driver: new SyntheticProbeDriver() },
      { runId: "run_lazy", channelCode: CHANNEL, runCopyKey: RUN_COPY },
    );
    expect(loadOperationRun(dir, "run_lazy")).toBeNull(); // nothing ran, nothing stored
  });
});
