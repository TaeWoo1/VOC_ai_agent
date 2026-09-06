/**
 * <b>The six procedures, as definitions.</b>
 *
 * LangGraph Orchestration Migration + AOP Runtime Core v1 §3/§4. These are the same six Agent
 * Procedure Layer v1 named — no procedure was added, and none may be added because a QA case wanted
 * one. What is new is that each now states the rest of itself: its steps in order, the tools it may
 * reach, the references it may keep in state, the guardrails it stands on, how it can end, and where
 * it stops for a person.
 *
 * <b>Every field below describes behaviour that already exists.</b> The definitions were written by
 * reading {@code ConversationService} and the operator graph, not by designing a target state: a
 * definition that promised a step the runtime does not perform would be the worst possible artefact
 * here, because it reads like documentation and compiles like a contract.
 */
import { OPERATOR_TOOL } from "../operator/tools/OperatorTools";
import type { ProcedureCatalogue, ProcedureDefinition } from "./ProcedureDefinition";

const T = OPERATOR_TOOL;

/**
 * 판매 채널 연결 — the procedure whose precondition is the absence of every other one's.
 *
 * It reads the coverage table and nothing else, because there is nothing else to read: a shop with no
 * connected channel has no rows, and the whole of this procedure is saying so honestly and naming the
 * one screen that changes it.
 */
const ONBOARD_CHANNEL: ProcedureDefinition = {
  id: "ONBOARD_CHANNEL",
  version: "onboard-channel/v1",
  entry: {
    when: "이 조직에 연결된 판매 채널이 없다",
    readiness: ["NO_CHANNEL"],
    priority: 10,
  },
  steps: [
    { id: "world", does: "coverage 한 번 읽어 readiness를 정한다", handler: "hydrateWorld" },
    { id: "gate", does: "NO_CHANNEL 부재 이유와 연결 단계를 확정한다", handler: "checkPrecondition" },
    { id: "answer", does: "부재 문장과 다음 걸음 하나를 그린다", handler: "compose" },
  ],
  allowedTools: [T.GET_CHANNEL_COVERAGE, T.GET_CONNECTION_GUIDANCE, T.GET_CHANNEL_CAPABILITY],
  references: ["CHANNEL_CODE"],
  guardrails: ["READ_ONLY_TOOLS", "NO_MARKETPLACE_WRITE", "ABSENCE_ONLY_FROM_MEASURED_ZERO", "NO_PHRASE_MATCHING"],
  completion: ["BLOCKED_BY_PRECONDITION"],
  humanInterrupt: [],
};

/**
 * 오늘 할 일 — the checklist, and the only procedure allowed to say 「지금 먼저 하실 일은 없습니다」.
 *
 * That claim is `ZERO_MEASURED` and nothing else, and a turn that produced findings has not earned it
 * ({@code honestZero}). The read is whatever the plan asked for; this procedure owns what an empty
 * result MEANS.
 */
const DAILY_WORK: ProcedureDefinition = {
  id: "DAILY_WORK",
  version: "daily-work/v1",
  entry: {
    when: "판매자가 오늘 할 일의 목록을 요청했다",
    readiness: ["NO_DATA", "WORKING", "UNKNOWN"],
    requestedAction: ["LIST_ACTIONS"],
    priority: 20,
  },
  steps: [
    { id: "world", does: "coverage 한 번 읽어 readiness를 정한다", handler: "hydrateWorld" },
    { id: "gate", does: "읽을 수 있는 출처가 있는지 본다", handler: "checkPrecondition" },
    { id: "read", does: "plan이 세운 need를 specialist가 읽는다", handler: "runOperator" },
    { id: "answer", does: "체크리스트를 그리고, 비었을 때만 그 사실을 말한다", handler: "compose" },
  ],
  allowedTools: [
    T.GET_TODAY_INBOX, T.LIST_INQUIRY_WORKLOAD, T.LIST_INQUIRY_ROWS, T.LIST_RECENT_REVIEWS,
    T.SEARCH_REVIEW_ISSUES, T.GET_SALES_TREND, T.GET_CHANNEL_COVERAGE,
  ],
  references: ["WORK_ITEM_ID", "INQUIRY_ID", "REVIEW_ID", "CHANNEL_CODE"],
  guardrails: ["READ_ONLY_TOOLS", "NO_MARKETPLACE_WRITE", "ABSENCE_ONLY_FROM_MEASURED_ZERO", "NO_PHRASE_MATCHING"],
  completion: ["ANSWERED", "BLOCKED_BY_PRECONDITION", "UNKNOWN"],
  humanInterrupt: [],
};

/**
 * 문의 하나에 답변 준비 → 승인 → 전송.
 *
 * <b>The interrupt is not the approval.</b> A prepared draft stops the turn and asks; the approval is
 * then validated against its own record by {@code validateApproval}, and only then may {@code execute}
 * run — once, behind the single-use fence that already exists.
 */
