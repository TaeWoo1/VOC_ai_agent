/**
 * **Operation Run file store tests (R3).** Durability discipline: atomic save/load round-trip,
 * corrupt/invalid/tampered records rejected whole with sanitized error categories (never file
 * contents), the prohibited-content gate on BOTH save and load, and filename safety for runIds.
 */
import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { ActionWindowEngine } from "../../src/action-window/engine";
import { SyntheticProbeDriver, ActionWindowSession } from "../../src/action-window/session";
import { createLoopbackChannel } from "../../../contracts/action-window/v1/transport";
import { operationRunFrom, OPERATION_RUN_SCHEMA_VERSION, type OperationRun } from "../../src/action-window/operation-run";
import {
  OperationRunStoreError,
  defaultOperationRunDirFor,
  deleteOperationRun,
  listOperationRunIds,
  loadOperationRun,
  saveOperationRun,
} from "../../src/action-window/run-store";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function tmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), `aw-runs-${randomUUID()}-`));
  dirs.push(dir);
  return dir;
}

/** Drive a real engine to the human checkpoint and project its Operation Run. */
async function checkpointRun(runId = "run_store_test"): Promise<OperationRun> {
  const channel = createLoopbackChannel();
  const engine = new ActionWindowEngine({ runId, channelCode: "synthetic", runCopyKey: "actionWindow.run.synthetic" });
  const session = new ActionWindowSession(engine, new SyntheticProbeDriver(), channel.server);
  session.attach();
  channel.client.send({
    kind: "aw_command",
    command: { protocolVersion: 1, commandId: `${runId}-c1`, runId, expectedRevision: 0, type: "START_RUN", payload: { channelCode: "synthetic" } },
  });
  await session.whenSettled();
  return operationRunFrom(engine);
}

