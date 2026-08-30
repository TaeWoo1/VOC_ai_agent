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
import type {
  AnswerMemorySearchResult,
  ChannelCapabilityOverview, ChannelCoverageRow, DashboardOverview, InquiryReplyTransportRow, OrderSummaryResponse,
  OrgKnowledgeSearchResult, SellerProfileView, PublishCapabilityView, RecentReviewsResponse, ReviewChannelCapabilityView, SellerAccountSummary,
} from "../../spring/types";
import { listInquiryWorkload, WORKLOAD_DETAIL_CAP } from "./inquiryWorkload";

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
  SEARCH_CHANNEL_KNOWLEDGE: "search_channel_knowledge",
  GET_CHANNEL_CAPABILITY: "get_channel_capability",
  GET_CONNECTION_GUIDANCE: "get_connection_guidance",
  GET_CHANNEL_COVERAGE: "get_channel_coverage",
  SEARCH_PRODUCT_KNOWLEDGE: "search_product_knowledge",
  /* Agentic Operating Workspace v2 (2026-08-27). READ, like everything above. */
  LIST_RECENT_REVIEWS: "list_recent_reviews",
  GET_SALES_TREND: "get_sales_trend",
  LIST_INQUIRY_WORKLOAD: "list_inquiry_workload",
  /* Query Accuracy v1 (2026-08-28). READ: the customer's inquiries as rows, every axis a closed token. */
  LIST_INQUIRY_ROWS: "list_inquiry_rows",
  /* Channel-capability completion (2026-08-28). READ: four existing capability reads, one answer. */
  GET_CHANNEL_EXECUTION_CAPABILITY: "get_channel_execution_capability",
  /* Knowledge Context v1-A (2026-08-29). READ: the company's own operating rules, on the turn that needs them. */
  SEARCH_ORG_KNOWLEDGE: "search_org_knowledge",
  SEARCH_ANSWER_MEMORY: "search_answer_memory",
  /* Seller Context v1-B (2026-08-30). READ: who this company is, in the seller's words, on the turn that asks. */
  GET_SELLER_PROFILE: "get_seller_profile",
} as const;

/**
 * What `get_channel_execution_capability` answers: the SOURCES the pure resolver
 * (`capability/ChannelCapability.ts`) reads. The verdict is computed by the caller, which also holds
 * the one input a tool cannot read — whether a local agent is paired — so the same read serves both
 * the review rows path and the conversation's execution routing.
 */
export interface ChannelCapabilityRead {
  readonly channelCode: string;
  readonly overview: ChannelCapabilityOverview | null;
  readonly transports: InquiryReplyTransportRow[] | null;
  readonly publish: PublishCapabilityView | null;
  readonly reviewChannel: ReviewChannelCapabilityView | null;
  /** The API-mode seller account this channel's capability was read for, when one exists. */
  readonly accountId: string | null;
}

/** What `list_recent_reviews` answers: the backend's rows + coverage, plus the accounts a human step would need. */
export interface RecentReviewsRead extends RecentReviewsResponse {
  /**
   * Seller accounts per channel code — resolved ONLY when a coverage row says freshness is in doubt,
   * because that is the only case an answer needs an account id (to name the one-press collection or
   * the manual route). Two extra READs, bought when they can matter and not otherwise.
   */
  readonly accounts: ReadonlyArray<{ channelCode: string; accountId: string; fileUpload: boolean }>;
}

/** What `get_sales_trend` answers: the org overview for N days and, when a channel was named, its own trend. */
export interface SalesTrendRead {
  readonly days: number;
  readonly overview: DashboardOverview;
  readonly channel: { channelCode: string; channelId: string; summary: OrderSummaryResponse } | null;
}