const ANSWER_INQUIRY: ProcedureDefinition = {
  id: "ANSWER_INQUIRY",
  version: "answer-inquiry/v1",
  entry: {
    when: "문의 하나가 지목돼 있고 답변을 준비·수정·전송해 달라고 했다",
    anchor: "INQUIRY",
    requestedAction: ["PREPARE_INQUIRY_DRAFT", "REQUEST_SEND_APPROVAL"],
    priority: 30,
  },
  steps: [
    { id: "target", does: "anchor 또는 문장이 좁힌 대상을 exact READ 한 번으로 확인한다", handler: "resolveTarget" },
    { id: "gate", does: "그 문의가 지금 초안을 받을 수 있는지 본다", handler: "checkPrecondition" },
    { id: "draft", does: "백엔드의 production draft path로 초안을 만든다", handler: "prepareDraft" },
    { id: "tone", does: "말투 요청이 있으면 같은 근거로 새 버전을 만든다", handler: "reviseDraft", optional: true },
    { id: "answer", does: "초안과 근거를 그린다", handler: "compose" },
    { id: "approval", does: "전송을 요청했으면 승인 경계를 확인한다", handler: "validateApproval", optional: true },
    { id: "send", does: "승인된 것만, 한 번만 보낸다", handler: "execute", optional: true },
  ],
  allowedTools: [
    T.GET_INQUIRY_DETAIL, T.GET_INQUIRY_CONTEXT, T.LIST_INQUIRY_WORKLOAD, T.LIST_INQUIRY_ROWS,
    T.SEARCH_ORG_KNOWLEDGE, T.SEARCH_ANSWER_MEMORY, T.SEARCH_PRODUCT_KNOWLEDGE, T.SEARCH_PRODUCT_FACTS,
    T.SEARCH_CUSTOMER_MEMORY, T.GET_SELLER_PROFILE, T.RESOLVE_PRODUCT,
  ],
  references: ["WORK_ITEM_ID", "INQUIRY_ID", "PRODUCT_ID", "DRAFT_VERSION", "CHANNEL_CODE"],
  guardrails: [
    "READ_ONLY_TOOLS", "DRAFT_BEHIND_PRECONDITION", "APPROVAL_VALIDATED_SEPARATELY",
    "RESUME_IS_IDEMPOTENT", "NO_MARKETPLACE_WRITE",
  ],
  completion: ["ANSWERED", "BLOCKED_BY_PRECONDITION", "WAITING_HUMAN"],
  humanInterrupt: ["SEND_APPROVAL"],
};

/**
 * 리뷰 하나에 답글 준비 → 승인 → 실행.
 *
 * Two refusals rather than one, and they are different claims: a channel with no seller-reply path, and
 * a channel whose reply semantics could not be read. Guided channels add the second interrupt — the
 * seller performs the final click on the marketplace and the runtime only detects the result.
 */
const ANSWER_REVIEW: ProcedureDefinition = {
  id: "ANSWER_REVIEW",
  version: "answer-review/v1",
  entry: {
    when: "리뷰 하나가 지목돼 있고 답글을 준비·수정·게시해 달라고 했다",
    anchor: "REVIEW",
    requestedAction: ["PREPARE_INQUIRY_DRAFT", "REQUEST_SEND_APPROVAL"],
    priority: 40,
  },
  steps: [
    { id: "target", does: "리뷰 하나를 exact READ 한 번으로 확인한다", handler: "resolveTarget" },
    { id: "gate", does: "이 채널이 답글을 받을 수 있는지 본다", handler: "checkPrecondition" },
    { id: "draft", does: "회사 문구와 근거로 답글 초안을 만든다", handler: "prepareDraft" },
    { id: "tone", does: "말투 요청이 있으면 같은 근거로 새 버전을 만든다", handler: "reviseDraft", optional: true },
    { id: "answer", does: "초안과 답변 작업 화면으로 가는 길을 그린다", handler: "compose" },
    { id: "approval", does: "게시를 요청했으면 승인 경계를 확인한다", handler: "validateApproval", optional: true },
    { id: "guided", does: "가이드 채널이면 판매자가 할 단계를 알리고 멈춘다", handler: "requestHumanAction", optional: true },
    { id: "send", does: "승인된 것만, 한 번만 실행한다", handler: "execute", optional: true },
  ],
  allowedTools: [
    T.LIST_RECENT_REVIEWS, T.GET_CHANNEL_EXECUTION_CAPABILITY, T.GET_CHANNEL_CAPABILITY,
    T.SEARCH_ORG_KNOWLEDGE, T.SEARCH_PRODUCT_KNOWLEDGE, T.SEARCH_ANSWER_MEMORY, T.RESOLVE_PRODUCT,
  ],
  references: ["REVIEW_ID", "PRODUCT_ID", "DRAFT_VERSION", "CHANNEL_CODE"],
  guardrails: [
    "READ_ONLY_TOOLS", "DRAFT_BEHIND_PRECONDITION", "APPROVAL_VALIDATED_SEPARATELY",
    "RESUME_IS_IDEMPOTENT", "NO_MARKETPLACE_WRITE",
  ],
  completion: ["ANSWERED", "BLOCKED_BY_PRECONDITION", "WAITING_HUMAN", "UNKNOWN"],
  humanInterrupt: ["SEND_APPROVAL", "HUMAN_ACTION_ON_CHANNEL"],
};

