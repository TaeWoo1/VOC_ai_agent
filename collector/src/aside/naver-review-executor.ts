/**
 * **The Runner half of the unattended NAVER Seller Center 리뷰 read** — build the plan, ship the program, take back
 * a reading or a named failure. The NAVER sibling of `coupang-review-executor.ts`.
 *
 * The page scripts are this repository's own, imported verbatim: the reader and sign-in check from
 * `review-list-observe-inpage.ts`, and the range census the guided reply lane has read live since 2026-09-05. The
 * census needs the run's KST civil date, which the executor supplies — the browser reduces dates to day offsets, and
 * only the offsets cross back.
 */
import {
  buildNaverReviewAuthScript,
  buildNaverReviewListReadScript,
} from "../naver/review-list-observe-inpage";
import { inPageReviewListRange } from "../action-window/reply-submission/review-list-range-inpage";
import { runAsideRepl, type AsideCliOptions } from "./aside-cli";
import {
  asideNaverReviewRuntime,
  type NaverReviewRuntimePlan,
  type NaverReviewRuntimeResult,
} from "./naver-review-runtime";
import {
  NAVER_REVIEW_READ_WORKFLOW,
  validateNaverReviewWorkflow,
  type NaverReviewWorkflow,
} from "./naver-review-workflow";

export const NAVER_REVIEW_RUNTIME_PREAMBLE = "const __name = (target, _value) => target;" as const;

/** The run's civil date in Asia/Seoul — the calendar the Seller Center period is drawn in. */
export function kstCivilDate(now: Date): { year: number; month: number; day: number } {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return { year: kst.getUTCFullYear(), month: kst.getUTCMonth() + 1, day: kst.getUTCDate() };
}

export function buildNaverReviewRuntimePlan(workflow: NaverReviewWorkflow, now: Date): NaverReviewRuntimePlan {
  return {
    entryUrl: workflow.entryUrl,
    authScript: buildNaverReviewAuthScript(),
    readerScript: buildNaverReviewListReadScript(),
    rangeScript: inPageReviewListRange(kstCivilDate(now)),
    settleTimeoutMs: workflow.settleTimeoutMs,
    pollMs: 1_500,
  };
}

export function buildNaverReviewRuntimeProgram(plan: NaverReviewRuntimePlan): string {
  const fn = asideNaverReviewRuntime.toString();
  return [
    NAVER_REVIEW_RUNTIME_PREAMBLE,
    `const __plan = ${JSON.stringify(plan)};`,
    `const __run = (${fn});`,
    `const __wait = (ms) => new Promise((r) => setTimeout(r, ms));`,
    `const __result = await __run(__plan, { openTab, closeTab, wait: __wait });`,
    `console.log("ASIDE_RESULT " + JSON.stringify(__result));`,
  ].join("\n");
}

const CODES = ["AUTH_REQUIRED", "UNSUPPORTED_STATE", "READ_UNSETTLED", "RUNTIME_FAULT"] as const;
const STAGES = ["PREPARE", "AUTH", "READ", "RANGE"] as const;

/** Shape-check the program's answer. Off-shape is `null` — never a success with a missing half. */
export function parseNaverReviewRuntimeResult(raw: unknown): NaverReviewRuntimeResult | null {
  if (raw === null || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const elapsedMs = typeof r["elapsedMs"] === "number" && Number.isFinite(r["elapsedMs"]) ? r["elapsedMs"] : 0;
  if (r["ok"] === true) {
    if (r["reading"] === undefined || r["range"] === undefined) return null;
    return { ok: true, reading: r["reading"], range: r["range"], elapsedMs };
  }
  if (r["ok"] !== false) return null;
  const code = r["code"];
  const stage = r["stage"];
  if (typeof code !== "string" || !(CODES as readonly string[]).includes(code)) return null;
  if (typeof stage !== "string" || !(STAGES as readonly string[]).includes(stage)) return null;
  const reason = typeof r["reason"] === "string" ? r["reason"] : null;
  return {
    ok: false,
    code: code as (typeof CODES)[number],
    stage: stage as (typeof STAGES)[number],
    reason,
    elapsedMs,
  };
}

export type NaverReviewExecution =
  | { kind: "RESULT"; result: NaverReviewRuntimeResult; llmCalls: 0 }
  | { kind: "UNAVAILABLE"; llmCalls: 0 };

export class AsideNaverReviewExecutor {
  private readonly workflow: NaverReviewWorkflow;
  private readonly cli: AsideCliOptions;
  private readonly now: () => Date;

  constructor(deps: { workflow?: NaverReviewWorkflow; cli?: AsideCliOptions; now?: () => Date } = {}) {
    this.workflow = deps.workflow ?? NAVER_REVIEW_READ_WORKFLOW;
    const errors = validateNaverReviewWorkflow(this.workflow);
    if (errors.length > 0) throw new Error(`naver review workflow invalid: ${errors.join(",")}`);
    this.cli = deps.cli ?? {};
    this.now = deps.now ?? (() => new Date());
  }

  asOf(): Date {
    return this.now();
  }

  async execute(): Promise<NaverReviewExecution> {
    const plan = buildNaverReviewRuntimePlan(this.workflow, this.now());
    const run = await runAsideRepl(buildNaverReviewRuntimeProgram(plan), {
      ...this.cli,
      timeoutMs: this.workflow.settleTimeoutMs + 30_000,
    });
    if (run.kind === "NO_RESULT") return { kind: "UNAVAILABLE", llmCalls: 0 };
    const parsed = parseNaverReviewRuntimeResult(run.result);
    if (parsed === null) {
      return { kind: "RESULT", result: { ok: false, code: "RUNTIME_FAULT", stage: "READ", reason: null, elapsedMs: run.elapsedMs }, llmCalls: 0 };
    }
    return { kind: "RESULT", result: parsed, llmCalls: 0 };
  }
}