function freshnessInDoubt(rows: readonly ChannelCoverageRow[]): boolean {
  return rows.some((r) => r.dataType === "REVIEW"
    && (r.state === "OBSERVED_FRESHNESS_UNPROVEN" || r.state === "ZERO"
      // A connected channel with no API pull (NAVER export, Coupang WING read) is current only for
      // the window its last seller-run step covered — the rows path decides, and needs the account.
      || (r.state === "NOT_SUPPORTED" && r.connected)));
}

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

    read(tool(async (args: { inquiryId?: string; signatureKey?: string; topic?: string; productId?: string; limit?: number }) =>
      deps.operator.searchCustomerMemory(args), {
      name: OPERATOR_TOOL.SEARCH_CUSTOMER_MEMORY,
      description:
        "과거에 같은 문제(문의·리뷰의 유형 기록)를 본 적이 있는지. 답변 본문은 이 도구에 없다 — 예전에 보낸 답변은 "
        + "search_answer_memory 다. inquiryId를 주면 그 문의의 색인된 단서로 조회한다(고객 원문은 조회 조건으로도 "
        + "쓰이지 않는다). 필요한 정보: CUSTOMER_HISTORY.",
      schema: z.object({
        inquiryId: z.string().min(1).optional(),
        signatureKey: z.string().min(1).optional(),
        topic: z.string().min(1).optional(),
        // The anchor the endpoint has always accepted and this schema never admitted — zod stripped it
        // and the backend's correct refusal of an anchorless search followed (Agentic Operating Workspace v2).
        productId: z.string().min(1).optional(),
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
      description:
        "상품별 부정 리뷰 수(전체 기간, 부정 리뷰가 많은 상위 5개 상품). 각 행은 canonical 상품 id와 "
        + "그 상품 부정 리뷰의 첫/마지막 날짜를 함께 준다. 반복 리뷰 문제의 '근거 건수'와는 다른 집계다 "
        + "— 이것은 리뷰 자체의 수다. 필요한 정보: REVIEW_SIGNAL.",
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

    read(tool(async ({ productId, query, limit }: { productId: string; query: string; limit?: number }) =>
      deps.operator.searchProductKnowledge(productId, query, limit), {
      name: OPERATOR_TOOL.SEARCH_PRODUCT_KNOWLEDGE,
      description:
        "판매자가 이 상품에 대해 직접 써 둔 글(상품 설명·FAQ·사용법·정책) 중 질문에 해당하는 대목만. "
        + "get_product_knowledge 는 '채널이 말한 사실'을 주고, 이 도구는 '판매자가 쓴 문장'을 준다 "
        + "— 출처가 다르므로 절대 같은 근거로 취급하지 않는다. "
        + "passages 가 비어 있고 documentsSearched 가 0이면 '판매자가 아직 아무것도 쓰지 않았다'이고, "
        + "documentsSearched 가 0보다 큰데 비어 있으면 '쓴 글에 그 내용이 없다'이다 — 둘 다 "
        + "'이 상품에 그런 것이 없다'가 아니다. 여기 없는 내용은 지어내지 말고 없다고 말한다. "
        + "필요한 정보: PRODUCT_KNOWLEDGE_DOC.",
      schema: z.object({
        productId: z.string().min(1),
        query: z.string().min(1),
        limit: z.number().int().min(1).max(5).optional(),
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

    // ---- Channel Knowledge ------------------------------------------------------------------
    //
    // The third knowledge axis, and the boundary is what makes it useful: Product Knowledge answers
    // "무엇을 파는가", Customer Memory answers "고객이 무엇을 말해왔는가", and these answer "이 채널은
    // 어떻게 작동하는가". None of the three reads seller data here — these tools take no org, no
    // product and no inquiry, because a platform fact is the same for every seller on the channel.
    //
    // Not injected into every run. A planner selects them when the goal is about the channel itself —
    // "왜 안 들어와", "여기서 답변이 되나", "어디서 확인해" — and leaves them out otherwise. Attaching
    // channel documentation to every question would crowd out the seller's own data with prose.
    read(tool(async ({ query, channel, topic, capability }:
      { query?: string; channel?: string; topic?: string; capability?: string }) =>
      deps.operator.searchChannelKnowledge?.({ query, channel, topic, capability, limit: 6 }) ?? [], {
      name: OPERATOR_TOOL.SEARCH_CHANNEL_KNOWLEDGE,
      description:
        "채널이 어떻게 작동하는지에 대한 플랫폼 지식 — 무엇이 되고 무엇이 안 되는지, 상태 값의 의미, "
        + "식별자, 판매자 센터 어디를 봐야 하는지, 흔한 오류의 실제 원인. **판매자 데이터가 아니다** "
        + "(상품·리뷰·문의는 다른 도구). 각 항목은 출처와 마지막 확인 날짜를 함께 준다 — 라이브로 증명된 "
        + "사실과 미확인 메뉴 이름을 같은 무게로 말하지 말 것. 필요한 정보: CHANNEL_KNOWLEDGE.",
      schema: z.object({
        query: z.string().min(1).optional(),
        channel: z.enum(["NAVER", "COUPANG", "CAFE24"]).optional(),
        topic: z.enum([
          "CAPABILITY", "WORKFLOW", "STATUS_SEMANTICS", "CONNECTION",
          "NAVIGATION", "TROUBLESHOOTING", "GLOSSARY", "OPERATIONS",
        ]).optional(),
        capability: z.enum(["REVIEW", "INQUIRY", "ORDER_SUMMARY", "PRODUCT"]).optional(),
      }),
    })),

    read(tool(async ({ channel, dataType }: { channel: string; dataType: string }) =>
      deps.operator.getChannelCapability?.(channel, dataType) ?? null, {
      name: OPERATOR_TOOL.GET_CHANNEL_CAPABILITY,
      description:
        "이 채널에서 이 데이터를 실제로 어떻게 가져오는지 — 공식 API로 자동 수집되는지, 판매자가 매번 "
        + "직접 해야 하는 경로인지(recurrence: SCHEDULED / SELLER_REPEATED / ONE_OFF), 검증되었는지, "
        + "그리고 그 채널에 아예 없는 API가 무엇인지. '리뷰가 왜 안 늘어' 같은 질문은 대개 고장이 아니라 "
        + "이 답이다. 필요한 정보: CHANNEL_KNOWLEDGE.",
      schema: z.object({
        channel: z.enum(["NAVER", "COUPANG", "CAFE24"]),
        dataType: z.enum(["REVIEW", "INQUIRY", "ORDER_SUMMARY", "PRODUCT"]),
      }),
    })),

    read(tool(async ({ channel }: { channel: string }) =>
      deps.operator.getConnectionGuidance?.(channel) ?? [], {
      name: OPERATOR_TOOL.GET_CONNECTION_GUIDANCE,
      description:
        "이 채널을 연결하려면 무엇이 필요한지와, 안 될 때 무엇부터 확인해야 하는지 — 자격 증명 종류, "
        + "OAuth 스코프, 호출 IP 제한, 만료·재동의 규칙. 연결 안내 화면과 같은 사실을 읽는다. "
        + "필요한 정보: CHANNEL_KNOWLEDGE.",
      schema: z.object({ channel: z.enum(["NAVER", "COUPANG", "CAFE24"]) }),
    })),

    // <b>The read that answers "어느 채널에서?" and refuses "없습니다".</b> Every other tool returns
    // rows and therefore can only describe what WAS seen; this one returns, per channel and data type,
    // whether the channel offers it at all, whether this seller is connected, whether routine
    // collection is actually running, and how old the newest row is. A channel with no account is a
    // row here, not an omission — an omitted channel is read as a zero by anything that counts what it
    // was given, and that is precisely the false calm the whole coverage vocabulary exists to prevent.
    // ---- Agentic Operating Workspace v2 ------------------------------------------------------
    read(tool(async ({ from, to, negativeOnly, channel, productId, size, order }:
      { from?: string; to?: string; negativeOnly?: boolean; channel?: string; productId?: string; size?: number; order?: "NEWEST" | "OLDEST" }) => {
      const response = await deps.operator.listRecentReviews({ from, to, negativeOnly, channel, productId, size, order });
      let accounts: RecentReviewsRead["accounts"] = [];
      if (freshnessInDoubt(response.coverage ?? [])) {
        const [channels, sellerAccounts] = await Promise.all([
          deps.operator.listChannels(), deps.inquiry.listSellerAccounts(),
        ]);
        const codeOf = new Map(channels.map((c) => [c.id, c.code]));
        accounts = sellerAccounts
          .map((a: SellerAccountSummary) => ({ channelCode: codeOf.get(a.channelId) ?? "", accountId: a.id, fileUpload: a.fileUpload }))
          .filter((a) => a.channelCode.length > 0);
      }
      return { ...response, accounts } satisfies RecentReviewsRead;
    }, {
      name: OPERATOR_TOOL.LIST_RECENT_REVIEWS,
      description:
        "기간 안에 들어온 리뷰 행 목록 + 채널별 리뷰 수집 최신성. '새 리뷰 / 오늘 리뷰 / 낮은 평점 리뷰' 류 "
        + "질문의 유일한 출처. 리뷰 원문은 sanitized preview 이며, 채널별로 지금이 최신인지 아닌지를 "
        + "같이 준다. 필요한 정보: REVIEW_SIGNAL.",
      schema: z.object({
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        negativeOnly: z.boolean().optional(),
        channel: z.enum(["NAVER", "COUPANG", "CAFE24"]).optional(),
        productId: z.string().min(1).optional(),
        size: z.number().int().min(1).max(50).optional(),
        order: z.enum(["NEWEST", "OLDEST"]).optional(),
      }),
    })),

    read(tool(async ({ days, channel, from, to }: { days: number; channel?: string; from?: string; to?: string }) => {
      const overview = await deps.operator.getDashboardOverview(days);
      if (!channel) {
        return { days, overview, channel: null } satisfies SalesTrendRead;
      }
      const channels = await deps.operator.listChannels();
      const row = channels.find((c) => c.code.toUpperCase() === channel.toUpperCase());
      if (!row) {
        return { days, overview, channel: null } satisfies SalesTrendRead;
      }
      const summary = await deps.operator.getOrdersSummary({
        from: from ?? overview.metrics.period.from, to: to ?? overview.metrics.period.to, channelId: row.id,
      });
      return { days, overview, channel: { channelCode: row.code, channelId: row.id, summary } } satisfies SalesTrendRead;
    }, {
      name: OPERATOR_TOOL.GET_SALES_TREND,
      description:
        "주문·매출 흐름 — 기간 합계, 직전 같은 기간 대비 변화, 채널별 매출·주문, 일별 추이. 채널을 지정하면 "
        + "그 채널만의 추이를 같이 준다. 매출 산정 기준과 제외된 채널이 함께 온다. 필요한 정보: ORDER_HISTORY.",
      schema: z.object({
        days: z.union([z.literal(7), z.literal(14), z.literal(30)]),
        channel: z.enum(["NAVER", "COUPANG", "CAFE24"]).optional(),
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      }),
    })),

    read(tool(async ({ productIds, workItemIds, topic, maxDetailReads, channel, from, to, order, limit }:
      { productIds?: string[]; workItemIds?: string[]; topic?: string; maxDetailReads?: number; channel?: string;
        from?: string; to?: string; order?: "NEWEST" | "OLDEST"; limit?: number }) =>
      listInquiryWorkload(deps.inquiry, {
        productIds, workItemIds, maxDetailReads, channel, from, to, order, limit,
        topic: (topic ?? null) as Parameters<typeof listInquiryWorkload>[1]["topic"],
      }), {
      name: OPERATOR_TOOL.LIST_INQUIRY_WORKLOAD,
      description:
        "답변이 필요한 문의를 상태별로 분류한 목록 — 초안 준비됨 / 규격 되물음 필요 / 답변 기준 없음 / 미답변. "
        + "기존 대기열 페이지 두 장과 상한 " + String(WORKLOAD_DETAIL_CAP) + "건의 상세 조회로 만든다. "
        + "상품 id 나 주제(배송·교환반품·규격·사용법)로 좁힐 수 있다. 필요한 정보: INQUIRY_VOLUME.",
      schema: z.object({
        productIds: z.array(z.string().min(1)).max(50).optional(),
        workItemIds: z.array(z.string().min(1)).max(50).optional(),
        topic: z.enum(["SHIPPING", "EXCHANGE_RETURN", "PRODUCT_SPEC", "USAGE", "OTHER"]).optional(),
        maxDetailReads: z.number().int().min(0).max(WORKLOAD_DETAIL_CAP).optional(),
        // Query Accuracy v1: the QuerySpec axes. Named here so the schema cannot strip them — a filter
        // the planner set and the tool never saw was the defect this package closes.
        channel: z.enum(["NAVER", "COUPANG", "CAFE24"]).optional(),
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        order: z.enum(["NEWEST", "OLDEST"]).optional(),
        limit: z.number().int().min(1).max(50).optional(),
      }),
    })),

    read(tool(async ({ from, to, channel, status, order, limit }:
      { from?: string; to?: string; channel?: string; status?: "UNANSWERED" | "ANSWERED" | "ALL"; order?: "NEWEST" | "OLDEST"; limit?: number }) =>
      deps.inquiry.listInquiryRows({ from, to, channel, status, order, limit }), {
      name: OPERATOR_TOOL.LIST_INQUIRY_ROWS,
      description:
        "고객 문의 행 목록 — 기간·채널·상태(미답변/답변/전체)·순서(최신/오래된)·개수로 좁힌다. '최근 문의 3개', "
        + "'오늘 들어온 문의', '답변 안 한 것만' 류 질문의 출처. 판매자가 처리할 일(작업 큐)이 아니라 문의 자체다. "
        + "필요한 정보: INQUIRY_VOLUME.",
      schema: z.object({
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        channel: z.enum(["NAVER", "COUPANG", "CAFE24"]).optional(),
        status: z.enum(["UNANSWERED", "ANSWERED", "ALL"]).optional(),
        order: z.enum(["NEWEST", "OLDEST"]).optional(),
        limit: z.number().int().min(1).max(50).optional(),
      }),
    })),

    // <b>What this channel can DO, from the registries.</b> Four reads that already exist, returned as
    // sources for a pure resolver: how a data type is acquired (overview), whether an inquiry reply can
    // be posted and how (transports + the deployment's wiring), whether a review reply can be executed
    // and how (the review channel block). Every source is nullable — a backend predating one of them
    // is a fact the resolver degrades on, never an exception. Nothing here writes, mints or starts.
    read(tool(async ({ channel }: { channel: string }) => {
      const code = channel.toUpperCase();
      const [overview, transports, publish, channels, accounts] = await Promise.all([
        deps.operator.getChannelCapabilityOverview?.(code).catch(() => null) ?? Promise.resolve(null),
        deps.operator.listInquiryReplyTransports?.().catch(() => null) ?? Promise.resolve(null),
        deps.inquiry.getPublishCapability().catch(() => null),
        deps.operator.listChannels().catch(() => []),
        deps.inquiry.listSellerAccounts().catch(() => []),
      ]);
      const channelId = channels.find((c) => c.code.toUpperCase() === code)?.id ?? null;
      // The API-mode account is the one a review reply would be executed through; a file-upload
      // account has no channel to execute on, which is exactly what the resolver must not be told.
      const account = channelId ? accounts.find((a: SellerAccountSummary) => a.channelId === channelId && !a.fileUpload) ?? null : null;
      const reviewChannel = account
        ? await (deps.operator.getReviewChannelCapability?.(account.id).catch(() => null) ?? Promise.resolve(null))
        : null;
      return { channelCode: code, overview, transports, publish, reviewChannel, accountId: account?.id ?? null } satisfies ChannelCapabilityRead;
    }, {
      name: OPERATOR_TOOL.GET_CHANNEL_EXECUTION_CAPABILITY,
      description:
        "이 채널에서 실제로 무엇이 되는지 — 리뷰·문의가 자동으로 새로 가져와지는지 아니면 판매자의 한 단계가 "
        + "필요한지, 문의 답변을 채널로 보낼 수 있는지(출처 종류별), 리뷰 답글을 채널로 보낼 수 있는지. "
        + "런타임이 실행 경로를 정할 때 읽는 사실이며 판매자 데이터는 없다. 필요한 정보: REVIEW_SIGNAL, INQUIRY_VOLUME.",
      schema: z.object({ channel: z.enum(["NAVER", "COUPANG", "CAFE24"]) }),
    })),

    // <b>The company's operating rules, read on demand.</b> Backed by `GET /api/org-knowledge/search` —
    // the same corpus the inquiry draft's ORG_OPERATIONS lane reads, scoped to the org by the bearer.
    // Nothing here is injected into a prompt: the planner declares a POLICY need, and only then is the
    // corpus searched, for this question. An empty result is a real answer with two shapes the response
    // keeps apart (nothing registered vs. nothing that covers this question).
    read(tool(async ({ query, limit }: { query: string; limit?: number }) => {
      if (!deps.operator.searchOrgKnowledge) {
        return { query, documentsSearched: 0, passagesSearched: 0, passages: [] } satisfies OrgKnowledgeSearchResult;
      }
      return deps.operator.searchOrgKnowledge(query, limit);
    }, {
      name: OPERATOR_TOOL.SEARCH_ORG_KNOWLEDGE,
      description:
        "회사가 등록해 둔 운영 기준(배송·주문 취소·교환·반품·환불·결제·세금계산서·현금영수증·공통 안내) 중 "
        + "이 질문에 해당하는 문장을 찾는다. '우리 배송 정책 뭐였지', '환불 기준으로 답해줘' 류 질문의 출처이며 "
        + "상품을 특정할 필요가 없다. 필요한 정보: POLICY.",
      schema: z.object({ query: z.string().min(1).max(400), limit: z.number().int().min(1).max(5).optional() }),
    })),

    // <b>The answers this company actually sent or approved</b> (Retrieval & Grounding Correctness v1).
    // Backed by `GET /api/answer-memory/search` — the same `answer_memory` the draft composer's memory
    // lane reads; AI drafts and fallbacks are never in it. A past answer is a record of what was said,
    // never a current fact: the composer still refuses to ground on it alone.
    read(tool(async (args: { query: string; productId?: string; productName?: string; excludeInquiryId?: string; limit?: number }) => {
      if (!deps.operator.searchAnswerMemory) {
        return { query: args.query, memoriesSearched: 0, supersededByConflict: 0, passages: [], outcome: "ABSENT" } satisfies AnswerMemorySearchResult;
      }
      return deps.operator.searchAnswerMemory(args);
    }, {
      name: OPERATOR_TOOL.SEARCH_ANSWER_MEMORY,
      description:
        "회사가 예전에 실제로 보냈거나 승인한 답변 중 이 질문에 해당하는 것. '예전에 비슷한 문의에 뭐라고 답했어', "
        + "'과거 승인 답변 참고해서' 류 질문의 출처다. 결과의 강도(채널에 등록된 답변 < 판매자가 승인한 답변 < "
        + "전송이 확인된 답변)는 동률일 때의 순서일 뿐이며, 과거 답변은 그때 한 말이지 지금의 사실이 아니다. "
        + "필요한 정보: PAST_ANSWER.",
      schema: z.object({
        query: z.string().min(1).max(400),
        productId: z.string().min(1).optional(),
        productName: z.string().min(1).max(200).optional(),
        excludeInquiryId: z.string().min(1).optional(),
        limit: z.number().int().min(1).max(5).optional(),
      }),
    })),

    // <b>The company's own description of itself, read on demand</b> (Seller Context v1-B). Backed by
    // `GET /api/seller-profile`, one org-keyed row. Read only when the plan declared a COMPANY_PROFILE
    // need — never injected into the planner or judge — and context for wording only: nothing here is
    // evidence for a delivery, refund, exchange, A/S or spec claim, and no basis verdict reads it.
    read(tool(async () => {
      if (!deps.operator.getSellerProfile) {
        return { name: null, businessSummary: null, configured: false, updatedAt: null } satisfies SellerProfileView;
      }
      return deps.operator.getSellerProfile();
    }, {
      name: OPERATOR_TOOL.GET_SELLER_PROFILE,
      description:
        "판매자가 설정에 등록한 회사 소개(어떤 회사인지, 주 고객층·업종). '우리 회사는 어떤 곳으로 등록돼 있어', "
        + "'우리 업체 특성을 고려해서' 같은 질문에서만 읽는다. 배송·환불·규격의 근거가 아니다. 필요한 정보: COMPANY_PROFILE.",
      schema: z.object({}),
    })),

    read(tool(async () => deps.operator.getChannelCoverage?.() ?? [], {
      name: OPERATOR_TOOL.GET_CHANNEL_COVERAGE,
      description:
        "채널별로 지금 무엇을 말할 수 있는지 — 그 채널이 이 데이터를 제공하는지, 연결되어 있는지, "
        + "자동 수집이 실제로 돌고 있는지, 가지고 있는 행이 몇 건이고 가장 최근 것이 언제인지. "
        + "**'0건'과 '미지원'과 '최신인지 모름'을 구분하는 유일한 도구다** — 채널별로 나눠 답하거나 "
        + "'없습니다'라고 말하려면 반드시 먼저 읽어야 한다. 필요한 정보: CHANNEL_COVERAGE.",
      schema: z.object({}),
    })),
  ];
}

/** The catalogue lines a planner is shown: name and one-line purpose. No endpoint, no seller data. */
export function toolCatalogueFor(tools: readonly ClassifiedTool[]): string[] {
  return tools.map((t) => `${t.tool.name}: ${t.tool.description}`);
}
