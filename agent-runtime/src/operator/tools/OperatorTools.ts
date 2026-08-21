/**
 * The Operator's tool catalogue: every capability it may choose, with the action class it declares.
 *
 * <b>Read the WRITE row first — there isn't one.</b> `ActionClass` names three classes and this file
 * defines tools in two. That is the v1 decision made structural: the Operator cannot send a reply,
 * edit an FAQ or change a product page because no such tool exists for it to select, not because a
 * flag is off. {@link OperatorToolRegistry} refuses a WRITE tool at construction, and
 * `operatorToolRegistry.test.ts` asserts the catalogue is free of one.
 *
 * <b>What is deliberately NOT here, though it exists elsewhere in the runtime:</b>
 * `prepare_guided_reply_session` (mints a single-use guided submission ref — the entrance to a human's
 * marketplace action), every credential handoff, every Action Window command, and every collection
 * trigger. The Operator picks its own tools, so anything in this catalogue is something it can decide
 * to do unattended; the privileged plane stays where a person drives it.
 */
import { z } from "zod";
import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { ActionClass } from "../state/OperatorState";
import type { OperatorSpringClient } from "../../spring/OperatorSpringClient";
import type { SpringClient } from "../../spring/SpringClient";
import type { IssueSpringClient } from "../../spring/IssueSpringClient";

/** Tool names, as one closed table. A plan naming anything else is refused before it runs. */
export const OPERATOR_TOOL = {
  GET_TODAY_INBOX: "get_today_inbox",
  SEARCH_REVIEW_ISSUES: "search_review_issues",
  GET_ISSUE_TREND: "get_review_issue_trend",
  GET_ISSUE_EVIDENCE_SUMMARY: "get_review_issue_evidence_summary",
  SEARCH_UNANSWERED_INQUIRIES: "search_unanswered_inquiries",
  GET_INQUIRY_DETAIL: "get_inquiry_detail",
  RESOLVE_PRODUCT: "resolve_product",
  GET_PRODUCT_SIGNALS: "get_product_signals",
  SEARCH_CUSTOMER_MEMORY: "search_customer_memory",
  LIST_REPEATED_INQUIRIES: "list_repeated_inquiries",
  LIST_ITEM_ANALYSIS: "list_item_analysis",
  GET_DASHBOARD_PRODUCT_ISSUES: "get_dashboard_product_issues",
  GET_PRODUCT_KNOWLEDGE: "get_product_knowledge",
  SEARCH_PRODUCT_FACTS: "search_product_facts",
  GET_INQUIRY_CONTEXT: "get_inquiry_thread_context",
} as const;

export type OperatorToolName = (typeof OPERATOR_TOOL)[keyof typeof OPERATOR_TOOL];

/** A tool plus the class it declares. The class is a value, not a comment, so it can be enforced. */
export interface ClassifiedTool {
  readonly actionClass: ActionClass;
  readonly tool: StructuredToolInterface;
}

export interface OperatorToolDeps {
  readonly operator: OperatorSpringClient;
  readonly inquiry: SpringClient;
  readonly issue: IssueSpringClient;
}

/**
 * Build the catalogue. Every entry is READ.
 *
 * The descriptions are what a planner sees, so they say what the tool ANSWERS rather than what it
 * calls: a planner choosing between "오늘 확인할 일의 총계" and "반복되는 고객 질문" is making a product
 * decision, and a description that named an endpoint would be asking it to make a routing one.
 */
