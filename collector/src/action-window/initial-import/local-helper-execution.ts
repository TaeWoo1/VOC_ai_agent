/**
 * **`LOCAL_HELPER` — the existing guided import run, wrapped behind the execution-provider seam UNCHANGED.**
 *
 * This module is a WRAP, not a rewrite. It does exactly what `ImportSegmentHost` did inline before the seam
 * existed — `assembleImportRun` over the injected `ImportProbeDriver`, then `session.attach()` — in the same
 * order, with the same inputs. The engine, the session, the driver, the launch-ref-bound ingest, the quarantine,
 * the persisted marker and the readiness decorator are all the ones the live proofs ran; none of them know this
 * wrapper exists. The only thing added is a way to READ the run's end as a {@link SegmentExecutionOutcome}, so
 * both providers answer the host in one vocabulary.
 *
 * Behaviour delta for the audited path: 0. The offline suite that pins the choreography (`import-host.test.ts`,
 * `import-session.test.ts`, the guided e2e tests) runs over this wrapper without modification, and
 * `execution-provider.test.ts` asserts the driver sees the identical call sequence with and without an explicit
 * provider.
 */
import type { ImportProbeDriver } from "./import-driver";
import { assembleImportRun, type ImportRunAssembly } from "./import-dispatch";
import type { ImportSegmentEngine } from "./import-engine";
import type { ImportStage } from "./import-stages";
import { IMPORT_TERMINAL_STAGES } from "./import-stages";
import type {
  ExecutionFailure,
  ExecutionStage,
  HostedSegmentRun,
  SegmentExecutionContext,
  SegmentExecutionOutcome,
  SegmentExecutionProvider,
  SegmentExecutionRequest,
} from "./execution-provider";

/** The guided run's own step choreography, projected onto the provider's coarse stage vocabulary. */
export function executionStageOfImportStage(stage: ImportStage): ExecutionStage {
  switch (stage) {
    case "PREPARE_SESSION":
    case "SESSION_BLOCKED":
    case "SURFACE_BLOCKED":
      return "PREPARE";
    case "SHOW_REQUIRED_RANGE":
    case "LOCATE_START":
    case "HIGHLIGHT_START":
    case "WAIT_FOR_START":
    case "LOCATE_END":
    case "HIGHLIGHT_END":
    case "WAIT_FOR_END":
    case "LOCATE_APPLY":
    case "HIGHLIGHT_APPLY":
    case "WAIT_FOR_APPLY":
    case "READ_SCOPE":
    case "SCOPE_BLOCKED":
    case "WAIT_FOR_RANGE_CONFIRM":
      return "SCOPE";
    case "LOCATE_EXPORT":
    case "HIGHLIGHT_EXPORT":
    case "WAIT_FOR_EXPORT":
    case "LOCATE_CONSENT":
    case "HIGHLIGHT_CONSENT":
    case "WAIT_FOR_CONSENT":
      return "EXPORT";
    case "DETECT_DOWNLOAD":
      return "DOWNLOAD";
    case "VALIDATE_ARTIFACT":
      return "VALIDATE";
    case "INGEST":
      return "INGEST";
    default:
      return "EXECUTOR";
  }
}

/** Read the terminal outcome off the engine. Pure over the engine's public getters; called once, at a terminal stage. */
export function outcomeOfEngine(engine: ImportSegmentEngine, runId: string, startedAt: string, completedAt: string): SegmentExecutionOutcome {
  const stage = engine.currentStage();
  const observed = {
    startedAt,
    completedAt,
    durationMs: Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)),
    llmCalls: 0,
  };
  if (stage === "COMPLETED") {
    return {
      ok: true,
      provider: "LOCAL_HELPER",
      runId,
      workflow: null,
      artifactRef: engine.detectedArtifactRef() ?? "",
      scopeEvidence: engine.recordedScopeEvidence() ?? "OPERATOR_CONFIRMED",
      processed: engine.processedCount() ?? 0,
      observed,
    };
  }
  let failure: ExecutionFailure;
  if (stage === "CANCELLED") {
    failure = { code: "CANCELLED", stage: "EXECUTOR", recoverable: true };
  } else {
    const terminal = engine.terminalFailure();
    failure = terminal
      ? { code: terminal.code, stage: executionStageOfImportStage(terminal.stage), recoverable: false }
      : { code: "RUNTIME_FAULT", stage: "EXECUTOR", recoverable: false };
  }
  return { ok: false, provider: "LOCAL_HELPER", runId, workflow: null, failure, observed };
}

export interface LocalHelperExecutionDeps {
  /** The DOM side of the guided run. On the product path, the LIVE driver; no default, exactly as before. */
  driver: ImportProbeDriver;
  /** Wall-clock source for the observation only — the run's own markers stay synthetic. */
  clock?: () => Date;
}

export class LocalHelperSegmentExecution implements SegmentExecutionProvider {
  readonly kind = "LOCAL_HELPER" as const;
  private readonly deps: LocalHelperExecutionDeps;

  constructor(deps: LocalHelperExecutionDeps) {
    this.deps = deps;
  }

  start(request: SegmentExecutionRequest, ctx: SegmentExecutionContext): HostedSegmentRun {
    const now = this.deps.clock ?? (() => new Date());
    const startedAt = now().toISOString();
    let resolveSettled: (o: SegmentExecutionOutcome) => void = () => {};
    const settled = new Promise<SegmentExecutionOutcome>((resolve) => {
      resolveSettled = resolve;
    });
    let concluded = false;
    let assembly: ImportRunAssembly | null = null;
    const conclude = () => {
      if (concluded || !assembly) return;
      if (!IMPORT_TERMINAL_STAGES.includes(assembly.engine.currentStage())) return;
      concluded = true;
      resolveSettled(outcomeOfEngine(assembly.engine, request.runId, startedAt, now().toISOString()));
    };
    // Identical to the pre-seam host: the same assembly call, the same inputs, in the same order.
    assembly = assembleImportRun(ctx.transport, {
      runId: request.runId,
      channelCode: request.channelCode,
      importRef: ctx.importRef,
      required: request.required,
      driver: this.deps.driver,
      ...(ctx.persistDir ? { persistDir: ctx.persistDir } : {}),
      ...(ctx.now ? { now: ctx.now } : {}),
      onStatePublished: conclude,
    });
    const { session, engine } = assembly;
    const detachSession = session.attach();
    let detached = false;
    return {
      runId: request.runId,
      provider: "LOCAL_HELPER",
      runStatus: () => session.runStatus(),
      session: () => session,
      detach: () => {
        if (detached) return;
        detached = true;
        detachSession();
        // A run released before it ended is over as far as the host is concerned. Report it honestly rather
        // than leave a promise that can never resolve.
        if (!concluded && !IMPORT_TERMINAL_STAGES.includes(engine.currentStage())) {
          concluded = true;
          resolveSettled({
            ok: false,
            provider: "LOCAL_HELPER",
            runId: request.runId,
            workflow: null,
            failure: { code: "CANCELLED", stage: "EXECUTOR", recoverable: true },
            observed: null,
          });
        }
      },
      settled: () => settled,
    };
  }
}