describe("action-window run store", () => {
  it("computes a deterministic dot-dir default under the collector root", () => {
    expect(defaultOperationRunDirFor("/x/collector")).toBe("/x/collector/.operation-runs");
  });

  it("saves and loads a run (atomic write, restrictive perms, round-trip equality)", async () => {
    const dir = tmpDir();
    const run = await checkpointRun();
    saveOperationRun(dir, run);
    expect(existsSync(join(dir, `${run.runId}.json.tmp`))).toBe(false); // temp renamed away
    const loaded = loadOperationRun(dir, run.runId);
    expect(loaded).toEqual(JSON.parse(JSON.stringify(run))); // exactly what was written
    expect(listOperationRunIds(dir)).toEqual([run.runId]);
  });

  it("returns null for a missing run and [] for a missing dir", () => {
    const dir = tmpDir();
    expect(loadOperationRun(dir, "run_absent")).toBeNull();
    expect(listOperationRunIds(join(dir, "nope"))).toEqual([]);
  });

  it("rejects malformed JSON with a sanitized category (never file contents)", async () => {
    const dir = tmpDir();
    const run = await checkpointRun();
    saveOperationRun(dir, run);
    writeFileSync(join(dir, `${run.runId}.json`), "{corrupt-secret-looking-content", "utf8");
    let err: unknown;
    try {
      loadOperationRun(dir, run.runId);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(OperationRunStoreError);
    expect((err as OperationRunStoreError).category).toBe("STORE_MALFORMED_JSON");
    expect((err as Error).message).not.toContain("secret"); // message is the category only
  });

  it("rejects a wrong schema version and a tampered field whole", async () => {
    const dir = tmpDir();
    const run = await checkpointRun();
    saveOperationRun(dir, run);
    const path = join(dir, `${run.runId}.json`);

    const wrongVersion = { ...JSON.parse(readFileSync(path, "utf8")), schemaVersion: OPERATION_RUN_SCHEMA_VERSION + 1 };
    writeFileSync(path, JSON.stringify(wrongVersion), "utf8");
    expect(() => loadOperationRun(dir, run.runId)).toThrowError(/STORE_INVALID_RECORD:WRONG_SCHEMA_VERSION/);

    const tampered = JSON.parse(JSON.stringify(run)) as { engine: { stage: string } };
    tampered.engine.stage = "NOT_A_STAGE";
    writeFileSync(path, JSON.stringify(tampered), "utf8");
    expect(() => loadOperationRun(dir, run.runId)).toThrowError(/STORE_INVALID_RECORD/);
  });

  it("fails closed on a legacy v1 record (pre-downstream schema) — never half-loads or migrates", async () => {
    const dir = tmpDir();
    const run = await checkpointRun("run_legacy_v1");
    saveOperationRun(dir, run);
    const path = join(dir, `${run.runId}.json`);
    // A stale dev record from the R3 era: schemaVersion 1 carrying the retired dummy-downstream stage.
    const legacy = JSON.parse(readFileSync(path, "utf8")) as { schemaVersion: number; engine: { stage: string } };
    legacy.schemaVersion = 1;
    legacy.engine.stage = "RUN_DUMMY_DOWNSTREAM";
    writeFileSync(path, JSON.stringify(legacy), "utf8");
    expect(() => loadOperationRun(dir, run.runId)).toThrowError(/STORE_INVALID_RECORD:WRONG_SCHEMA_VERSION/);
  });

  it("rejects an audit log with a sequence gap (order is load-bearing)", async () => {
    const dir = tmpDir();
    const run = await checkpointRun();
    const gapped = JSON.parse(JSON.stringify(run)) as OperationRun & { engine: { events: unknown[] } };
    gapped.engine.events.splice(2, 1); // drop one event → gap
    expect(() => saveOperationRun(dir, gapped as unknown as OperationRun)).toThrowError(/STORE_INVALID_RECORD:INVALID_EVENT/);
  });

  it("refuses to persist prohibited content (fail closed BEFORE disk)", async () => {
    const dir = tmpDir();
    const run = await checkpointRun();
    const poisoned = JSON.parse(JSON.stringify(run)) as Record<string, unknown>;
    (poisoned as { latestView: Record<string, unknown> }).latestView.selector = "#export > button";
    let err: unknown;
    try {
      saveOperationRun(dir, poisoned as unknown as OperationRun);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(OperationRunStoreError);
    expect((err as OperationRunStoreError).category).toBe("STORE_PROHIBITED_CONTENT");
    expect(existsSync(join(dir, `${run.runId}.json`))).toBe(false); // nothing reached disk
  });

  it("refuses to load prohibited content injected into an existing file", async () => {
    const dir = tmpDir();
    const run = await checkpointRun();
    saveOperationRun(dir, run);
    const path = join(dir, `${run.runId}.json`);
    const poisoned = JSON.parse(readFileSync(path, "utf8")) as { humanCheckpoint: Record<string, unknown> };
    poisoned.humanCheckpoint.url = "https://seller.example/export";
    writeFileSync(path, JSON.stringify(poisoned), "utf8");
    expect(() => loadOperationRun(dir, run.runId)).toThrowError(/STORE_PROHIBITED_CONTENT/);
  });

  it("rejects a runId that is not a safe opaque filename", () => {
    const dir = tmpDir();
    expect(() => loadOperationRun(dir, "../escape")).toThrowError(/STORE_INVALID_RUN_ID/);
    expect(() => loadOperationRun(dir, "a/b")).toThrowError(/STORE_INVALID_RUN_ID/);
    expect(() => loadOperationRun(dir, "")).toThrowError(/STORE_INVALID_RUN_ID/);
  });

  it("deletes idempotently", async () => {
    const dir = tmpDir();
    const run = await checkpointRun();
    saveOperationRun(dir, run);
    deleteOperationRun(dir, run.runId);
    deleteOperationRun(dir, run.runId); // second delete is a no-op
    expect(loadOperationRun(dir, run.runId)).toBeNull();
  });
});
