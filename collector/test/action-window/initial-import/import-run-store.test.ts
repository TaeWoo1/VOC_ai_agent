/**
 * The run store and the recovery policy.
 *
 * The policy is the interesting part and it is easy to re-derive incorrectly: an import ingest IS
 * idempotent, so "therefore resume" looks right and is wrong. Resuming would mean persisting a launch ref
 * — a single-use ingest authorization — to disk. These tests pin the conclusion and the constraint that
 * produces it.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  IMPORT_RUN_SCHEMA_VERSION,
  ImportRunStoreError,
  defaultImportRunDirFor,
  listImportRuns,
  readImportRun,
  recoverImportRuns,
  removeImportRun,
  saveImportRun,
  type ImportRunRecord,
} from "../../../src/action-window/initial-import/import-run-store";
import { assembleImportRun, makeImportRunMarker, mintImportRunId } from "../../../src/action-window/initial-import/import-dispatch";
import { ImportFixtureDriver } from "../../../src/action-window/initial-import/import-fixture-driver";
import { makeImportClock } from "../../../src/action-window/initial-import/import-engine";
import type { AwClientFrame, AwServerFrame, AwServerTransport } from "../../../../contracts/action-window/v2/transport";

let dir: string;
const marker = () => "import-run.000001";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "import-run-store-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function record(overrides: Partial<ImportRunRecord> = {}): ImportRunRecord {
  return {
    schemaVersion: IMPORT_RUN_SCHEMA_VERSION,
    runId: "run_abc123",
    channelCode: "naver",
    stage: "WAIT_FOR_EXPORT",
    artifactDetected: false,
    abandoned: false,
    updatedAt: marker(),
    ...overrides,
  };
}

describe("import run store", () => {
  it("round-trips a record", () => {
    saveImportRun(dir, record());
    expect(readImportRun(dir, "run_abc123")).toEqual(record());
  });

  it("writes with restrictive permissions and leaves no temp file", () => {
    saveImportRun(dir, record());
    const target = join(dir, "run_abc123.json");
    expect(statSync(target).mode & 0o777).toBe(0o600);
    expect(existsSync(`${target}.tmp`)).toBe(false);
  });

  it("returns null for a run it has never seen", () => {
    expect(readImportRun(dir, "run_missing")).toBeNull();
  });

  it("refuses a run id that could escape the directory", () => {
    expect(() => saveImportRun(dir, record({ runId: "../escape" }))).toThrow(ImportRunStoreError);
    expect(() => readImportRun(dir, "a/b")).toThrow(ImportRunStoreError);
  });

  it("refuses a malformed artifact reference", () => {
    expect(() => saveImportRun(dir, record({ artifactRef: "not-16-hex" }))).toThrow(ImportRunStoreError);
  });

  /** The gate that stops a path, a date or a launch ref reaching disk by accident. */
  it("refuses prohibited content before it reaches disk", () => {
    const leaky = { ...record(), filePath: "/Users/someone/Downloads/review.xlsx" } as unknown as ImportRunRecord;
    expect(() => saveImportRun(dir, leaky)).toThrow(ImportRunStoreError);
    expect(existsSync(join(dir, "run_abc123.json"))).toBe(false);
  });

  it("reports malformed JSON rather than crashing", () => {
    writeFileSync(join(dir, "run_bad.json"), "{not json");
    expect(() => readImportRun(dir, "run_bad")).toThrow(ImportRunStoreError);
  });

  /** One unreadable marker must not stop the agent from serving a fresh run. */
  it("skips an unreadable marker when listing instead of failing", () => {
    saveImportRun(dir, record());
    writeFileSync(join(dir, "run_bad.json"), "{not json");
    expect(listImportRuns(dir).map((r) => r.runId)).toEqual(["run_abc123"]);
  });

  it("lists nothing for a directory that does not exist", () => {
    expect(listImportRuns(join(dir, "nope"))).toEqual([]);
  });

  it("removes a record", () => {
    saveImportRun(dir, record());
    removeImportRun(dir, "run_abc123");
    expect(readImportRun(dir, "run_abc123")).toBeNull();
    // Removing twice is not an error — cleanup paths run more than once.
    expect(() => removeImportRun(dir, "run_abc123")).not.toThrow();
  });

  it("keeps its own dot-dir, separate from the export and reply stores", () => {
    const path = defaultImportRunDirFor("/tmp/agent");
    expect(path).toBe("/tmp/agent/.import-runs");
    expect(path).not.toContain(".operation-runs");
    expect(path).not.toContain(".reply-runs");
  });
});

