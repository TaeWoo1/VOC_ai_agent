/**
 * The execution-provider seam (Aside Acquisition Track M1). Three properties are pinned:
 *  - `LOCAL_HELPER` behind the seam is the pre-seam host: the driver sees the identical call sequence, and the
 *    host's slot semantics are unchanged;
 *  - the host consults an injected provider AFTER the server-resolved entry decision, with an identity-free
 *    request (no ref, no token, no org) and the ref only in the host-owned context;
 *  - a provider with no interactive session still answers the host's one question (is the run over?).
 */
import { describe, expect, it } from "vitest";
import { InitialImportEndpoint } from "../../../src/bridge/initial-import-endpoint";
import { ImportSegmentHost, type ResolvedLaunchScope } from "../../../src/action-window/initial-import/import-host";
import { ImportFixtureDriver } from "../../../src/action-window/initial-import/import-fixture-driver";
import { LocalHelperSegmentExecution, executionStageOfImportStage } from "../../../src/action-window/initial-import/local-helper-execution";
import {
  storeIdentityVerdict,
  type HostedSegmentRun,
  type SegmentExecutionContext,
  type SegmentExecutionOutcome,
  type SegmentExecutionProvider,
  type SegmentExecutionRequest,
} from "../../../src/action-window/initial-import/execution-provider";
import { clearLogSink, getLogSink } from "../../../src/log";
import type { AwClientFrame } from "../../../../contracts/action-window/v2/transport";

const REF_A = "9f2a1c7b4e6d0835";
const REF_B = "1122334455667788";

