/**
 * Knowledge Context v1-A — the Agent lane reaches the company's own rules, and no path says a rule
 * exists (or does not) without reading.
 *
 * Before this package the POLICY branch was one fixed sentence — 「판매 정책은 SellerOps가 아직 보관하고
 * 있지 않아 확인할 수 없습니다」 — printed whether or not the org had written its shipping policy. The
 * store existed; the Agent lane could not reach it. Now a POLICY need reads `/api/org-knowledge/search`
 * on the turn that declares it (never folded into a prompt), quotes the seller's own passage when one
 * covers the question, and otherwise names the gap with the seller's noun and the screen that closes it.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { TOKEN, W_SHIP, artifact, harness, say } from "./support";
import type { Harness } from "./support";
import { CONVERSATION_PLANS, RECORDED_PLANS } from "../support/recordedPlans";
import type { AgentPlanView, OrgKnowledgeSearchResult } from "../../src/spring/types";
import { resetJudgeCapabilityMemo } from "../../src/operator/judge/EvidenceJudge";
import { evidenceSummaryOf } from "../../src/conversation/DraftPreparer";
import { digestFor } from "../../src/operator/state/evidence";
import { RuleBasedDraftProvider } from "../../src/provider/DraftModelSeam";
import { reachableToolNames } from "../../src/operator/tools/ToolReachability";

const V6 = "agent-plan-prompt/v6";
type Filters = NonNullable<AgentPlanView["filters"]>;
const NONE: Filters = {
  period: null, rating: null, channel: null, scope: null, topic: null, reviewIntent: null,
  inquiryIntent: null, limit: null, order: null, status: null,
};

function policyPlan(goal: string, filters: Partial<Filters> = {}): AgentPlanView {
  return {
    available: true, supported: true, userGoal: goal, unresolvedEntities: [],
    informationNeeds: [{ id: "n1", question: "회사의 배송 기준이 무엇인가", kind: "POLICY", why: "회사 기준이 답이다", required: true }],
    specialists: ["INQUIRY_OPS"], tools: ["search_org_knowledge"], retrievalOrder: ["n1"], retrievalParallel: [],
    retrievalStopWhen: null, evidenceRequirements: [{ needId: "n1", minEvidence: 1, acceptableKinds: ["POLICY"] }],
    riskClass: "SENSITIVE", maxIterations: 1, maxToolCalls: 4,
    stopWhenEnough: null, clarificationNeeded: false, clarificationReason: null, rationale: "정책 질문",
    providerVersion: V6, requestedAction: "NONE", tone: null, filters: { ...NONE, ...filters }, target: { selector: "NONE", index: null },
  };
}

function draftPlan(goal: string): AgentPlanView {
  return {
    ...policyPlan(goal),
    informationNeeds: [{ id: "n1", question: "이 문의에 답할 근거", kind: "INQUIRY_VOLUME", why: "초안", required: false }],
    tools: [], evidenceRequirements: [], filters: { ...NONE, inquiryIntent: "WORKLOAD" },
    requestedAction: "PREPARE_INQUIRY_DRAFT", target: { selector: "THIS", index: null },
  };
}

const SHIPPING: OrgKnowledgeSearchResult = {
  query: "", documentsSearched: 2, passagesSearched: 3,
  passages: [{
    sourceId: "src-ship", chunkId: "chunk-ship", knowledgeType: "SHIPPING_POLICY", title: "배송 안내",
    content: "영업일 기준 2일 이내 출고되며 배송비는 3,000원입니다. 도서산간은 추가 비용이 있습니다.",
    ordinal: 0, score: 0.8, authorName: "데모 운영자", sourceUrl: null, version: 1, updatedAt: "2026-08-20T09:00:00Z",
  }],
};

const ASK = "우리 배송 정책 뭐였지?";
const ASK_DRAFT = "이 문의에 우리 배송 정책 기준으로 답변해줘";
const RECENT3 = "최근 문의 3개 보여줘";
const recentRowsPlan: AgentPlanView = {
  ...policyPlan(RECENT3), riskClass: "ROUTINE", tools: [], evidenceRequirements: [],
  informationNeeds: [{ id: "n1", question: "최근 문의 3개", kind: "INQUIRY_VOLUME", why: "목록이 질문이다", required: true }],
  filters: { ...NONE, inquiryIntent: "ROWS", order: "NEWEST", limit: 3 },
};
const PLANS = { ...RECORDED_PLANS, ...CONVERSATION_PLANS, [ASK]: policyPlan(ASK), [ASK_DRAFT]: draftPlan(ASK_DRAFT), [RECENT3]: recentRowsPlan };

/** Open a conversation on the harness, then send one sentence into it. */
async function ask(h: Harness, text: string, extra: Record<string, unknown> = {}) {
  const view = await h.service.create(TOKEN);
  return say(h, view.conversationId, text, extra);
}