describe("import run recovery", () => {
  it("abandons an interrupted run and never re-drives it", () => {
    saveImportRun(dir, record({ runId: "run_live1", stage: "WAIT_FOR_END" }));

    const result = recoverImportRuns(dir, () => "import-run.000002");

    expect(result.abandoned).toEqual(["run_live1"]);
    expect(readImportRun(dir, "run_live1")?.abandoned).toBe(true);
  });

  it("separates the run that cost the seller an export from the one that cost them nothing", () => {
    saveImportRun(dir, record({ runId: "run_early", stage: "WAIT_FOR_START", artifactDetected: false }));
    saveImportRun(dir, record({ runId: "run_late", stage: "INGEST", artifactDetected: true, artifactRef: "a1b2c3d4e5f60718" }));

    const result = recoverImportRuns(dir, () => "import-run.000002");

    expect(result.abandoned.sort()).toEqual(["run_early", "run_late"]);
    expect(result.abandonedAfterDownload).toEqual(["run_late"]);
  });

  it("leaves a completed run alone", () => {
    saveImportRun(dir, record({ runId: "run_done", stage: "COMPLETED" }));
    expect(recoverImportRuns(dir, marker).abandoned).toEqual([]);
    expect(readImportRun(dir, "run_done")?.abandoned).toBe(false);
  });

  it("is idempotent — a second recovery pass abandons nothing new", () => {
    saveImportRun(dir, record({ runId: "run_live1" }));
    expect(recoverImportRuns(dir, marker).abandoned).toEqual(["run_live1"]);
    expect(recoverImportRuns(dir, marker).abandoned).toEqual([]);
  });

  it("recovers nothing from an empty store", () => {
    expect(recoverImportRuns(dir, marker)).toEqual({ abandoned: [], abandonedAfterDownload: [] });
  });
});

describe("import dispatch", () => {
  function loopback() {
    const sent: AwServerFrame[] = [];
    let listener: ((frame: AwClientFrame) => void) | null = null;
    return {
      sent,
      transport: {
        send: (frame: AwServerFrame) => void sent.push(frame),
        subscribe: (l: (frame: AwClientFrame) => void) => {
          listener = l;
          return () => {
            listener = null;
          };
        },
      } as AwServerTransport,
      send: (frame: AwClientFrame) => listener?.(frame),
    };
  }

  it("mints an opaque runtime-assigned identity", () => {
    const id = mintImportRunId();
    expect(id).toMatch(/^run_[0-9a-f]{12}$/);
    expect(mintImportRunId()).not.toBe(id);
  });

  it("persists a sanitized marker after every published transition, and never the launch ref", async () => {
    const io = loopback();
    const importRef = "9f2a1c7b4e6d0835";
    const { session, runId } = assembleImportRun(io.transport, {
      runId: mintImportRunId(),
      channelCode: "naver",
      importRef,
      required: { start: "2026-01-01", end: "2026-01-31" },
      driver: new ImportFixtureDriver(),
      persistDir: dir,
      now: makeImportRunMarker(),
      clock: makeImportClock(),
    });
    session.attach();
    io.send({
      kind: "aw_command",
      command: {
        protocolVersion: 2,
        commandId: "c1",
        runId,
        expectedRevision: 0,
        type: "START_RUN",
        payload: { channelCode: "naver", intent: "INITIAL_REVIEW_IMPORT_SEGMENT", importRef },
      },
    });
    await session.whenSettled();

    const saved = readImportRun(dir, runId);
    expect(saved?.stage).toBe("COMPLETED");
    expect(saved?.artifactDetected).toBe(true);
    // The single-use authorization is never written to disk — that constraint is what rules out resuming.
    const onDisk = readFileSync(join(dir, `${runId}.json`), "utf8");
    expect(onDisk).not.toContain(importRef);
    // Nor is a date, a path, or a filename.
    expect(onDisk).not.toContain("2026-01-01");
    expect(onDisk).not.toContain(".xlsx");
  });

  it("writes nothing when no persistDir is given", async () => {
    const io = loopback();
    const { session } = assembleImportRun(io.transport, {
      runId: mintImportRunId(),
      channelCode: "naver",
      importRef: "9f2a1c7b4e6d0835",
      required: { start: "2026-01-01", end: "2026-01-31" },
      driver: new ImportFixtureDriver(),
    });
    session.attach();
    await session.whenSettled();
    expect(listImportRuns(dir)).toEqual([]);
  });

  /**
   * A default driver would inevitably be the fixture one, and a fixture driver on the product path would
   * report imports that never happened. The type system enforces it; this states the intent.
   */
  it("requires an injected driver — there is no default", () => {
    const source = readFileSync(
      join(__dirname, "../../../src/action-window/initial-import/import-dispatch.ts"),
      "utf8",
    );
    expect(source).not.toContain("ImportFixtureDriver");
    expect(source).toContain("driver: ImportProbeDriver");
  });
});