function scope(overrides: Partial<ResolvedLaunchScope> = {}): ResolvedLaunchScope {
  return {
    kind: "SEGMENT",
    channelCode: "naver",
    accountSlot: "aabbccddeeff00112233abcd",
    requiredStart: "2026-01-01",
    requiredEnd: "2026-01-31",
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

async function settle(host: ImportSegmentHost) {
  for (let i = 0; i < 50; i++) await new Promise((r) => setTimeout(r, 0));
  await host.activeSession()?.whenSettled();
}

/**
 * A deterministic stand-in provider: no session, resolves to a scripted outcome — ASYNCHRONOUSLY, as a real
 * executor does. (A run that is already terminal while the host is still replaying its own START_RUN would be
 * released by that replay; no real provider finishes before its start returns.)
 */
class ScriptedProvider implements SegmentExecutionProvider {
  readonly kind = "ASIDE" as const;
  readonly requests: SegmentExecutionRequest[] = [];
  readonly contexts: SegmentExecutionContext[] = [];
  private readonly outcome: (req: SegmentExecutionRequest) => SegmentExecutionOutcome;
  constructor(outcome: (req: SegmentExecutionRequest) => SegmentExecutionOutcome) {
    this.outcome = outcome;
  }
  start(request: SegmentExecutionRequest, ctx: SegmentExecutionContext): HostedSegmentRun {
    this.requests.push(request);
    this.contexts.push(ctx);
    let status: "RUNNING" | "COMPLETED" | "FAILED" = "RUNNING";
    const settled = new Promise<SegmentExecutionOutcome>((resolve) => {
      setTimeout(() => {
        const outcome = this.outcome(request);
        status = outcome.ok ? "COMPLETED" : "FAILED";
        resolve(outcome);
      }, 0);
    });
    return {
      runId: request.runId,
      provider: "ASIDE",
      runStatus: () => status,
      session: () => null,
      detach: () => {},
      settled: () => settled,
    };
  }
}

describe("execution-provider contract — store identity verdict", () => {
  it("MATCH only on an exact (trimmed) match", () => {
    expect(storeIdentityVerdict("store-42", " store-42 ")).toBe("MATCH");
  });
  it("MISMATCH on a different value", () => {
    expect(storeIdentityVerdict("store-42", "store-43")).toBe("MISMATCH");
  });
  it("UNRESOLVED when either side is missing — never a success", () => {
    expect(storeIdentityVerdict("store-42", null)).toBe("UNRESOLVED");
    expect(storeIdentityVerdict("store-42", "")).toBe("UNRESOLVED");
    expect(storeIdentityVerdict("", "store-42")).toBe("UNRESOLVED");
    expect(storeIdentityVerdict(undefined, undefined)).toBe("UNRESOLVED");
  });
});

describe("LOCAL_HELPER behind the seam — behaviour delta 0", () => {
  it("the driver sees the identical call sequence with and without an explicit provider", async () => {
    const run = async (explicit: boolean) => {
      const endpoint = new InitialImportEndpoint({ runId: "run_announce", channelCode: "naver" });
      const driver = new ImportFixtureDriver();
      const host = new ImportSegmentHost({
        endpoint,
        channelCode: "naver",
        resolveScope: async () => scope(),
        ...(explicit ? { execution: new LocalHelperSegmentExecution({ driver }) } : { driver }),
      });
      host.attach();
      endpoint.replayClientFrame(startRun(REF_A));
      await settle(host);
      return { calls: [...driver.calls], status: host.activeRun()?.runStatus(), provider: host.executionProvider() };
    };
    const implicit = await run(false);
    const explicit = await run(true);
    expect(implicit.provider).toBe("LOCAL_HELPER");
    expect(explicit.provider).toBe("LOCAL_HELPER");
    expect(explicit.calls).toEqual(implicit.calls);
    expect(explicit.status).toBe(implicit.status);
    // The choreography actually happened: the fixture driver walked the guided run to completion.
    expect(implicit.calls[0]).toBe("prepareSurface");
    expect(implicit.calls).toContain("detectDownload");
    expect(implicit.calls[implicit.calls.length - 1]).toBe("cleanup");
  });

  it("reads the guided run's end as a provider outcome — artifact ref, scope evidence, processed count", async () => {
    const endpoint = new InitialImportEndpoint({ runId: "run_announce", channelCode: "naver" });
    const driver = new ImportFixtureDriver({ ingest: { ok: true, processed: 7 } });
    const host = new ImportSegmentHost({ endpoint, channelCode: "naver", resolveScope: async () => scope(), driver });
    host.attach();
    endpoint.replayClientFrame(startRun(REF_A));
    await settle(host);
    const run = host.activeRun();
    expect(run).not.toBeNull();
    expect(run!.provider).toBe("LOCAL_HELPER");
    expect(run!.session()).toBe(host.activeSession());
    const outcome = await run!.settled();
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("unreachable");
    expect(outcome.provider).toBe("LOCAL_HELPER");
    expect(outcome.artifactRef).toMatch(/^[0-9a-f]{16}$/);
    expect(outcome.scopeEvidence).toBe("MACHINE_MATCHED");
    expect(outcome.processed).toBe(7);
    expect(outcome.observed.llmCalls).toBe(0);
  });

  it("a guided run that fails closed is an ok:false outcome carrying the engine's own code", async () => {
    const endpoint = new InitialImportEndpoint({ runId: "run_announce", channelCode: "naver" });
    const driver = new ImportFixtureDriver({ validate: { valid: false } });
    const host = new ImportSegmentHost({ endpoint, channelCode: "naver", resolveScope: async () => scope(), driver });
    host.attach();
    endpoint.replayClientFrame(startRun(REF_A));
    await settle(host);
    const outcome = await host.activeRun()!.settled();
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.failure.code).toBe("ARTIFACT_INVALID");
    expect(outcome.failure.stage).toBe("VALIDATE");
  });

  it("projects every import stage onto the coarse stage vocabulary (no stage falls through to EXECUTOR by accident)", () => {
    expect(executionStageOfImportStage("PREPARE_SESSION")).toBe("PREPARE");
    expect(executionStageOfImportStage("WAIT_FOR_END")).toBe("SCOPE");
    expect(executionStageOfImportStage("WAIT_FOR_CONSENT")).toBe("EXPORT");
    expect(executionStageOfImportStage("DETECT_DOWNLOAD")).toBe("DOWNLOAD");
    expect(executionStageOfImportStage("VALIDATE_ARTIFACT")).toBe("VALIDATE");
    expect(executionStageOfImportStage("INGEST")).toBe("INGEST");
  });

  it("a host needs either a driver or a provider — never neither", () => {
    const endpoint = new InitialImportEndpoint({ runId: "run_announce", channelCode: "naver" });
    expect(() => new ImportSegmentHost({ endpoint, channelCode: "naver", resolveScope: async () => scope() })).toThrow(/driver|provider/);
  });
});

describe("the host with a deterministic provider", () => {
  it("hands an identity-free request and the ref only in the host-owned context; the run has no session", async () => {
    clearLogSink();
    const provider = new ScriptedProvider((req) => ({
      ok: true,
      provider: "ASIDE",
      runId: req.runId,
      workflow: { id: "fixture", version: 1 },
      artifactRef: "0123456789abcdef",
      scopeEvidence: "MACHINE_MATCHED",
      processed: 3,
      observed: { startedAt: "2026-09-12T00:00:00.000Z", completedAt: "2026-09-12T00:00:01.000Z", durationMs: 1000, llmCalls: 0 },
    }));
    const endpoint = new InitialImportEndpoint({ runId: "run_announce", channelCode: "naver" });
    const host = new ImportSegmentHost({ endpoint, channelCode: "naver", resolveScope: async () => scope(), execution: provider });
    host.attach();
    endpoint.replayClientFrame(startRun(REF_A));
    await settle(host);

    expect(host.executionProvider()).toBe("ASIDE");
    expect(provider.requests).toHaveLength(1);
    const request = provider.requests[0]!;
    expect(Object.keys(request).sort()).toEqual(["accountSlot", "channelCode", "required", "runId"]);
    expect(request.runId).toMatch(/^run_[0-9a-f]{12}$/);
    expect(request.accountSlot).toBe("aabbccddeeff00112233abcd");
    expect(request.required).toEqual({ start: "2026-01-01", end: "2026-01-31" });
    expect(JSON.stringify(request)).not.toContain(REF_A);
    expect(provider.contexts[0]!.importRef).toBe(REF_A);

    expect(host.activeSession()).toBeNull();
    expect(host.activeRun()?.runStatus()).toBe("COMPLETED");
    const outcome = await host.activeRun()!.settled();
    expect(outcome.ok && outcome.processed).toBe(3);
    expect(getLogSink().some((e) => e.event === "aw_import_host_execution_provider" && e.meta.provider === "ASIDE")).toBe(true);
    // The pre-existing hosted line is byte-identical.
    expect(getLogSink().find((e) => e.event === "aw_import_host_run_hosted")?.meta).toEqual({ kind: "SEGMENT" });
  });

  it("keeps the host's slot semantics — a COMPLETED run keeps its ref, a FAILED one frees it for a retry", async () => {
    let fail = true;
    const provider = new ScriptedProvider((req) =>
      fail
        ? {
            ok: false,
            provider: "ASIDE",
            runId: req.runId,
            workflow: null,
            failure: { code: "PROVIDER_UNAVAILABLE", stage: "EXECUTOR", recoverable: true },
            observed: null,
          }
        : {
            ok: true,
            provider: "ASIDE",
            runId: req.runId,
            workflow: null,
            artifactRef: "0123456789abcdef",
            scopeEvidence: "OPERATOR_CONFIRMED",
            processed: 0,
            observed: { startedAt: "2026-09-12T00:00:00.000Z", completedAt: "2026-09-12T00:00:01.000Z", durationMs: 1000 },
          },
    );
    const endpoint = new InitialImportEndpoint({ runId: "run_announce", channelCode: "naver" });
    const host = new ImportSegmentHost({ endpoint, channelCode: "naver", resolveScope: async () => scope(), execution: provider });
    host.attach();
    endpoint.replayClientFrame(startRun(REF_A));
    await settle(host);
    expect(host.activeRun()?.runStatus()).toBe("FAILED");
    // Retry with the SAME ref: the failed run's slot is released and a second run is hosted.
    fail = false;
    endpoint.replayClientFrame(startRun(REF_A));
    await settle(host);
    expect(provider.requests).toHaveLength(2);
    expect(host.activeRun()?.runStatus()).toBe("COMPLETED");
    // A completed run keeps its slot: the same ref cannot host a third run (no double ingest).
    endpoint.replayClientFrame(startRun(REF_A));
    await settle(host);
    expect(provider.requests).toHaveLength(2);
    // A different ref is the next segment.
    endpoint.replayClientFrame(startRun(REF_B));
    await settle(host);
    expect(provider.requests).toHaveLength(3);
    expect(provider.requests[2]!.runId).not.toBe(provider.requests[1]!.runId);
  });
});
