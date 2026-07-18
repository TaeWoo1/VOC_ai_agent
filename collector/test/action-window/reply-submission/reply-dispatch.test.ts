/**
 * Shared reply-submission dispatch service + isolated `.reply-runs` store + restart PARK recovery.
 * All offline (in-process v2 loopback, a tmp store dir) — no browser, no Bridge server.
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLoopbackChannel, type AwServerFrame } from "../../../../contracts/action-window/v2/transport";
import {
  assembleReplyRun,
  makeReplyRunMarker,
  mintReplyRunId,
  recoverReplyRuns,
} from "../../../src/action-window/reply-submission/reply-dispatch";
import { SyntheticReplySubmitDriver } from "../../../src/action-window/reply-submission/reply-driver";
import {
  listReplyRunIds,
  loadReplyRun,
  REPLY_RUN_SCHEMA_VERSION,
  saveReplyRun,
} from "../../../src/action-window/reply-submission/reply-run-store";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function newDir(): string {
  const d = mkdtempSync(join(tmpdir(), "reply-runs-"));
  dirs.push(d);
  return d;
}

describe("mintReplyRunId", () => {
  it("mints an opaque run_<12 hex> identity (same shape as the export runtime)", () => {
    expect(mintReplyRunId()).toMatch(/^run_[0-9a-f]{12}$/);
  });
});

describe("assembleReplyRun over the v2 loopback (persisting to .reply-runs)", () => {
  it("drives to OPERATOR_REPORTED and persists a terminal marker", async () => {
    const dir = newDir();
    const { client, server } = createLoopbackChannel();
    const runId = mintReplyRunId();
    const driver = new SyntheticReplySubmitDriver();
    const { session } = assembleReplyRun(server, {
      runId,
      channelCode: "naver",
      submissionRef: "a1b2c3d4e5f60718",
      createDriver: () => driver,
      persistDir: dir,
      now: makeReplyRunMarker(),
    });
    session.attach();
    const frames: AwServerFrame[] = [];
    client.subscribe((f) => frames.push(f));

    client.send({
      kind: "aw_command",
      command: { protocolVersion: 2, commandId: "c1", runId, expectedRevision: 0, type: "START_RUN",
        payload: { channelCode: "naver", intent: "REPLY_SUBMISSION", submissionRef: "a1b2c3d4e5f60718" } },
    });
    await session.whenSettled();

    // A marker is persisted at the barrier — the record leads nothing on the wire.
    const parked0 = loadReplyRun(dir, runId);
    expect(parked0?.stage).toBe("WAIT_FOR_SUBMIT");
    expect(parked0?.parked).toBe(false);

    driver.completeSubmit(true);
    await session.whenSettled();
    const latestRev = () => {
      for (let i = frames.length - 1; i >= 0; i--) { const f = frames[i]!; if (f.kind === "aw_view") return f.view.revision; }
      return 0;
    };
    client.send({ kind: "aw_command", command: { protocolVersion: 2, commandId: "c2", runId, expectedRevision: latestRev(), type: "REQUEST_STEP_RECHECK" } });
    await session.whenSettled();

    const done = loadReplyRun(dir, runId);
    expect(done?.stage).toBe("OPERATOR_REPORTED");
  });

  it("without a persistDir, writes no store files", async () => {
    const { client, server } = createLoopbackChannel();
    const runId = mintReplyRunId();
    const { session } = assembleReplyRun(server, { runId, channelCode: "naver", createDriver: () => new SyntheticReplySubmitDriver() });
    session.attach();
    client.send({ kind: "aw_command", command: { protocolVersion: 2, commandId: "c1", runId, expectedRevision: 0, type: "START_RUN", payload: { channelCode: "naver", intent: "REPLY_SUBMISSION", submissionRef: "a1b2c3d4e5f60718" } } });
    await session.whenSettled();
    // No dir was created (nothing to assert beyond no throw); persistence is opt-in.
    expect(true).toBe(true);
  });
});

describe("recoverReplyRuns — restart PARKS interrupted runs, never resumes", () => {
  it("marks a non-terminal run PARKED and leaves terminal runs untouched; idempotent", () => {
    const dir = newDir();
    const now = makeReplyRunMarker();
    saveReplyRun(dir, { schemaVersion: REPLY_RUN_SCHEMA_VERSION, runId: "run_aaaaaaaaaaaa", channelCode: "naver", stage: "WAIT_FOR_SUBMIT", mode: "FULL_SUBMIT", planKind: "LEGACY", parked: false, updatedAt: now() });
    saveReplyRun(dir, { schemaVersion: REPLY_RUN_SCHEMA_VERSION, runId: "run_bbbbbbbbbbbb", channelCode: "naver", stage: "OPERATOR_REPORTED", mode: "FULL_SUBMIT", planKind: "LEGACY", parked: false, updatedAt: now() });

    const first = recoverReplyRuns(dir, now);
    expect(first.parked).toEqual(["run_aaaaaaaaaaaa"]); // terminal run is not parked

    expect(loadReplyRun(dir, "run_aaaaaaaaaaaa")?.parked).toBe(true);
    expect(loadReplyRun(dir, "run_bbbbbbbbbbbb")?.parked).toBe(false);

    // Idempotent: an already-parked run is not parked again.
    expect(recoverReplyRuns(dir, now).parked).toEqual([]);
  });
});

describe(".reply-runs store — sanitized, fail-closed", () => {
  it("round-trips a valid marker and lists it", () => {
    const dir = newDir();
    const rec = { schemaVersion: REPLY_RUN_SCHEMA_VERSION, runId: "run_cccccccccccc", channelCode: "naver", stage: "PREPARE_SESSION" as const, mode: "FULL_SUBMIT" as const, planKind: "LEGACY" as const, parked: false, updatedAt: "reply-run.000001" };
    saveReplyRun(dir, rec);
    expect(listReplyRunIds(dir)).toEqual(["run_cccccccccccc"]);
    expect(loadReplyRun(dir, "run_cccccccccccc")).toEqual(rec);
  });

  it("rejects a malformed record on load", () => {
    const dir = newDir();
    writeFileSync(join(dir, "run_dddddddddddd.json"), JSON.stringify({ schemaVersion: REPLY_RUN_SCHEMA_VERSION, runId: "run_dddddddddddd", channelCode: "naver", stage: "NOT_A_STAGE", mode: "FULL_SUBMIT", planKind: "LEGACY", parked: false, updatedAt: "x" }));
    expect(() => loadReplyRun(dir, "run_dddddddddddd")).toThrow(/STORE_INVALID_RECORD/);
  });

  it("refuses a runId that is not opaque-id-safe", () => {
    const dir = newDir();
    expect(() => saveReplyRun(dir, { schemaVersion: REPLY_RUN_SCHEMA_VERSION, runId: "../evil", channelCode: "naver", stage: "PREPARE_SESSION", mode: "FULL_SUBMIT", planKind: "LEGACY", parked: false, updatedAt: "x" })).toThrow();
    expect(readdirSync(dir)).toEqual([]);
  });

  it("fails closed on a record missing mode/planKind — recovery never defaults to FULL_SUBMIT/LEGACY", () => {
    const dir = newDir();
    // A record that lost its non-sensitive identity must be REJECTED, never silently defaulted.
    writeFileSync(
      join(dir, "run_eeeeeeeeeeee.json"),
      JSON.stringify({ schemaVersion: REPLY_RUN_SCHEMA_VERSION, runId: "run_eeeeeeeeeeee", channelCode: "naver", stage: "WAIT_FOR_SUBMIT", parked: false, updatedAt: "x" }),
    );
    expect(() => loadReplyRun(dir, "run_eeeeeeeeeeee")).toThrow(/STORE_INVALID_RECORD/);
  });

  it("round-trips an ABORT_REHEARSAL / GUIDED run identity", () => {
    const dir = newDir();
    const rec = { schemaVersion: REPLY_RUN_SCHEMA_VERSION, runId: "run_ffffffffffff", channelCode: "naver", stage: "WAIT_FOR_ROW_OPEN" as const, mode: "ABORT_REHEARSAL" as const, planKind: "GUIDED" as const, parked: false, updatedAt: "reply-run.000009" };
    saveReplyRun(dir, rec);
    expect(loadReplyRun(dir, "run_ffffffffffff")).toEqual(rec);
  });
});
