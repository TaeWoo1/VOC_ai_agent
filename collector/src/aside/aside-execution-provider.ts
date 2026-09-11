/**
 * **`ASIDE` — the second execution provider: deterministic Aside execution + Runner host-file handoff.**
 *
 * The carrier half of the Aside provider. Given a hostable segment (from `ImportSegmentHost`, through the
 * execution-provider seam), it:
 *
 *   1. asks the executor (`aside-export-executor.ts`) to run the bound workflow — one `aside repl` program,
 *      no model, no login, no CAPTCHA, actions on exactly-one matches only;
 *   2. takes custody of the file the executor reports (`host-file-handoff.ts`): read → SHA-256 → validate →
 *      delete → upload from memory through the INJECTED ingest capability, which is the existing
 *      launch-ref-bound backend endpoint (`ingest-handoff.buildSegmentIngestUpload`) — the same spine the
 *      LOCAL_HELPER run feeds, so parsing, normalization and dedup happen in one place (PD-8);
 *   3. reports one {@link SegmentExecutionOutcome}.
 *
 * The executor never receives the launch ref: the request it gets is the identity-free
 * {@link SegmentExecutionRequest}, and the only thing that knows the ref is the ingest capability the boot
 * built. `aside-execution-provider.test.ts` asserts the executor's input carries no such key.
 *
 * ## Wire (M2)
 *
 * This provider publishes NO `aw_view` frames on the transport yet. The v2 run view is shaped around the guided
 * step plan and its blocker vocabulary does not include the provider-neutral codes (`AUTH_REQUIRED`,
 * `STORE_*`, `PROVIDER_*`); teaching the frontend an Aside run is the M3 "지금 동기화" surface. The run is
 * observable through the host (`activeRun().runStatus()` / `settled()`) and the sanitized log.
 */
import { log } from "../log";
import type { RunStatus } from "../../../contracts/action-window/v2/index";
import type { AwIngestUploadFn } from "../action-window/ingest-handoff";
import type {
  ExecutionObservation,
  HostedSegmentRun,
  SegmentExecutionContext,
  SegmentExecutionOutcome,
  SegmentExecutionProvider,
  SegmentExecutionRequest,
} from "../action-window/initial-import/execution-provider";
import type { ExportExecutionResult } from "./aside-export-executor";
import { handoffHostFile, type HostFileHandoffOpts, type HostFileHandoffResult } from "./host-file-handoff";
import { rowCountBucket } from "../row-count-bucket";

/** The executor surface the provider depends on. `AsideExportExecutor` satisfies it; tests inject fakes. */
export interface ExportExecutorLike {
  execute(request: SegmentExecutionRequest): Promise<ExportExecutionResult>;
}

/** The handoff surface, injectable so the provider is testable without a filesystem. */
export type HostFileHandoffFn = (hostPath: string, opts: HostFileHandoffOpts) => Promise<HostFileHandoffResult>;

export interface AsideExecutionProviderDeps {
  executor: ExportExecutorLike;
  /** The existing launch-ref-bound ingest capability. The provider never builds one and never sees the ref. */
  ingest: AwIngestUploadFn;
  handoff?: HostFileHandoffFn;
  clock?: () => Date;
}

export class AsideSegmentExecution implements SegmentExecutionProvider {
  readonly kind = "ASIDE" as const;
  private readonly deps: AsideExecutionProviderDeps;

  constructor(deps: AsideExecutionProviderDeps) {
    this.deps = deps;
  }

  start(request: SegmentExecutionRequest, _ctx: SegmentExecutionContext): HostedSegmentRun {
    let status: RunStatus = "PREPARING";
    let resolveSettled: (o: SegmentExecutionOutcome) => void = () => {};
    const settled = new Promise<SegmentExecutionOutcome>((resolve) => {
      resolveSettled = resolve;
    });
    const handoff = this.deps.handoff ?? handoffHostFile;
    const clock = this.deps.clock ?? (() => new Date());

    const conclude = (outcome: SegmentExecutionOutcome) => {
      status = outcome.ok ? "COMPLETED" : "FAILED";
      if (outcome.ok) {
        log("aside_execution_completed", {
          provider: "ASIDE",
          workflow: outcome.workflow?.id ?? null,
          workflowVersion: outcome.workflow?.version ?? null,
          scopeEvidence: outcome.scopeEvidence,
          processedBucket: rowCountBucket(outcome.processed),
          durationMs: outcome.observed.durationMs,
          artifactBytes: outcome.observed.artifactBytes ?? null,
          llmCalls: outcome.observed.llmCalls ?? null,
        });
      } else {
        log("aside_execution_terminal", {
          provider: "ASIDE",
          workflow: outcome.workflow?.id ?? null,
          workflowVersion: outcome.workflow?.version ?? null,
          code: outcome.failure.code,
          stage: outcome.failure.stage,
          recoverable: outcome.failure.recoverable,
          durationMs: outcome.observed?.durationMs ?? null,
        });
      }
      resolveSettled(outcome);
    };

    const runId = request.runId;
    log("aside_execution_started", { provider: "ASIDE", channelCode: request.channelCode });
    // Asynchronous from here: the host returns the handle promptly, the run proceeds.
    void (async () => {
      status = "RUNNING";
      let executed: ExportExecutionResult;
      try {
        executed = await this.deps.executor.execute(request);
      } catch {
        conclude({
          ok: false,
          provider: "ASIDE",
          runId,
          workflow: null,
          failure: { code: "RUNTIME_FAULT", stage: "EXECUTOR", recoverable: false },
          observed: null,
        });
        return;
      }
      if (!executed.ok) {
        conclude({ ok: false, provider: "ASIDE", runId, workflow: executed.workflow, failure: executed.failure, observed: executed.observed });
        return;
      }
      status = "PROCESSING";
      const transferStarted = clock();
      const handed = await handoff(executed.hostPath, {
        runId,
        suggestedName: executed.suggestedName,
        scopeEvidence: executed.scopeEvidence,
        upload: this.deps.ingest,
      });
      const completedAt = clock();
      const observed: ExecutionObservation = {
        ...executed.observed,
        completedAt: completedAt.toISOString(),
        durationMs: Math.max(0, completedAt.getTime() - Date.parse(executed.observed.startedAt)),
        ...(handed.sha256 ? { artifactSha256: handed.sha256 } : {}),
        ...(typeof handed.bytes === "number" ? { artifactBytes: handed.bytes } : {}),
      };
      log("aside_handoff", {
        ok: handed.ok,
        deleted: handed.deleted,
        transferMs: Math.max(0, completedAt.getTime() - transferStarted.getTime()),
      });
      if (!handed.ok) {
        conclude({ ok: false, provider: "ASIDE", runId, workflow: executed.workflow, failure: handed.failure, observed });
        return;
      }
      conclude({
        ok: true,
        provider: "ASIDE",
        runId,
        workflow: executed.workflow,
        artifactRef: handed.artifactRef,
        scopeEvidence: executed.scopeEvidence,
        processed: handed.processed,
        observed,
      });
    })();

    let detached = false;
    return {
      runId,
      provider: "ASIDE",
      runStatus: () => status,
      session: () => null,
      detach: () => {
        // A deterministic run cannot be interrupted mid-program (the repl call is bounded by its own ceiling);
        // detaching only stops the host from holding it. The outcome still resolves when the program ends.
        detached = true;
      },
      settled: () => settled,
    };
  }
}