describe("Knowledge Context v1-A — org policy in the Agent lane", () => {
  beforeEach(() => resetJudgeCapabilityMemo());

  it("A. a registered shipping policy is quoted as the seller's own — one org-knowledge read, zero product reads", async () => {
    const h: Harness = harness({ plansByGoal: PLANS, orgKnowledgeSearch: SHIPPING });
    const { turn } = await ask(h, ASK);
    expect(turn.status).toBe("DONE");
    expect(turn.message).toContain("판매자가 등록한 배송 기준 \"배송 안내\"에 이렇게 적혀 있습니다");
    expect(turn.message).toContain("영업일 기준 2일 이내 출고");
    expect(turn.message).not.toContain("보관하고 있지 않아");
    expect(h.operator.calls.orgKnowledgeSearch).toBe(1);
    // The query is the seller's noun, not the sentence — the lexical retriever's absence gate needs it.
    expect(h.operator.orgKnowledgeQueries).toEqual(["배송"]);
    expect(h.operator.calls.knowledgeSearch).toBe(0);
    expect(h.operator.calls.memory).toBe(0);
    expect(turn.artifacts.some((a) => a.type === "HUMAN_ACTION_REQUIRED")).toBe(false);
    const ev = turn.answer!.evidence.find((e) => e.kind === "ORG_POLICY")!;
    expect(ev.locator.label).toBe("배송 안내");
    expect(ev.provenance).toBe("org-knowledge/SHIPPING_POLICY:v1");
  });

  it("B. no policy registered → the gap in the seller's noun + a KNOWLEDGE_ENTRY step to the rules screen, never 「보관하고 있지 않아」", async () => {
    const h = harness({ plansByGoal: PLANS });
    const { turn } = await ask(h, ASK);
    expect(turn.message).toContain("등록된 배송 기준이 아직 없습니다.");
    expect(turn.message).not.toContain("보관하고 있지 않아");
    const step = artifact(turn, "HUMAN_ACTION_REQUIRED");
    expect(step.actionType).toBe("KNOWLEDGE_ENTRY");
    expect(step.to).toBe("/settings/policies");
    expect(step.title).toBe("배송 기준을 등록하면 답할 수 있습니다");
    // Offered, not required: nothing can resume this turn, so it does not wait on the seller.
    expect(turn.status).toBe("DONE");
    expect(h.operator.calls.orgKnowledgeSearch).toBe(1);
  });

  it("B2. rules registered but none about shipping → says which noun is missing, not that nothing exists", async () => {
    const h = harness({ plansByGoal: PLANS, orgKnowledgeSearch: { ...SHIPPING, passages: [] } });
    const { turn } = await ask(h, ASK);
    expect(turn.message).toContain("등록된 운영 기준 중 배송에 해당하는 내용이 아직 없습니다.");
    expect(artifact(turn, "HUMAN_ACTION_REQUIRED").actionType).toBe("KNOWLEDGE_ENTRY");
  });

  it("A2. a planner that named PRODUCT_OPS and a product mention for a policy-only question is routed deterministically — no clarification", async () => {
    const misrouted: AgentPlanView = {
      ...policyPlan(ASK), specialists: ["PRODUCT_OPS"], tools: ["resolve_product"],
      unresolvedEntities: [{ kind: "PRODUCT", mention: "우리" }],
    };
    const h = harness({ plansByGoal: { ...PLANS, [ASK]: misrouted }, orgKnowledgeSearch: SHIPPING });
    const { turn } = await ask(h, ASK);
    expect(turn.status).toBe("DONE");
    expect(turn.message).not.toContain("어떤 상품을 묻는지");
    expect(turn.message).toContain("영업일 기준 2일 이내 출고");
    expect(h.operator.calls.orgKnowledgeSearch).toBe(1);
    expect(h.operator.calls.products).toBe(0);
  });

  it("policyRouted: POLICY ⇒ INQUIRY_OPS runs; POLICY-only ⇒ INQUIRY_OPS alone (no product clarification, no report restatement)", async () => {
    const { policyRouted } = await import("../../src/operator/graph/operatorGraph");
    const needs = (kinds: string[]) => ({ informationNeeds: kinds.map((kind, i) => ({ id: `n${i}`, question: "q", kind, why: "w", required: true })) as never });
    expect(policyRouted(["PRODUCT_OPS"], needs(["POLICY"]))).toEqual(["INQUIRY_OPS"]);
    expect(policyRouted(["REPORT_OPS"], needs(["POLICY"]))).toEqual(["INQUIRY_OPS"]);
    expect(policyRouted(["PRODUCT_OPS"], needs(["POLICY", "PRODUCT_FACT"]))).toEqual(["PRODUCT_OPS", "INQUIRY_OPS"]);
    expect(policyRouted(["PRODUCT_OPS"], needs(["PRODUCT_FACT"]))).toEqual(["PRODUCT_OPS"]);
  });

  it("the source of a POLICY need is a reachable READ tool the planner is shown", () => {
    expect(reachableToolNames()).toContain("search_org_knowledge");
  });

  it("the fixed policy denial is gone from the runtime", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../../src/operator/graph/inquiryOps.ts", import.meta.url), "utf8");
    const code = src.split("\n").filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join("\n");
    expect(code).not.toContain("보관하고 있지 않아");
    expect(code).not.toContain("policy-store/UNAVAILABLE");
  });
});