export function buildOperatorTools(deps: OperatorToolDeps): ClassifiedTool[] {
  const read = (t: StructuredToolInterface): ClassifiedTool => ({ actionClass: "READ", tool: t });

  return [
    read(tool(async () => deps.operator.getInbox(1), {
      name: OPERATOR_TOOL.GET_TODAY_INBOX,
      description:
        "오늘 확인할 일의 총계 — 서버가 센 미답변 문의 수(페이지 상한 없음). '오늘 뭐부터 봐야 해' 류 "
        + "질문의 출발점. 필요한 정보: INQUIRY_VOLUME.",
      schema: z.object({}),
    })),

    read(tool(async ({ referenceDate }: { referenceDate?: string }) =>
      deps.issue.searchReviewIssues({ referenceDate, dismissed: false }), {
      name: OPERATOR_TOOL.SEARCH_REVIEW_ISSUES,
      description:
        "반복되는 고객 문제 목록, 심각한 것부터. 각 행은 닫힌 어휘의 신호(심각도·추세·근거 수·대표 상품)"
        + "이며 리뷰 원문은 없다. 필요한 정보: REVIEW_SIGNAL.",
      schema: z.object({ referenceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }),
    })),

    read(tool(async ({ issueId, referenceDate }: { issueId: string; referenceDate?: string }) =>
      deps.issue.getIssueTrend(issueId, referenceDate), {
      name: OPERATOR_TOOL.GET_ISSUE_TREND,
      description:
        "한 이슈의 현재 신호 — 심각도, 증가/계속/개선 판정과 그 수치. 리뷰 원문 없음. 필요한 정보: REVIEW_SIGNAL.",
      schema: z.object({
        issueId: z.string().min(1),
        referenceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      }),
    })),

    read(tool(async ({ issueId }: { issueId: string }) => deps.issue.getIssueEvidenceSummary(issueId), {
      name: OPERATOR_TOOL.GET_ISSUE_EVIDENCE_SUMMARY,
      description:
        "한 이슈의 근거 집계 — 총계, 상품별 분포(귀속 불가 건수는 따로), 별점 분포, 기간. 리뷰 id도 인용도 없음.",
      schema: z.object({ issueId: z.string().min(1) }),
    })),

    read(tool(async ({ page, size }: { page?: number; size?: number }) =>
      deps.inquiry.listInquiries({ phase: "OPEN", page, size }), {
      name: OPERATOR_TOOL.SEARCH_UNANSWERED_INQUIRIES,
      description:
        "답변이 필요한 문의 한 페이지(오래된 순 우선순위는 호출자가 매긴다). 필요한 정보: INQUIRY_VOLUME.",
      schema: z.object({
        page: z.number().int().min(0).optional(),
        size: z.number().int().min(1).max(100).optional(),
      }),
    })),

    read(tool(async ({ workItemId }: { workItemId: string }) => deps.inquiry.getInquiryDetail(workItemId), {
      name: OPERATOR_TOOL.GET_INQUIRY_DETAIL,
      description: "문의 하나의 상세. 판매자 소유 원문을 포함하므로 초안 작성 외의 목적으로 부르지 말 것.",
      schema: z.object({ workItemId: z.string().min(1) }),
    })),

    read(tool(async ({ query, limit }: { query: string; limit?: number }) =>
      deps.operator.searchProducts(query, limit), {
      name: OPERATOR_TOOL.RESOLVE_PRODUCT,
      description:
        "판매자가 말한 상품 이름/SKU를 실제 상품 행으로 해석한다. 후보를 여러 개 줄 수 있다. "
        + "상품에 관한 어떤 조회보다 먼저 필요하다 — 계획은 id 를 만들 수 없고 이 도구만 id 를 만든다.",
      schema: z.object({ query: z.string().min(1), limit: z.number().int().min(1).max(10).optional() }),
    })),

    read(tool(async ({ productId, referenceDate }: { productId: string; referenceDate?: string }) =>
      deps.operator.getProductSignals(productId, referenceDate), {
      name: OPERATOR_TOOL.GET_PRODUCT_SIGNALS,
      description:
        "한 상품에 무슨 일이 일어나고 있는지 — 반복 이슈·추세·분석 추천·문의량, 그리고 각 소스가 이 상품에 "
        + "대해 판단 가능한지(coverage). coverage가 COVERED가 아니면 비어 있음은 '문제 없음'이 아니라 "
        + "'판단 불가'다. 상품이 무엇인지(규격·가격·옵션)는 get_product_knowledge 가 답한다. "
        + "필요한 정보: REVIEW_SIGNAL, INQUIRY_VOLUME.",
      schema: z.object({
        productId: z.string().min(1),
        referenceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      }),
    })),

    read(tool(async (args: { inquiryId?: string; signatureKey?: string; topic?: string; limit?: number }) =>
      deps.operator.searchCustomerMemory(args), {
      name: OPERATOR_TOOL.SEARCH_CUSTOMER_MEMORY,
      description:
        "과거에 같은 문제를 본 적이 있는지, 그때 승인된 답변이 무엇이었는지. inquiryId를 주면 그 문의의 "
        + "색인된 단서로 조회한다(고객 원문은 조회 조건으로도 쓰이지 않는다). 필요한 정보: CUSTOMER_HISTORY.",
      schema: z.object({
        inquiryId: z.string().min(1).optional(),
        signatureKey: z.string().min(1).optional(),
        topic: z.string().min(1).optional(),
        limit: z.number().int().min(1).max(10).optional(),
      }),
    })),

    read(tool(async ({ referenceDate, windowDays }: { referenceDate?: string; windowDays?: number }) =>
      deps.operator.listRepeatedInquiries(referenceDate, windowDays), {
      name: OPERATOR_TOOL.LIST_REPEATED_INQUIRIES,
      description: "기간 안에서 반복된 고객 질문 후보. 진단이 아니라 확인할 후보다. 필요한 정보: REPEAT_PATTERN.",
      schema: z.object({
        referenceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        windowDays: z.number().int().min(1).max(365).optional(),
      }),
    })),

    read(tool(async () => deps.operator.listItemAnalyses(), {
      name: OPERATOR_TOOL.LIST_ITEM_ANALYSIS,
      description:
        "저장된 문의·리뷰 분석 행 — FAQ 후보·상세페이지 보완 후보의 출처. 필요한 정보: REPEAT_PATTERN.",
      schema: z.object({}),
    })),

    read(tool(async () => deps.operator.getDashboardSummary(), {
      name: OPERATOR_TOOL.GET_DASHBOARD_PRODUCT_ISSUES,
      description: "상품별 이슈 집계(상위) — 어느 상품에 문제가 몰려 있는지. 필요한 정보: REPEAT_PATTERN.",
      schema: z.object({}),
    })),

    read(tool(async ({ productId, referenceDate }: { productId: string; referenceDate?: string }) =>
      deps.operator.getProductKnowledge(productId, referenceDate), {
      name: OPERATOR_TOOL.GET_PRODUCT_KNOWLEDGE,
      description:
        "이 상품이 무엇인지 — 채널별 리스팅(이름·가격·판매상태·URL), 옵션, 상세/스펙 사실, 그리고 각 항목을 "
        + "우리가 실제로 갖고 있는지(coverage: AVAILABLE/PARTIAL/UNAVAILABLE/STALE). UNAVAILABLE은 "
        + "'그런 사실이 없다'가 아니라 '우리가 갖고 있지 않다'는 뜻이다. "
        + "필요한 정보: PRODUCT_LISTING, PRODUCT_VARIANT.",
      schema: z.object({
        productId: z.string().min(1),
        referenceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      }),
    })),

    read(tool(async ({ productId, factKeys }: { productId: string; factKeys?: string[] }) =>
      deps.operator.searchProductFacts(productId, factKeys ?? []), {
      name: OPERATOR_TOOL.SEARCH_PRODUCT_FACTS,
      description:
        "이 상품에 대해 판매자/채널이 실제로 명시한 사실 몇 가지만 — 규격·용량·길이·원산지·브랜드 등. "
        + "값마다 출처(source)와 관측 시각(observedAt)이 함께 온다. 없으면 빈 목록이며, 추론하지 않는다. "
        + "'폭이 몇 mm인가요' 류 질문의 출발점. 필요한 정보: PRODUCT_FACT.",
      schema: z.object({
        productId: z.string().min(1),
        // Bare names are accepted ("길이") as well as full keys ("spec:길이") — a need is phrased in
        // the seller's words, and making it depend on a storage namespace would answer "정보 없음"
        // for a spelling difference.
        factKeys: z.array(z.string().min(1)).max(10).optional(),
      }),
    })),

    read(tool(async ({ workItemId }: { workItemId: string }) =>
      deps.operator.getInquiryThreadContext(workItemId), {
      name: OPERATOR_TOOL.GET_INQUIRY_CONTEXT,
      description:
        "문의 한 건의 맥락 — 채널, 연결된 상품, 상태, 과거 대응이 있는지. **고객 원문은 없다.** "
        + "무엇을 더 조사할지 정할 때 원문을 열지 않고 판단하기 위한 도구. "
        + "필요한 정보: CUSTOMER_HISTORY.",
      schema: z.object({ workItemId: z.string().min(1) }),
    })),
  ];
}

/** The catalogue lines a planner is shown: name and one-line purpose. No endpoint, no seller data. */
export function toolCatalogueFor(tools: readonly ClassifiedTool[]): string[] {
  return tools.map((t) => `${t.tool.name}: ${t.tool.description}`);
}
