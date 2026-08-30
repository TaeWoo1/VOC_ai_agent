/**
 * Retrieval Query Selection v1 (2026-08-30) — what the Agent lane hands the retriever.
 *
 *  A. a plan whose closed `filters.topic` names an operating topic → `search_product_knowledge` carries that
 *     topic as the seller's word, beside the need's question (the backend tries it first).
 *  B. a spec/usage/other filter, or none, sends no topic — a question with no topic is not forced into one.
 *  C. a rows turn (「최근 문의 3개」) performs no retrieval at all — knowledge 0 · policy 0 · memory 0.
 * The sentence→subject reduction itself is the backend's (Java) test; here only the arguments are pinned.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { TOKEN, harness, say } from "./support";
import type { Harness } from "./support";
import { CONVERSATION_PLANS, RECORDED_PLANS } from "../support/recordedPlans";
import type { AgentPlanView, KnowledgeSearchResult } from "../../src/spring/types";
import { resetJudgeCapabilityMemo } from "../../src/operator/judge/EvidenceJudge";
import { MOLDING } from "../support/operatorFixtures";

type Filters = NonNullable<AgentPlanView["filters"]>;
const NONE: Filters = {
  period: null, rating: null, channel: null, scope: null, topic: null, reviewIntent: null,
  inquiryIntent: null, limit: null, order: null, status: null,
};
const NEED = "‘QA 전선몰딩’의 상품 설명/FAQ/정책 문서 중 반품(교환·반품·환불) 조건이 명시된 문장이 있는가";

function docPlan(goal: string, topic: Filters["topic"]): AgentPlanView {
  return {
    available: true, supported: true, userGoal: goal, unresolvedEntities: [{ kind: "PRODUCT", mention: MOLDING.name }],
    informationNeeds: [{ id: "n1", question: NEED, kind: "PRODUCT_KNOWLEDGE_DOC", why: "근거", required: true }],
    specialists: ["PRODUCT_OPS"], tools: ["resolve_product", "search_product_knowledge"], retrievalOrder: ["n1"], retrievalParallel: [],
    retrievalStopWhen: null, evidenceRequirements: [], riskClass: "ROUTINE", maxIterations: 1, maxToolCalls: 6, stopWhenEnough: null,
    clarificationNeeded: false, clarificationReason: null, rationale: "근거 조회", providerVersion: "agent-plan-prompt/v8",
    requestedAction: "NONE", tone: null, filters: { ...NONE, topic }, target: { selector: "NONE", index: null },
  };
}

const RETURN_ASK = `${MOLDING.name} 반품 조건이 명시돼 있는지 확인해줘`;
const SPEC_ASK = `${MOLDING.name} 폭이 몇 mm인지 적혀 있는지 확인해줘`;
const PLAIN_ASK = `${MOLDING.name} 설명서에 뭐라고 적혀 있어?`;
const ROWS_ASK = "최근 문의 3개 보여줘";
const PLANS: Record<string, AgentPlanView> = {
  ...RECORDED_PLANS, ...CONVERSATION_PLANS,
  [ROWS_ASK]: {
    ...docPlan(ROWS_ASK, null), unresolvedEntities: [], specialists: ["INQUIRY_OPS"], tools: [],
    informationNeeds: [{ id: "n1", question: "최근 문의 3개", kind: "INQUIRY_VOLUME", why: "목록", required: true }],
    filters: { ...NONE, inquiryIntent: "ROWS", order: "NEWEST", limit: 3 },
  },
  [RETURN_ASK]: docPlan(RETURN_ASK, "EXCHANGE_RETURN"),
  [SPEC_ASK]: docPlan(SPEC_ASK, "PRODUCT_SPEC"),
  [PLAIN_ASK]: docPlan(PLAIN_ASK, null),
};
const FOUND: KnowledgeSearchResult = {
  productId: MOLDING.id, query: "반품 조건", documentsSearched: 1, passagesSearched: 1, outcome: "FOUND", rejectedNotApplicable: 0, candidatesTried: 1,
  passages: [{
    sourceId: "src-ret", chunkId: "chunk-ret", sourceType: "POLICY", title: "교환 및 반품 안내",
    content: "반품 조건: 수령 후 7일 이내, 미사용 상태에서만 반품이 가능합니다.", ordinal: 0, score: 1,
    authorName: "데모 운영자", sourceUrl: null, updatedAt: "2026-08-20T09:00:00Z", authoredOrigin: "SELLER_ENTERED_KNOWLEDGE", variantName: null,
  } as KnowledgeSearchResult["passages"][number]],
};

async function ask(h: Harness, text: string) {
  const view = await h.service.create(TOKEN);
  return say(h, view.conversationId, text);
}

beforeEach(() => resetJudgeCapabilityMemo());

describe("A — a closed topic filter reaches the retriever as the seller's word", () => {
  it("EXCHANGE_RETURN → topic 「교환 반품 환불」 beside the need's question; the sentence is never rewritten here", async () => {
    const h = harness({ plansByGoal: PLANS, productKnowledgeSearch: { [MOLDING.id]: FOUND } });
    const { turn } = await ask(h, RETURN_ASK);
    expect(turn.status).toBe("DONE");
    expect(h.operator.productKnowledgeQueries).toEqual([{ productId: MOLDING.id, query: NEED, topic: "교환 반품 환불" }]);
    expect(h.operator.calls.knowledgeSearch).toBe(1);
    expect(turn.message).toContain("교환 및 반품 안내");
  });
});

describe("B — no operating topic, no topic argument", () => {
  it("PRODUCT_SPEC is not a knowledge topic: the need's question goes alone", async () => {
    const h = harness({ plansByGoal: PLANS, productKnowledgeSearch: { [MOLDING.id]: FOUND } });
    await ask(h, SPEC_ASK);
    expect(h.operator.productKnowledgeQueries).toEqual([{ productId: MOLDING.id, query: NEED }]);
  });

  it("a null filter sends nothing — a question with no topic is not forced into one", async () => {
    const h = harness({ plansByGoal: PLANS, productKnowledgeSearch: { [MOLDING.id]: FOUND } });
    await ask(h, PLAIN_ASK);
    expect(h.operator.productKnowledgeQueries).toEqual([{ productId: MOLDING.id, query: NEED }]);
  });
});

describe("C — 「최근 문의 3개」 performs no retrieval", () => {
  it("knowledge 0 · policy 0 · memory 0", async () => {
    const h = harness({ plansByGoal: PLANS });
    const { turn } = await ask(h, ROWS_ASK);
    expect(turn.status).toBe("DONE");
    expect(h.operator.calls.knowledgeSearch).toBe(0);
    expect(h.operator.calls.orgKnowledgeSearch ?? 0).toBe(0);
    expect(h.operator.calls.answerMemorySearch ?? 0).toBe(0);
  });
});
