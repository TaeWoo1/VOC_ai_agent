/**
 * Retrieval & Grounding Correctness v1 (2026-08-30) — the Agent lane says what retrieval established.
 *
 *  E. a rule that exists and does not apply → NOT_APPLICABLE wording, no 「기준 없음」, no KNOWLEDGE_ENTRY step.
 *  F. product knowledge exists, no covering passage → NO_RELEVANT_EVIDENCE wording, never 「상품 지식이 없다」.
 *  G. 「예전에 뭐라고 답했어」 → `search_answer_memory` (the answer store), never `search_customer_memory`.
 *  J. a rows turn → knowledge 0 · memory 0.
 * The backend's query normalization is its own test (Java); here the fake returns the outcome and the
 * lane is checked for saying exactly that.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { TOKEN, artifact, harness, say } from "./support";
import type { Harness } from "./support";
import { CONVERSATION_PLANS, RECORDED_PLANS } from "../support/recordedPlans";
import type { AgentPlanView, AnswerMemorySearchResult, KnowledgeSearchResult, OrgKnowledgeSearchResult } from "../../src/spring/types";
import { resetJudgeCapabilityMemo } from "../../src/operator/judge/EvidenceJudge";
import { MOLDING } from "../support/operatorFixtures";

const V8 = "agent-plan-prompt/v8";
type Filters = NonNullable<AgentPlanView["filters"]>;
const NONE: Filters = {
  period: null, rating: null, channel: null, scope: null, topic: null, reviewIntent: null,
  inquiryIntent: null, limit: null, order: null, status: null,
};

function plan(goal: string, need: { kind: string; question: string },
  specialists: string[], tools: string[], extra: Partial<AgentPlanView> = {}): AgentPlanView {
  return {
    available: true, supported: true, userGoal: goal, unresolvedEntities: [],
    informationNeeds: [{ id: "n1", question: need.question, kind: need.kind, why: "근거", required: true }],
    specialists, tools, retrievalOrder: ["n1"], retrievalParallel: [], retrievalStopWhen: null,
    evidenceRequirements: [], riskClass: "ROUTINE", maxIterations: 1, maxToolCalls: 6, stopWhenEnough: null,
    clarificationNeeded: false, clarificationReason: null, rationale: "근거 조회", providerVersion: V8,
    requestedAction: "NONE", tone: null, filters: { ...NONE }, target: { selector: "NONE", index: null }, ...extra,
  };
}

const POLICY_ASK = "이 문의에 우리 배송 정책 기준으로 답해줘";
const PAST_ASK = `${MOLDING.name} 문의에 예전에 뭐라고 답했어?`;
const DOC_ASK = `${MOLDING.name} 반품 조건이 명시돼 있는지 확인해줘`;
const ROWS_ASK = "최근 문의 3개 보여줘";

const PLANS: Record<string, AgentPlanView> = {
  ...RECORDED_PLANS, ...CONVERSATION_PLANS,
  [POLICY_ASK]: plan(POLICY_ASK, { kind: "POLICY", question: "회사의 배송 기준" }, ["INQUIRY_OPS"], ["search_org_knowledge"]),
  [PAST_ASK]: plan(PAST_ASK, { kind: "PAST_ANSWER", question: "예전에 보낸 답변" }, ["PRODUCT_OPS", "INQUIRY_OPS"],
    ["resolve_product", "search_answer_memory"], { unresolvedEntities: [{ kind: "PRODUCT", mention: MOLDING.name }] }),
  [DOC_ASK]: plan(DOC_ASK, { kind: "PRODUCT_KNOWLEDGE_DOC", question: "이 상품의 교환이나 반품이 가능한 조건이 명시돼 있는지 확인해줘" },
    ["PRODUCT_OPS"], ["search_product_knowledge"], { unresolvedEntities: [{ kind: "PRODUCT", mention: MOLDING.name }] }),
  [ROWS_ASK]: plan(ROWS_ASK, { kind: "INQUIRY_VOLUME", question: "최근 문의 3개" }, ["INQUIRY_OPS"], [],
    { filters: { ...NONE, inquiryIntent: "ROWS", order: "NEWEST", limit: 3 } }),
};

const policy = (outcome: OrgKnowledgeSearchResult["outcome"], documentsSearched: number): OrgKnowledgeSearchResult =>
  ({ query: "", documentsSearched, passagesSearched: documentsSearched, passages: [], outcome, rejectedNotApplicable: outcome === "NOT_APPLICABLE" ? 1 : 0, candidatesTried: 3 });
const knowledge = (outcome: KnowledgeSearchResult["outcome"]): KnowledgeSearchResult =>
  ({ productId: MOLDING.id, query: "", documentsSearched: 3, passagesSearched: 3, passages: [], outcome, rejectedNotApplicable: outcome === "NOT_APPLICABLE" ? 1 : 0, candidatesTried: 3 });
const MEMORY: AnswerMemorySearchResult = {
  query: "", memoriesSearched: 8, supersededByConflict: 0, outcome: "FOUND", candidatesTried: 2,
  passages: [{
    memoryId: "mem-1", topicSignature: null, topicCategory: "RETURN", answerTitle: "반품 안내", answerBody: "수령 후 7일 이내 미사용 상태에서 반품 가능합니다.",
    score: 0.9, strength: "EXECUTOR_SENT_VERIFIED", strengthLabel: "전송이 확인된 답변", productId: MOLDING.id, channelCode: "NAVER",
    authorName: "데모 운영자", version: 1, updatedAt: "2026-08-26T09:00:00Z",
  }],
};

async function ask(h: Harness, text: string) {
  const view = await h.service.create(TOKEN);
  return say(h, view.conversationId, text);
}

beforeEach(() => resetJudgeCapabilityMemo());

describe("E — a rule that exists and does not apply is said as that", () => {
  it("NOT_APPLICABLE: 「기준은 등록되어 있지만…」, no 「기준 없음」, no register-again step", async () => {
    const h = harness({ plansByGoal: PLANS, orgKnowledgeSearch: policy("NOT_APPLICABLE", 2) });
    const { turn } = await ask(h, POLICY_ASK);
    expect(turn.message).toContain("배송 기준은 등록되어 있지만 이 문의에 바로 적용하기 어렵습니다.");
    expect(turn.message).not.toContain("기준이 아직 없습니다");
    expect(turn.artifacts.some((a) => a.type === "HUMAN_ACTION_REQUIRED" && a.actionType === "KNOWLEDGE_ENTRY")).toBe(false);
    expect(turn.answer?.evidence.find((e) => e.kind === "ORG_POLICY_GAP")?.locator.outcome).toBe("NOT_APPLICABLE");
  });

  it("ABSENT: 「등록된 배송 기준이 아직 없습니다」 and the register step is offered", async () => {
    const h = harness({ plansByGoal: PLANS, orgKnowledgeSearch: policy("ABSENT", 0) });
    const { turn } = await ask(h, POLICY_ASK);
    expect(turn.message).toContain("등록된 배송 기준이 아직 없습니다.");
    expect(artifact(turn, "HUMAN_ACTION_REQUIRED").actionType).toBe("KNOWLEDGE_ENTRY");
  });

  it("an older backend without `outcome` still gets the two-valued truth from the counts", async () => {
    const h = harness({ plansByGoal: PLANS, orgKnowledgeSearch: { query: "", documentsSearched: 2, passagesSearched: 2, passages: [] } });
    const { turn } = await ask(h, POLICY_ASK);
    expect(turn.message).toContain("등록된 운영 정책에서 이 질문에 맞는 근거를 찾지 못했습니다.");
  });
});

describe("F — product knowledge that exists but does not cover the question", () => {
  it("NO_RELEVANT_EVIDENCE: a miss over the product information, never 「상품 지식이 없다」", async () => {
    const h = harness({ plansByGoal: PLANS, productKnowledgeSearch: { [MOLDING.id]: knowledge("NO_RELEVANT_EVIDENCE") } });
    const { turn } = await ask(h, DOC_ASK);
    expect(turn.message).toContain("등록된 상품 정보(3건)에서 이 질문에 맞는 근거를 찾지 못했습니다.");
    expect(turn.message).not.toContain("등록된 상품 지식이 아직 없습니다");
    // The query the tool was asked with is the need's question; the backend normalizes it — the label never echoes it.
    expect(turn.answer?.evidence.find((e) => e.kind === "PRODUCT_KNOWLEDGE_GAP")?.locator.label).toBe("상품 지식 근거 없음");
  });

  it("NOT_APPLICABLE: 「관련 상품 지식은 등록되어 있지만…」", async () => {
    const h = harness({ plansByGoal: PLANS, productKnowledgeSearch: { [MOLDING.id]: knowledge("NOT_APPLICABLE") } });
    const { turn } = await ask(h, DOC_ASK);
    expect(turn.message).toContain("관련 상품 정보는 등록되어 있지만 이 문의에 바로 적용하기 어렵습니다.");
  });
});

describe("G — 「예전에 뭐라고 답했어」 reads the answer store", () => {
  it("routes PAST_ANSWER to search_answer_memory with the product anchor; customer memory is not called", async () => {
    const h = harness({ plansByGoal: PLANS, answerMemorySearch: MEMORY });
    const { turn } = await ask(h, PAST_ASK);
    expect(turn.status).toBe("DONE");
    expect(h.operator.calls.answerMemorySearch).toBe(1);
    expect(h.operator.answerMemoryParams[0]).toMatchObject({ productId: MOLDING.id, productName: MOLDING.name, limit: 3 });
    expect(h.operator.calls.memory).toBe(0);
    expect(turn.message).toContain("예전에 보낸 답변(전송이 확인된 답변, 2026-08-26): 수령 후 7일 이내");
    const ref = turn.answer?.evidence.find((e) => e.kind === "PAST_ANSWER");
    expect(ref?.provenance).toBe("answer-memory/EXECUTOR_SENT_VERIFIED");
    expect(ref?.locator.memoryId).toBe("mem-1");
  });

  it("no remembered answer at all vs none covering the question are two sentences", async () => {
    const none = harness({ plansByGoal: PLANS });
    expect((await ask(none, PAST_ASK)).turn.message).toContain("저장된 과거 답변이 아직 없습니다.");
    const miss = harness({ plansByGoal: PLANS, answerMemorySearch: { ...MEMORY, passages: [], outcome: "NO_RELEVANT_EVIDENCE" } });
    expect((await ask(miss, PAST_ASK)).turn.message).toContain("저장된 과거 답변에서 이 질문에 맞는 것을 찾지 못했습니다.");
  });
});

describe("J — a rows turn spends no retrieval", () => {
  it("knowledge 0 · org knowledge 0 · answer memory 0", async () => {
    const h = harness({ plansByGoal: PLANS, answerMemorySearch: MEMORY });
    await ask(h, ROWS_ASK);
    expect(h.operator.calls.knowledgeSearch).toBe(0);
    expect(h.operator.calls.orgKnowledgeSearch).toBe(0);
    expect(h.operator.calls.answerMemorySearch).toBe(0);
  });
});
