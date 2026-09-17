/**
 * **The Runner half of the unattended NAVER Seller Center 상품 문의 read** — build the plan, ship the program, take back
 * a reading or a named failure.
 *
 * It ships the SAME frozen runtime the review recipe runs (`naver-review-runtime.ts`: open the plan's one URL, wait,
 * evaluate the plan's scripts, close the tab) with a different plan. No new runtime and no new evaluate forwarder
 * exist for this recipe — the only things that differ are the route, screened here before anything is built, and the
 * page scripts, authored and tested in `src/naver/product-inquiry-list-observe-inpage.ts`.
 */
import { buildNaverReviewAuthScript } from "../naver/review-list-observe-inpage";
import {
  buildNaverProductInquiryListReadScript,
  buildNaverProductInquiryWindowScript,
} from "../naver/product-inquiry-list-observe-inpage";
import { runAsideRepl, type AsideCliOptions } from "./aside-cli";
import type { NaverReviewRuntimePlan } from "./naver-review-runtime";
import {
  buildNaverReviewRuntimeProgram,
  parseNaverReviewRuntimeResult,
  type NaverReviewExecution,
} from "./naver-review-executor";
import {
  NAVER_PRODUCT_INQUIRY_READ_WORKFLOW,
  validateNaverProductInquiryWorkflow,
  type NaverProductInquiryWorkflow,
} from "./naver-product-inquiry-workflow";

export function buildNaverProductInquiryRuntimePlan(workflow: NaverProductInquiryWorkflow): NaverReviewRuntimePlan {
  if (validateNaverProductInquiryWorkflow(workflow).length > 0) {
    throw new Error("naver product inquiry workflow invalid");
  }
  return {
    entryUrl: workflow.entryUrl,
    // The sign-in check is the review recipe's, unchanged: same host, same wall.
    authScript: buildNaverReviewAuthScript(),
    readerScript: buildNaverProductInquiryListReadScript(),
    rangeScript: buildNaverProductInquiryWindowScript(),
    settleTimeoutMs: workflow.settleTimeoutMs,
    pollMs: 1_500,
  };
}

export class AsideNaverProductInquiryExecutor {
  private readonly workflow: NaverProductInquiryWorkflow;
  private readonly cli: AsideCliOptions;
  private readonly now: () => Date;

  constructor(deps: { workflow?: NaverProductInquiryWorkflow; cli?: AsideCliOptions; now?: () => Date } = {}) {
    this.workflow = deps.workflow ?? NAVER_PRODUCT_INQUIRY_READ_WORKFLOW;
    const errors = validateNaverProductInquiryWorkflow(this.workflow);
    if (errors.length > 0) throw new Error(`naver product inquiry workflow invalid: ${errors.join(",")}`);
    this.cli = deps.cli ?? {};
    this.now = deps.now ?? (() => new Date());
  }

  asOf(): Date {
    return this.now();
  }

  async execute(): Promise<NaverReviewExecution> {
    const plan = buildNaverProductInquiryRuntimePlan(this.workflow);
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