describe("Knowledge Context v1-A — the draft lane stays authoritative", () => {
  beforeEach(() => resetJudgeCapabilityMemo());

  it("C/D. 「이 문의에 우리 배송 정책 기준으로 답변해줘」 goes through InquiryDraftComposer and reports its lanes as counts only", async () => {
    const seeds = (await import("./support")).inquiries().map((s) => s.workItemId === W_SHIP
      ? { ...s, draftGeneration: { comments: "영업일 기준 2일 이내 출고됩니다.", evidence: [
        { kind: "ORG_KNOWLEDGE", scopeLabel: "운영 정책", title: "배송 안내", locator: "org/1", sourceId: "s1", chunkId: "c1", snippet: "영업일 기준 2일 이내 출고" },
        { kind: "PRODUCT_KNOWLEDGE", scopeLabel: "상품 정보", title: "포장 안내", locator: "pk/1", sourceId: "s2", chunkId: "c2", snippet: "개별 포장" },
        { kind: "PRODUCT_KNOWLEDGE", scopeLabel: "상품 정보", title: "규격", locator: "pk/2", sourceId: "s3", chunkId: "c3", snippet: "16x10mm" },
      ] } }
      : s);
    const h = harness({ plansByGoal: PLANS }, seeds);
    const { turn } = await ask(h, ASK_DRAFT, { workItemId: W_SHIP });
    const draft = artifact(turn, "DRAFT");
    expect(draft.answerBasis).toBe("GROUNDED");
    expect(draft.evidenceCount).toBe(3);
    expect(draft.evidenceSummary).toEqual([{ scopeLabel: "상품 정보", count: 2 }, { scopeLabel: "운영 정책", count: 1 }]);
    // The backend composed the sentence; the runtime did not assemble a policy of its own.
    expect(h.inquiry.calls.generate).toBe(1);
    expect(h.operator.calls.orgKnowledgeSearch).toBe(0);
    // Counts only — no lane text reaches the artifact.
    expect(JSON.stringify(draft)).not.toContain("16x10mm");
    expect(JSON.stringify(draft)).not.toContain("snippet");
  });

  it("evidenceSummaryOf counts by the backend's lane word, in lane order, and never carries text", () => {
    expect(evidenceSummaryOf([
      { scopeLabel: "과거 답변", snippet: "x" }, { scopeLabel: "주문 상태" }, { scopeLabel: "운영 정책" },
      { scopeLabel: "상품 정보" }, { scopeLabel: "상품 정보" }, { nothing: true }, null,
    ])).toEqual([
      { scopeLabel: "상품 정보", count: 2 }, { scopeLabel: "운영 정책", count: 1 },
      { scopeLabel: "과거 답변", count: 1 }, { scopeLabel: "주문 상태", count: 1 },
    ]);
    expect(evidenceSummaryOf(undefined)).toEqual([]);
  });
});

describe("Knowledge Context v1-A — what leaves for the judge, and what does not", () => {
  it("an evidence digest carries the document title, never the passage body", () => {
    const digest = digestFor([{
      evidenceId: "e1", kind: "PRODUCT_KNOWLEDGE_DOC", sourceTool: "search_product_knowledge", args: {},
      locator: { productId: "p1", productName: "몰딩", facet: "FAQ", label: "접착 안내", title: "접착 안내" },
      asOf: "2026-08-20", coverage: "COVERED", provenance: "product-knowledge-library/FAQ",
    } as never]);
    expect(digest).toContain("label=접착안내");
    expect(digest).not.toContain("가닥");
  });

  it("G. 「최근 문의 3개 보여줘」 reads inquiry rows and no knowledge lane at all (query-accuracy regression)", async () => {
    const h = harness({ plansByGoal: PLANS });
    const { turn } = await ask(h, RECENT3);
    expect(turn.status).toBe("DONE");
    expect(artifact(turn, "INQUIRY_LIST")).toBeTruthy();
    expect(h.operator.calls.orgKnowledgeSearch).toBe(0);
    expect(h.operator.calls.knowledgeSearch).toBe(0);
    expect(h.operator.calls.memory).toBe(0);
    expect(h.inquiry.calls.generate).toBe(0);
  });
});

describe("Knowledge Context v1-A — the legacy rule drafter cannot promise", () => {
  it("F. the rule provider yields no text and a NO_ANSWER_BASIS marker for a shipping question", () => {
    const c = new RuleBasedDraftProvider().draftNow({ title: "배송 언제 오나요", details: null, status: "UNANSWERED", informStatus: null });
    expect(c.comments).toBe("");
    expect(c.answerBasis).toBe("NO_ANSWER_BASIS");
    expect(c.category).toBe("delivery_status_reply");
  });
});
