/**
 * The ASIDE provider's carrier half, with a scripted executor and an in-memory handoff: outcome mapping, the
 * launch-ref boundary (the executor never sees it), observability, and the two failure directions.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { AsideSegmentExecution } from "../../src/aside/aside-execution-provider";
import type { ExportExecutionResult } from "../../src/aside/aside-export-executor";
import type { HostFileHandoffResult } from "../../src/aside/host-file-handoff";
import type { SegmentExecutionContext, SegmentExecutionRequest } from "../../src/action-window/initial-import/execution-provider";
import { clearLogSink, getLogSink } from "../../src/log";
import type { AwServerTransport } from "../../../contracts/action-window/v2/transport";

const request: SegmentExecutionRequest = {
  runId: "run_0123456789ab",
  channelCode: "naver",
  accountSlot: "aabbccddeeff00112233abcd",
  required: { start: "2026-01-01", end: "2026-01-31" },
};
const transport: AwServerTransport = { send: () => {}, subscribe: () => () => {} };
const ctx: SegmentExecutionContext = {
  transport,
  importRef: "9f2a1c7b4e6d0835",
  startFrame: { kind: "aw_resync", runId: "r", sinceSequence: 0 },
};

const observed = { startedAt: "2026-09-12T00:00:00.000Z", completedAt: "2026-09-12T00:00:02.000Z", durationMs: 2000, llmCalls: 0, executorVersion: "1.26.906.1630" };

function executed(result: ExportExecutionResult) {
  const inputs: unknown[] = [];
  return {
    inputs,
    executor: {
      execute: async (req: SegmentExecutionRequest) => {
        inputs.push(req);
        return result;
      },
    },
  };
}

function handoffOf(result: HostFileHandoffResult) {
  const paths: string[] = [];
  return {
    paths,
    handoff: async (hostPath: string) => {
      paths.push(hostPath);
      return result;
    },
  };
}

beforeEach(() => clearLogSink());

describe("ASIDE provider", () => {
  it("success: executor → handoff → ok outcome with hash, size, evidence, processed; the executor never sees the ref", async () => {
    const ex = executed({ ok: true, workflow: { id: "fixture-review-export", version: 1 }, hostPath: "/Users/x/Downloads/f.xlsx", suggestedName: "f.xlsx", scopeEvidence: "MACHINE_MATCHED", observed });
    const ho = handoffOf({ ok: true, artifactRef: "0123456789abcdef", sha256: "ab".repeat(32), bytes: 1234, processed: 9, deleted: true });
    const ingestCalls: number[] = [];
    const provider = new AsideSegmentExecution({ executor: ex.executor, ingest: async () => (ingestCalls.push(1), { ok: true, processed: 9 }), handoff: ho.handoff });
    const run = provider.start(request, ctx);
    expect(run.provider).toBe("ASIDE");
    expect(run.session()).toBeNull();
    const outcome = await run.settled();
    expect(run.runStatus()).toBe("COMPLETED");
    expect(outcome).toMatchObject({ ok: true, provider: "ASIDE", runId: request.runId, workflow: { id: "fixture-review-export", version: 1 }, artifactRef: "0123456789abcdef", scopeEvidence: "MACHINE_MATCHED", processed: 9 });
    if (!outcome.ok) throw new Error("unreachable");
    expect(outcome.observed.artifactSha256).toBe("ab".repeat(32));
    expect(outcome.observed.artifactBytes).toBe(1234);
    expect(outcome.observed.executorVersion).toBe("1.26.906.1630");
    expect(outcome.observed.llmCalls).toBe(0);
    // The executor was handed the identity-free request and nothing else.
    expect(ex.inputs).toHaveLength(1);
    expect(JSON.stringify(ex.inputs[0])).not.toContain(ctx.importRef);
    expect(Object.keys(ex.inputs[0] as object)).not.toContain("importRef");
    expect(ho.paths).toEqual(["/Users/x/Downloads/f.xlsx"]);
    // Sanitized log: no path, no selector, no ref.
    const text = JSON.stringify(getLogSink());
    expect(text).not.toContain("/Users/x/Downloads");
    expect(text).not.toContain(ctx.importRef);
    expect(getLogSink().find((e) => e.event === "aside_execution_completed")?.meta).toMatchObject({ provider: "ASIDE", scopeEvidence: "MACHINE_MATCHED", processedBucket: "few", llmCalls: 0 });
  });

  it("an executor failure is the outcome, and no handoff runs", async () => {
    const ex = executed({ ok: false, workflow: { id: "fixture-review-export", version: 1 }, failure: { code: "AUTH_REQUIRED", stage: "AUTH", recoverable: true }, observed });
    const ho = handoffOf({ ok: true, artifactRef: "x", sha256: "y", bytes: 1, processed: 0, deleted: true });
    const provider = new AsideSegmentExecution({ executor: ex.executor, ingest: async () => ({ ok: true, processed: 0 }), handoff: ho.handoff });
    const outcome = await provider.start(request, ctx).settled();
    expect(outcome).toMatchObject({ ok: false, failure: { code: "AUTH_REQUIRED", stage: "AUTH", recoverable: true } });
    expect(ho.paths).toEqual([]);
    expect(getLogSink().find((e) => e.event === "aside_execution_terminal")?.meta).toMatchObject({ code: "AUTH_REQUIRED", stage: "AUTH", recoverable: true });
  });

  it("a handoff failure after a successful execution is the outcome, with what was observed", async () => {
    const ex = executed({ ok: true, workflow: { id: "fixture-review-export", version: 1 }, hostPath: "/p", suggestedName: "f.xlsx", scopeEvidence: "OPERATOR_CONFIRMED", observed });
    const ho = handoffOf({ ok: false, failure: { code: "INGEST_FAILED", stage: "INGEST", recoverable: false }, sha256: "cd".repeat(32), bytes: 77, deleted: true });
    const provider = new AsideSegmentExecution({ executor: ex.executor, ingest: async () => ({ ok: false, processed: 0 }), handoff: ho.handoff });
    const run = provider.start(request, ctx);
    const outcome = await run.settled();
    expect(run.runStatus()).toBe("FAILED");
    expect(outcome).toMatchObject({ ok: false, failure: { code: "INGEST_FAILED" } });
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.observed?.artifactSha256).toBe("cd".repeat(32));
    expect(outcome.observed?.artifactBytes).toBe(77);
  });

  it("an executor that throws is a RUNTIME_FAULT outcome, never an unhandled rejection", async () => {
    const provider = new AsideSegmentExecution({
      executor: { execute: async () => { throw new Error("boom"); } },
      ingest: async () => ({ ok: true, processed: 0 }),
      handoff: async () => { throw new Error("never"); },
    });
    const outcome = await provider.start(request, ctx).settled();
    expect(outcome).toMatchObject({ ok: false, failure: { code: "RUNTIME_FAULT", stage: "EXECUTOR" } });
  });
});
