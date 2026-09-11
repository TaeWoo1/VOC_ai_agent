/**
 * **The Aside export executor — one workflow, one request, one `aside repl` call, one file on the host.**
 *
 * This is the "bounded export execution primitive" of the Aside provider: it turns an {@link ExportWorkflow}
 * plus an identity-free {@link SegmentExecutionRequest} into the program `export-runtime.ts` runs inside
 * Aside, sends it through `aside-cli.ts` (the `repl` invocation and nothing else), and maps what comes back
 * to an {@link ExportExecutionResult}. It never sees a launch ref, never uploads anything, and never reads the
 * downloaded file — that is `host-file-handoff.ts`, on the other side of the provider.
 *
 * The program text is built from data: the serialized runtime function plus a JSON plan. There is no string
 * concatenation of selectors into JavaScript — they travel inside `JSON.stringify(plan)`, so a selector cannot
 * become code.
 */
import type {
  ExecutionFailure,
  ExecutionFailureCode,
  ExecutionObservation,
  ExecutionStage,
  ExecutionWorkflowRef,
  SegmentExecutionRequest,
} from "../action-window/initial-import/execution-provider";
import { readAsideCliVersion, runAsideRepl, type AsideCliOptions, type AsideNoResultKind } from "./aside-cli";
import { asideExportRuntime, type ExportRuntimePlan, type ExportRuntimeResult } from "./export-runtime";
import { resolveStepValue, validateExportWorkflow, type ExportWorkflow } from "./export-workflow";

export type ExportExecutionResult =
  | {
      ok: true;
      workflow: ExecutionWorkflowRef;
      /** Host filesystem path of the completed download. Consumed in-process by the Runner; never logged. */
      hostPath: string;
      /** The browser's suggested filename. Read once for its extension category; never logged. */
      suggestedName: string;
      scopeEvidence: "MACHINE_MATCHED" | "OPERATOR_CONFIRMED";
      observed: ExecutionObservation;
    }
  | { ok: false; workflow: ExecutionWorkflowRef; failure: ExecutionFailure; observed: ExecutionObservation };

export interface AsideExportExecutorDeps {
  workflow: ExportWorkflow;
  /**
   * The store identity this run expects — bound from server-owned facts by the caller. `null` means the caller
   * has no expectation, and the run therefore cannot succeed (the runtime reports `STORE_UNRESOLVED`): an
   * expectation that is missing is not an expectation that matches.
   */
  expectedIdentity: (request: SegmentExecutionRequest) => string | null;
  cli?: AsideCliOptions;
  /** Wall-clock for the observation. */
  clock?: () => Date;
}

/** Build the plan the runtime executes. Pure. The launch ref is not an input, so it cannot be in the output. */
export function buildRuntimePlan(workflow: ExportWorkflow, request: SegmentExecutionRequest, expected: string | null): ExportRuntimePlan {
  return {
    entryUrl: workflow.entryUrl,
    authSignals: [...workflow.authSignals],
    identity: {
      selector: workflow.identity.selector,
      read: workflow.identity.read,
      ...(workflow.identity.attribute !== undefined ? { attribute: workflow.identity.attribute } : {}),
      expected: expected ?? "",
    },
    steps: workflow.steps.map((s) => ({
      kind: s.kind,
      selector: s.selector,
      stage: s.stage,
      ...(s.value !== undefined ? { value: resolveStepValue(s.value, request.required) } : {}),
    })),
    scopeReadback: workflow.scopeReadback ? { ...workflow.scopeReadback } : null,
    required: { start: request.required.start, end: request.required.end },
    exportSelector: workflow.exportSelector,
    downloadTimeoutMs: workflow.downloadTimeoutMs,
    stepTimeoutMs: workflow.stepTimeoutMs,
  };
}

/**
 * The one line that precedes the serialized runtime.
 *
 * The TypeScript→JavaScript transform this package runs under (esbuild, `keepNames`) annotates inner functions
 * with an `__name(fn, "fn")` helper call that returns its first argument. The serialized text therefore
 * references exactly one free identifier, `__name`, which exists in the compiled module but not in Aside's
 * repl. This shim gives it the same meaning there. `aside-guard.test.ts` evaluates the program with ONLY this
 * preamble in scope, so any other free reference fails the suite.
 */
export const RUNTIME_PREAMBLE = "const __name = (target, _value) => target;" as const;

/**
 * The program text. The runtime function is serialized from its compiled source and applied to the JSON plan
 * and Aside's two tab primitives; its answer is printed under the result prefix.
 */
export function buildRuntimeProgram(plan: ExportRuntimePlan): string {
  const fn = asideExportRuntime.toString();
  return [
    RUNTIME_PREAMBLE,
    `const __plan = ${JSON.stringify(plan)};`,
    `const __run = (${fn});`,
    `const __result = await __run(__plan, { openTab, closeTab });`,
    `console.log("ASIDE_RESULT " + JSON.stringify(__result));`,
  ].join("\n");
}

const RECOVERABLE: Partial<Record<ExecutionFailureCode, boolean>> = {
  AUTH_REQUIRED: true,
  PROVIDER_UNAVAILABLE: true,
  PROVIDER_TIMEOUT: true,
};

function failureOf(code: ExecutionFailureCode, stage: ExecutionStage): ExecutionFailure {
  return { code, stage, recoverable: RECOVERABLE[code] ?? false };
}

