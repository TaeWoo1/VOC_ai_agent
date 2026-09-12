/**
 * **The Runner half of the Coupang WING 리뷰 read over Aside** — build the plan, ship the program, take back
 * a reading or a named failure.
 *
 * The acquisition sibling of `aside-export-executor.ts`, and it reuses that unit's judgement wherever the
 * question is the same: how a CLI that produced no result line is classified, and which failures a run may
 * retry. What it does NOT reuse is the export contract — no file, no host path, no custody, no ingest. This
 * executor's product is a page reading, and the thing that decides what a reading MEANS lives where it
 * already lived (`review-rows.ts`), not here.
 *
 * **The two page scripts are this repository's own, imported.** Nothing in `src/aside/` authors page code;
 * the plan carries `buildWingAuthScript()`, `buildWingIdentityScript()` and `buildReviewRowReadScript()`
 * verbatim, which is what makes "the code the offline suite tests IS the code the browser runs" true on this
 * lane too.
 *
 * Bounded by construction: one tab, one route, three reads, no click, no pager, no second navigation.
 */
import { buildReviewRowReadScript } from "../action-window/coupang-review/review-row-inpage";
import { buildWingAuthScript, buildWingIdentityScript } from "../action-window/coupang-review/wing-identity-inpage";
import type { ExecutionFailure, ExecutionStage } from "../action-window/initial-import/execution-provider";
import { runAsideRepl, type AsideCliOptions } from "./aside-cli";
import { failureOfNoResult } from "./aside-export-executor";
import {
  asideCoupangReviewRuntime,
  type ReviewRuntimePlan,
  type ReviewRuntimeResult,
} from "./coupang-review-runtime";
import {
  COUPANG_REVIEW_READ_WORKFLOW,
  validateCoupangReviewWorkflow,
  type CoupangReviewWorkflow,
} from "./coupang-review-workflow";

/** Mirrors `aside-export-executor`'s preamble, and for the same reason: esbuild `keepNames` under tsx. */
export const REVIEW_RUNTIME_PREAMBLE = "const __name = (target, _value) => target;" as const;

export function buildReviewRuntimePlan(workflow: CoupangReviewWorkflow): ReviewRuntimePlan {
  return {
    entryUrl: workflow.entryUrl,
    identityScript: buildWingIdentityScript(),
    readerScript: buildReviewRowReadScript(),
    authScript: buildWingAuthScript(),
    settleTimeoutMs: workflow.settleTimeoutMs,
  };
}

export function buildReviewRuntimeProgram(plan: ReviewRuntimePlan): string {
  const fn = asideCoupangReviewRuntime.toString();
  return [
    REVIEW_RUNTIME_PREAMBLE,
    `const __plan = ${JSON.stringify(plan)};`,
    `const __run = (${fn});`,
    `const __result = await __run(__plan, { openTab, closeTab });`,
    `console.log("ASIDE_RESULT " + JSON.stringify(__result));`,
  ].join("\n");
}

const RUNTIME_CODES = ["AUTH_REQUIRED", "UNSUPPORTED_STATE", "STORE_UNRESOLVED", "RUNTIME_FAULT"] as const;
const RUNTIME_STAGES = ["PREPARE", "AUTH", "IDENTITY", "READ"] as const;

/**
 * Shape-check what came back. An off-shape answer is `null` — never a success with missing halves, which is
 * the one failure mode that would put an empty reading through the walk as if the store had no reviews.
 */
export function parseReviewRuntimeResult(raw: unknown): ReviewRuntimeResult | null {
  if (raw === null || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r["ok"] === true) {
    if (r["identity"] === undefined || r["rows"] === undefined) return null;
    return { ok: true, identity: r["identity"], rows: r["rows"], elapsedMs: num(r["elapsedMs"]) };
  }
  if (r["ok"] !== false) return null;
  const code = r["code"];
  const stage = r["stage"];
  if (typeof code !== "string" || !(RUNTIME_CODES as readonly string[]).includes(code)) return null;
  if (typeof stage !== "string" || !(RUNTIME_STAGES as readonly string[]).includes(stage)) return null;
  return {
    ok: false,
    code: code as (typeof RUNTIME_CODES)[number],
    stage: stage as (typeof RUNTIME_STAGES)[number],
    elapsedMs: num(r["elapsedMs"]),
  };
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** What one bounded read came to. `identity`/`rows` are raw page output the caller sanitizes immediately. */
export type ReviewExecutionResult =
  | { ok: true; workflow: { id: string; version: number }; identity: unknown; rows: unknown; observed: ReviewExecutionObserved }
  | { ok: false; workflow: { id: string; version: number }; failure: ExecutionFailure; observed: ReviewExecutionObserved };

export interface ReviewExecutionObserved {
  readonly startedAt: string;
  readonly durationMs: number;
  /** Deterministic path ⇒ 0. Measured, not asserted: the CLI is invoked with `repl` and nothing else. */
  readonly llmCalls: number;
}

export interface AsideReviewExecutorDeps {
  workflow?: CoupangReviewWorkflow;
  cli?: AsideCliOptions;
  now?: () => Date;
}

const RECOVERABLE: Partial<Record<string, boolean>> = {
  AUTH_REQUIRED: true,
  STORE_UNRESOLVED: true,
  UNSUPPORTED_STATE: true,
  PROVIDER_UNAVAILABLE: true,
  PROVIDER_TIMEOUT: true,
};

export class AsideCoupangReviewExecutor {
  private readonly workflow: CoupangReviewWorkflow;
  private readonly cli: AsideCliOptions;
  private readonly now: () => Date;

  constructor(deps: AsideReviewExecutorDeps = {}) {
    this.workflow = deps.workflow ?? COUPANG_REVIEW_READ_WORKFLOW;
    const errors = validateCoupangReviewWorkflow(this.workflow);
    if (errors.length > 0) throw new Error(`coupang review workflow invalid: ${errors.join(",")}`);
    this.cli = deps.cli ?? {};
    this.now = deps.now ?? (() => new Date());
  }

  workflowRef(): { id: string; version: number } {
    return { id: this.workflow.id, version: this.workflow.version };
  }

  async execute(): Promise<ReviewExecutionResult> {
    const startedAt = this.now().toISOString();
    const plan = buildReviewRuntimePlan(this.workflow);
    const run = await runAsideRepl(buildReviewRuntimeProgram(plan), this.cli);
    const observed: ReviewExecutionObserved = { startedAt, durationMs: run.elapsedMs, llmCalls: 0 };
    const workflow = this.workflowRef();
    if (run.kind === "NO_RESULT") return { ok: false, workflow, failure: failureOfNoResult(run.reason), observed };
    const parsed = parseReviewRuntimeResult(run.result);
    if (parsed === null) {
      return { ok: false, workflow, failure: { code: "RUNTIME_FAULT", stage: "EXECUTOR", recoverable: false }, observed };
    }
    if (parsed.ok) return { ok: true, workflow, identity: parsed.identity, rows: parsed.rows, observed };
    return {
      ok: false,
      workflow,
      failure: {
        code: parsed.code,
        stage: parsed.stage as ExecutionStage,
        recoverable: RECOVERABLE[parsed.code] === true,
      },
      observed,
    };
  }
}