/**
 * 빠진 답변 기준을 묻고, 저장하고, 하던 일을 한 번 재개한다.
 *
 * <b>The only procedure whose interrupt produces a WRITE</b> — and the write is the seller's own
 * sentence through the seller-write seam, bound to the candidate it answers, never to text the runtime
 * matched. Resuming re-runs the original work exactly once.
 */
const CAPTURE_KNOWLEDGE: ProcedureDefinition = {
  id: "CAPTURE_KNOWLEDGE",
  version: "capture-knowledge/v1",
  entry: {
    when: "초안이 근거를 찾지 못해 판매자에게 물어야 한다 (또는 이미 물어 둔 질문이 서 있다)",
    pendingCapture: true,
    priority: 5,
  },
  steps: [
    { id: "ask", does: "무엇이 빠졌는지 닫힌 템플릿으로 묻고 멈춘다", handler: "askKnowledge" },
    { id: "store", does: "판매자 문장을 seller-write seam으로 저장한다", handler: "storeKnowledge" },
    { id: "redo", does: "원래 하던 일을 정확히 한 번 다시 한다", handler: "prepareDraft" },
    { id: "answer", does: "저장했다는 사실과 다시 만든 결과를 그린다", handler: "compose" },
  ],
  allowedTools: [T.SEARCH_ORG_KNOWLEDGE, T.SEARCH_PRODUCT_KNOWLEDGE, T.GET_INQUIRY_DETAIL],
  references: ["CANDIDATE_ID", "WORK_ITEM_ID", "INQUIRY_ID", "PRODUCT_ID"],
  guardrails: ["READ_ONLY_TOOLS", "NO_MARKETPLACE_WRITE", "RESUME_IS_IDEMPOTENT", "NO_PHRASE_MATCHING"],
  completion: ["ANSWERED", "WAITING_HUMAN"],
  humanInterrupt: ["KNOWLEDGE_ANSWER"],
};

/**
 * 반복되는 문제에서 개선 기회를 도출한다.
 *
 * The opportunities are derived by the backend from issue evidence and the seller's own knowledge;
 * this procedure reads them and never invents a cause or a remedy.
 */
const IMPROVE_FROM_ISSUES: ProcedureDefinition = {
  id: "IMPROVE_FROM_ISSUES",
  version: "improve-from-issues/v1",
  entry: {
    when: "반복 문제에서 무엇을 보완할 수 있는지 물었다",
    readiness: ["WORKING", "UNKNOWN"],
    needKinds: ["IMPROVEMENT_OPPORTUNITY"],
    priority: 50,
  },
  steps: [
    { id: "read", does: "그 이슈의 개선 기회를 백엔드에서 읽는다", handler: "readOpportunities" },
    { id: "answer", does: "무엇이 반복되는지·근거·다음 행동을 그린다", handler: "compose" },
  ],
  allowedTools: [
    T.LIST_IMPROVEMENT_OPPORTUNITIES, T.SEARCH_REVIEW_ISSUES, T.GET_ISSUE_EVIDENCE_SUMMARY,
    T.GET_ISSUE_TREND, T.RESOLVE_PRODUCT, T.GET_DASHBOARD_PRODUCT_ISSUES,
  ],
  references: ["ISSUE_ID", "PRODUCT_ID"],
  guardrails: ["READ_ONLY_TOOLS", "NO_MARKETPLACE_WRITE", "NO_PHRASE_MATCHING"],
  completion: ["ANSWERED", "UNKNOWN"],
  humanInterrupt: [],
};

/** The catalogue. Six, because six is what this product has — not a budget and not a target. */
export const PROCEDURES: ProcedureCatalogue = {
  ONBOARD_CHANNEL, DAILY_WORK, ANSWER_INQUIRY, ANSWER_REVIEW, CAPTURE_KNOWLEDGE, IMPROVE_FROM_ISSUES,
};

/** In the order the router considers them. */
export const PROCEDURES_BY_PRIORITY: readonly ProcedureDefinition[] =
  Object.values(PROCEDURES).sort((a, b) => a.entry.priority - b.entry.priority);