/** Map a no-result classification to the provider taxonomy. */
export function failureOfNoResult(reason: AsideNoResultKind): ExecutionFailure {
  switch (reason) {
    case "UNAVAILABLE":
      return failureOf("PROVIDER_UNAVAILABLE", "EXECUTOR");
    case "REFUSED":
      return failureOf("PROVIDER_REFUSED", "EXECUTOR");
    case "TIMEOUT":
      return failureOf("PROVIDER_TIMEOUT", "EXECUTOR");
    default:
      return failureOf("RUNTIME_FAULT", "EXECUTOR");
  }
}

const RUNTIME_FAIL_CODES: readonly string[] = [
  "UNSUPPORTED_STATE",
  "AUTH_REQUIRED",
  "STORE_UNRESOLVED",
  "STORE_MISMATCH",
  "TARGET_NOT_FOUND",
  "TARGET_AMBIGUOUS",
  "SCOPE_UNREADABLE",
  "SCOPE_MISMATCH",
  "DOWNLOAD_TIMEOUT",
  "RUNTIME_FAULT",
];
const RUNTIME_STAGES: readonly string[] = ["PREPARE", "AUTH", "IDENTITY", "NAVIGATE", "SCOPE", "EXPORT", "DOWNLOAD", "EXECUTOR"];

/** Pure: validate the untrusted JSON the program printed. Anything off-shape is a runtime fault, not a success. */
export function parseRuntimeResult(raw: unknown): ExportRuntimeResult | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const elapsedMs = typeof r.elapsedMs === "number" && Number.isFinite(r.elapsedMs) ? r.elapsedMs : 0;
  if (r.ok === true) {
    if (typeof r.hostPath !== "string" || r.hostPath.length === 0) return null;
    if (r.identity !== "MATCH") return null;
    if (r.scopeEvidence !== "MACHINE_MATCHED" && r.scopeEvidence !== "OPERATOR_CONFIRMED") return null;
    return {
      ok: true,
      hostPath: r.hostPath,
      suggestedName: typeof r.suggestedName === "string" ? r.suggestedName : "",
      identity: "MATCH",
      scopeEvidence: r.scopeEvidence,
      elapsedMs,
    };
  }
  if (r.ok === false) {
    if (typeof r.code !== "string" || !RUNTIME_FAIL_CODES.includes(r.code)) return null;
    if (typeof r.stage !== "string" || !RUNTIME_STAGES.includes(r.stage)) return null;
    const out: Extract<ExportRuntimeResult, { ok: false }> = {
      ok: false,
      code: r.code as Extract<ExportRuntimeResult, { ok: false }>["code"],
      stage: r.stage as Extract<ExportRuntimeResult, { ok: false }>["stage"],
      elapsedMs,
    };
    if (typeof r.candidates === "number") out.candidates = r.candidates;
    return out;
  }
  return null;
}

export class AsideExportExecutor {
  private readonly deps: AsideExportExecutorDeps;
  private version: Promise<string | null> | null = null;

  constructor(deps: AsideExportExecutorDeps) {
    const errors = validateExportWorkflow(deps.workflow);
    if (errors.length > 0) {
      // Fail closed at construction: a malformed workflow is a wiring bug, not something to discover on a run.
      throw new Error(`aside-export-executor: workflow invalid (${errors.join(", ")})`);
    }
    this.deps = deps;
  }

  private cliVersion(): Promise<string | null> {
    if (!this.version) this.version = readAsideCliVersion(this.deps.cli ?? {});
    return this.version;
  }

  async execute(request: SegmentExecutionRequest): Promise<ExportExecutionResult> {
    const clock = this.deps.clock ?? (() => new Date());
    const startedAt = clock();
    const workflow = this.deps.workflow.ref;
    const observe = (extra: Partial<ExecutionObservation> = {}): ExecutionObservation => {
      const completedAt = clock();
      return {
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        durationMs: Math.max(0, completedAt.getTime() - startedAt.getTime()),
        llmCalls: 0,
        ...extra,
      };
    };
    const version = await this.cliVersion();
    const versionTag = version ? { executorVersion: version } : {};
    const plan = buildRuntimePlan(this.deps.workflow, request, this.deps.expectedIdentity(request));
    const program = buildRuntimeProgram(plan);
    const run = await runAsideRepl(program, this.deps.cli ?? {});
    if (run.kind === "NO_RESULT") {
      return { ok: false, workflow, failure: failureOfNoResult(run.reason), observed: observe(versionTag) };
    }
    const result = parseRuntimeResult(run.result);
    if (result === null) {
      return { ok: false, workflow, failure: failureOf("RUNTIME_FAULT", "EXECUTOR"), observed: observe(versionTag) };
    }
    if (!result.ok) {
      const stage: ExecutionStage = result.stage;
      return {
        ok: false,
        workflow,
        failure: failureOf(result.code, stage),
        observed: observe({ ...versionTag, ...(result.code.startsWith("STORE_") ? { identity: result.code === "STORE_MISMATCH" ? "MISMATCH" : "UNRESOLVED" } : {}) }),
      };
    }
    return {
      ok: true,
      workflow,
      hostPath: result.hostPath,
      suggestedName: result.suggestedName,
      scopeEvidence: result.scopeEvidence,
      observed: observe({ ...versionTag, identity: "MATCH" }),
    };
  }
}
