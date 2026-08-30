/**
 * Knowledge Capture / Learning Loop v1 (2026-08-30).
 *
 * Pure rules first (gap decision · question · answer classification · normalization · fingerprint · the
 * duplicate/conflict fence · 규격 naming), then the conversation cases A–L against the fake backend: the
 * seller's own sentence, shown back and saved only on a fingerprint-bound 「저장하고 계속」, through the
 * seller's own knowledge seam, then ONE resume of the original work. Writes are counted on the fake.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { TOKEN, artifact, harness, inquiries, say, W_SHIP, W_SIZE } from "./support";
import type { Harness } from "./support";
import { CONVERSATION_PLANS, RECORDED_PLANS } from "../support/recordedPlans";
import type { AgentPlanView, KnowledgeGapView, OrgKnowledgeSearchResult } from "../../src/spring/types";
import { resetJudgeCapabilityMemo } from "../../src/operator/judge/EvidenceJudge";
import { KNOWLEDGE, MOLDING, knownProduct } from "../support/operatorFixtures";
import {
  captureGapOf, classifySellerAnswer, figuresOf, fingerprintOf, judgeCandidate, normalizeContent, questionFor, titleOf, variantFromAnswer,
} from "../../src/conversation/knowledgeCapture";
import type { KnowledgeCaptureArtifact, PendingKnowledgeCapture } from "../../src/conversation/contract";

const V8 = "agent-plan-prompt/v8";
type Filters = NonNullable<AgentPlanView["filters"]>;
const NONE: Filters = { period: null, rating: null, channel: null, scope: null, topic: null, reviewIntent: null, inquiryIntent: null, limit: null, order: null, status: null };
function plan(goal: string, need: { kind: string; question: string }, specialists: string[], tools: string[], extra: Partial<AgentPlanView> = {}): AgentPlanView {
  return {
    available: true, supported: true, userGoal: goal, unresolvedEntities: [],
    informationNeeds: [{ id: "n1", question: need.question, kind: need.kind, why: "근거", required: true }],
    specialists, tools, retrievalOrder: ["n1"], retrievalParallel: [], retrievalStopWhen: null,
    evidenceRequirements: [], riskClass: "ROUTINE", maxIterations: 1, maxToolCalls: 6, stopWhenEnough: null,
    clarificationNeeded: false, clarificationReason: null, rationale: "근거 조회", providerVersion: V8,
    requestedAction: "NONE", tone: null, filters: { ...NONE }, target: { selector: "NONE", index: null }, ...extra,
  };
}
const DRAFT_ASK = "답변 준비해줘";
const POLICY_ASK = "이 문의에 우리 배송 정책 기준으로 답해줘";
const ROWS_ASK = "최근 문의 3개 보여줘";
const PLANS: Record<string, AgentPlanView> = {
  ...RECORDED_PLANS, ...CONVERSATION_PLANS,
  [DRAFT_ASK]: plan(DRAFT_ASK, { kind: "INQUIRY_VOLUME", question: "이 문의" }, ["INQUIRY_OPS"], [],
    { requestedAction: "PREPARE_INQUIRY_DRAFT", target: { selector: "THIS", index: null }, filters: { ...NONE, inquiryIntent: "WORKLOAD" } }),
  [POLICY_ASK]: plan(POLICY_ASK, { kind: "POLICY", question: "회사의 배송 기준" }, ["INQUIRY_OPS"], ["search_org_knowledge"]),
  [ROWS_ASK]: plan(ROWS_ASK, { kind: "INQUIRY_VOLUME", question: "최근 문의 3개" }, ["INQUIRY_OPS"], [], { filters: { ...NONE, inquiryIntent: "ROWS", order: "NEWEST", limit: 3 } }),
};

const GAP = (over: Partial<KnowledgeGapView>): KnowledgeGapView => ({
  productId: MOLDING.id, topic: "SHIPPING", missingSubject: null, productOutcome: "ABSENT", policyOutcome: "ABSENT",
  applicability: "NOT_VARIANT_SENSITIVE", variantId: null, policyDeclaresTopic: false, ...over,
});
const CTX = { inquiryId: "inq-ship", workItemId: W_SHIP, productId: MOLDING.id, productName: MOLDING.name, tone: null };
const NO_BASIS = { answerBasis: "NO_ANSWER_BASIS", answerBasisNote: "'배송' 관련 내용이 없습니다.", answerBasisAction: "등록된 배송 기준이 아직 없습니다. 기준을 등록하면 근거가 생깁니다." };

async function open(h: Harness) { return (await h.service.create(TOKEN)).conversationId; }
function capture(turn: Awaited<ReturnType<typeof say>>["turn"]): KnowledgeCaptureArtifact { return artifact(turn, "KNOWLEDGE_CAPTURE"); }
async function decide(h: Harness, id: string, c: KnowledgeCaptureArtifact, decision: "SAVE" | "CANCEL", fingerprint = c.fingerprint!) {
  return h.service.turn(TOKEN, id, { captureDecision: { captureId: c.captureId, fingerprint, decision } }, () => undefined);
}

describe("pure rules", () => {
  it("1. the gap is decided from the composer's verdict — ABSENT/undeclared asks; NOT_APPLICABLE never asks for the same rule", () => {
    expect(captureGapOf(GAP({}), CTX)).toMatchObject({ scope: "ORG", knowledgeType: "SHIPPING_POLICY", topicLabel: "배송" });
    expect(captureGapOf(GAP({ policyOutcome: "NO_RELEVANT_EVIDENCE", policyDeclaresTopic: false }), CTX)?.scope).toBe("ORG");
    // Rules declare the topic and still miss: not absence — no org question; no product subject either ⇒ nothing.
    expect(captureGapOf(GAP({ policyOutcome: "NO_RELEVANT_EVIDENCE", policyDeclaresTopic: true }), CTX)).toBeNull();
    // F: a rule that exists and does not apply.
    expect(captureGapOf(GAP({ policyOutcome: "NOT_APPLICABLE", policyDeclaresTopic: true }), CTX)).toBeNull();
    // …unless the question named a concrete property the product could carry an exception for.
    expect(captureGapOf(GAP({ policyOutcome: "NOT_APPLICABLE", policyDeclaresTopic: true, missingSubject: "도서산간" }), CTX))
      .toMatchObject({ scope: "PRODUCT", knowledgeType: "POLICY", missingSubject: "도서산간" });
    // A product spec question: PRODUCT scope, the customer's noun, and the 규격 requirement from the verdict.
    expect(captureGapOf(GAP({ topic: null, missingSubject: "가닥", applicability: "VARIANT_UNRESOLVED" }), CTX))
      .toMatchObject({ scope: "PRODUCT", knowledgeType: "DESCRIPTION", missingSubject: "가닥", variantRequired: true, topicLabel: "'가닥' 정보" });
    // No product bound and no topic: nothing to ask (the screen link stays).
    expect(captureGapOf(GAP({ topic: null, productId: null }), { ...CTX, productId: null })).toBeNull();
    expect(captureGapOf(null, CTX)).toBeNull();
    // Found live: 「결제하고 나서 출고까지」 names 결제 and 출고 ⇒ no single topic. The plan's POLICY gap named
    // 배송 — one of the question's own topics — so the capture is the ORG shipping rule, not a product fact.
    const two = GAP({ topic: null, topics: ["PAYMENT", "SHIPPING"] });
    expect(captureGapOf(two, CTX, "SHIPPING")).toMatchObject({ scope: "ORG", knowledgeType: "SHIPPING_POLICY" });
    // …and without that signal nothing is asked (a shipping sentence must not become a product document).
    expect(captureGapOf(two, CTX)).toBeNull();
    // A planner topic the words did not name is not taken.
    expect(captureGapOf(two, CTX, "TAX_INVOICE")).toBeNull();
    // A spec noun on an ambiguous question is still the product's own.
    expect(captureGapOf(GAP({ topic: null, topics: ["PAYMENT", "SHIPPING"], missingSubject: "가닥" }), CTX)?.scope).toBe("PRODUCT");
  });

  it("2. the question is a closed template per scope × topic", () => {
    expect(questionFor("ORG", "SHIPPING", null, null, false)).toBe("이 문의에 답하려면 일반 출고 기간 기준이 필요해요. 보통 결제 후 며칠 안에 출고하시나요?");
    expect(questionFor("ORG", "EXCHANGE_RETURN", "전선몰딩 1호", null, false)).toBe("전선몰딩 1호의 교환·반품 가능 기간 기준이 필요해요. 어떤 기준으로 안내하시나요?");
    expect(questionFor("PRODUCT", null, "전선몰딩 1호", "가닥", true)).toBe("전선몰딩 1호의 '가닥' 정보가 아직 없어요. 판매자님이 안내하는 정확한 내용은 무엇인가요? 규격에 따라 다르면 어느 규격 기준인지 함께 적어 주세요.");
  });

  it("3. the seller's sentence: cancel / question / command cues are closed; everything else is the answer", () => {
    expect(classifySellerAnswer("결제 후 보통 2~3일 안에 출고합니다.")).toBe("CANDIDATE");
    expect(classifySellerAnswer("취소")).toBe("CANCEL");
    expect(classifySellerAnswer("아니 나중에 할게")).toBe("CANCEL");
    expect(classifySellerAnswer("그게 왜 필요해?")).toBe("QUESTION");
    expect(classifySellerAnswer("최근 문의 3개 보여줘")).toBe("COMMAND");
    expect(classifySellerAnswer("조금 더 부드럽게 써줘")).toBe("COMMAND");
    expect(classifySellerAnswer("첫 번째 거")).toBe("COMMAND");
  });

  it("3b. normalization is whitespace and length only; the fingerprint binds scope · product · 규격 · type · sentence", () => {
    expect(normalizeContent("  결제 후   2~3일 안에\r\n\r\n출고합니다. ")).toBe("결제 후 2~3일 안에\n출고합니다.");
    expect(titleOf("결제 후 2~3일 안에 출고합니다.\n주말 제외")).toBe("결제 후 2~3일 안에 출고합니다.");
    const a = fingerprintOf({ scope: "ORG", productId: null, variantId: null, knowledgeType: "SHIPPING_POLICY", content: "2~3일" });
    expect(fingerprintOf({ scope: "ORG", productId: null, variantId: null, knowledgeType: "SHIPPING_POLICY", content: "2~3일" })).toBe(a);
    expect(fingerprintOf({ scope: "ORG", productId: null, variantId: null, knowledgeType: "SHIPPING_POLICY", content: "2~4일" })).not.toBe(a);
    expect(fingerprintOf({ scope: "PRODUCT", productId: "p", variantId: "v", knowledgeType: "DESCRIPTION", content: "2~3일" })).not.toBe(a);
  });

  it("6. the fence: same body = duplicate; same title or same unit with a different figure = conflict; otherwise add beside", () => {
    const existing = [{ id: "k1", title: "배송 안내", body: "결제 후 1~2일 안에 출고합니다.", type: "SHIPPING_POLICY" }];
    const scope = { type: "SHIPPING_POLICY", variantId: null, scopeKind: "ORG" as const };
    expect(judgeCandidate("결제 후  1~2일 안에 출고합니다.", "x", existing, scope)).toMatchObject({ kind: "DUPLICATE" });
    expect(judgeCandidate("결제 후 2~3일 안에 출고합니다.", "x", existing, scope)).toMatchObject({ kind: "CONFLICT", reason: "DIFFERENT_FIGURE" });
    expect(judgeCandidate("도서산간은 추가 배송비가 있습니다.", "배송 안내", existing, scope)).toMatchObject({ kind: "CONFLICT", reason: "SAME_TITLE" });
    expect(judgeCandidate("도서산간은 배송이 하루 더 걸릴 수 있습니다.", "도서산간", existing, scope)).toEqual({ kind: "OK" });
    // Another type is another scope: a return rule never conflicts with a shipping rule.
    expect(judgeCandidate("반품은 7일 이내입니다.", "반품", existing, { ...scope, type: "EXCHANGE_REFUND_POLICY" })).toEqual({ kind: "OK" });
    // A figure filed under 「공통 안내」 is still the company's figure for that unit.
    const untyped = [{ id: "k2", title: "자주 묻는 질문", body: "출고는 결제 후 1~2일입니다.", type: "GENERAL_CS_FAQ" }];
    expect(judgeCandidate("결제 후 2~3일 안에 출고합니다.", "x", untyped, scope)).toMatchObject({ kind: "CONFLICT", reason: "DIFFERENT_FIGURE" });
    expect([...figuresOf("2~3일, 3,000원").keys()]).toEqual(["일", "원"]);
  });

  it("5/H. a 규격 is named from the listing's own rows or the fact is generic on 「공통」; else unresolved", () => {
    const variants = [{ id: "v-w", name: "화이트 / 2m" }, { id: "v-b", name: "블랙 / 2m" }];
    expect(variantFromAnswer("화이트 / 2m 는 3가닥까지 들어갑니다", variants)).toMatchObject({ kind: "VARIANT", id: "v-w" });
    expect(variantFromAnswer("2m 기준 3가닥", variants)).toEqual({ kind: "UNRESOLVED" });
    expect(variantFromAnswer("모든 규격 공통으로 3가닥", variants)).toEqual({ kind: "GENERIC" });
    expect(variantFromAnswer("3가닥까지 들어갑니다", variants)).toEqual({ kind: "UNRESOLVED" });
  });
});

describe("conversation cases", () => {
  beforeEach(() => resetJudgeCapabilityMemo());

  function shippingGapHarness(over: Partial<KnowledgeGapView> = {}, seedsOver: Record<string, unknown> = {}) {
    const seeds = inquiries().map((s) => s.workItemId === W_SHIP ? { ...s, draftGeneration: { ...NO_BASIS, knowledgeGap: GAP(over) }, ...seedsOver } : s);
    return harness({ plansByGoal: PLANS }, seeds);
  }

  it("A. no shipping rule → targeted question → seller answers → candidate (write 0) → save → resumed GROUNDED draft on the same inquiry", async () => {
    const h = shippingGapHarness();
    const id = await open(h);
    const asked = await say(h, id, DRAFT_ASK, { workItemId: W_SHIP });
    expect(asked.turn.message).toBe("'배송' 관련 내용이 없습니다. 이 문의에 답하려면 일반 출고 기간 기준이 필요해요. 보통 결제 후 며칠 안에 출고하시나요?");
    expect(capture(asked.turn)).toMatchObject({ state: "ASKED", scope: "ORG", inquiryId: "inq-ship", settingsTo: "/settings/policies" });
    expect(asked.turn.status).toBe("DONE");
    expect(asked.turn.artifacts.some((a) => a.type === "HUMAN_ACTION_REQUIRED")).toBe(false);
    const pending = asked.turn.continuation.pendingCapture!;
    expect(pending).toMatchObject({ state: "ASKED", resume: { kind: "INQUIRY_DRAFT", workItemId: W_SHIP, inquiryId: "inq-ship" }, turnId: asked.turn.turnId });

    const answered = await say(h, id, "결제 후 보통 2~3일 안에 출고합니다.");
    const cand = capture(answered.turn);
    expect(cand).toMatchObject({ state: "CANDIDATE", content: "결제 후 보통 2~3일 안에 출고합니다." });
    expect(cand.fingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(answered.turn.message).toBe("이 내용을 배송 기준으로 저장할까요? 저장 전에는 아무것도 바뀌지 않습니다.");
    expect(h.inquiry.knowledgeWrites).toHaveLength(0);
    expect(answered.turn.budget).toMatchObject({ llmCalls: 0 });
    expect(h.operator.calls.plan).toBe(1);

    // After the save, the backend finds the new rule: the fake's next generate is GROUNDED and cites it.
    h.inquiry.onKnowledgeSaved = ({ id: sourceId }) => h.inquiry.draftGenerationOverride.set(W_SHIP, {
      answerBasis: "GROUNDED", comments: "안녕하세요. 결제 후 보통 2~3일 안에 출고됩니다.",
      evidence: [{ kind: "ORG_POLICY", scopeLabel: "운영 정책", title: "결제 후 보통 2~3일 안에 출고합니다.", locator: null, sourceId, chunkId: null, snippet: null }],
    });
    const saved = await decide(h, id, cand, "SAVE");
    expect(h.inquiry.knowledgeWrites).toEqual([{ scope: "ORG", knowledgeType: "SHIPPING_POLICY", title: "결제 후 보통 2~3일 안에 출고합니다.", body: "결제 후 보통 2~3일 안에 출고합니다.", variantId: null }]);
    expect(saved.message).toBe("배송 기준을 저장했습니다. 저장한 기준을 근거로 답변 초안을 다시 준비했습니다.");
    expect(capture(saved)).toMatchObject({ state: "SAVED", resume: "DRAFT_GROUNDED" });
    const draft = artifact(saved, "DRAFT");
    expect(draft).toMatchObject({ workItemId: W_SHIP, inquiryId: "inq-ship", answerBasis: "GROUNDED" });
    expect(saved.continuation.pendingCapture).toBeNull();
    expect(saved.continuation.pendingPrepared).toMatchObject({ kind: "INQUIRY_DRAFT", workItemId: W_SHIP });
    // Model calls: the planner once (the first turn) and the draft once (the resume). No planner on save.
    expect(h.operator.calls.plan).toBe(1);
    expect(h.inquiry.calls.generate).toBe(2);
    // Persisted: the thread carries no open gap and the saved turn survives reload.
    const view = await h.service.get(TOKEN, id);
    expect(view.pendingCapture).toBeNull();
    expect(view.turns.filter((t) => t.role === "USER").map((t) => t.text)).toEqual([DRAFT_ASK, "결제 후 보통 2~3일 안에 출고합니다.", "저장하고 계속"]);
  });

  it("B. cancel after the candidate → write 0, draft 0, gap closed", async () => {
    const h = shippingGapHarness();
    const id = await open(h);
    await say(h, id, DRAFT_ASK, { workItemId: W_SHIP });
    const cand = capture((await say(h, id, "결제 후 2~3일 안에 출고합니다.")).turn);
    const cancelled = await decide(h, id, cand, "CANCEL");
    expect(cancelled.message).toBe("기준 등록을 취소했습니다. 저장한 것은 없습니다.");
    expect(capture(cancelled).state).toBe("CANCELLED");
    expect(cancelled.continuation.pendingCapture).toBeNull();
    expect(h.inquiry.knowledgeWrites).toHaveLength(0);
    expect(h.inquiry.calls.generate).toBe(1);
    // A typed 「취소」 while ASKED does the same.
    const id2 = await open(h);
    await say(h, id2, DRAFT_ASK, { workItemId: W_SHIP });
    const typed = await say(h, id2, "취소");
    expect(typed.turn.continuation.pendingCapture).toBeNull();
    expect(h.inquiry.knowledgeWrites).toHaveLength(0);
  });

  it("C. a re-typed candidate replaces the old one: the old fingerprint is stale and saves nothing", async () => {
    const h = shippingGapHarness();
    const id = await open(h);
    await say(h, id, DRAFT_ASK, { workItemId: W_SHIP });
    const first = capture((await say(h, id, "결제 후 2~3일 안에 출고합니다.")).turn);
    const second = capture((await say(h, id, "결제 후 2~4일 안에 출고합니다.")).turn);
    expect(second.fingerprint).not.toBe(first.fingerprint);
    const stale = await decide(h, id, second, "SAVE", first.fingerprint!);
    expect(stale.message).toBe("이 확인은 더 이상 유효하지 않아 저장하지 않았습니다. 다시 말씀해 주시면 새로 확인하겠습니다.");
    expect(h.inquiry.knowledgeWrites).toHaveLength(0);
    // The current candidate is still on the table and saves with its own fingerprint.
    expect(stale.continuation.pendingCapture?.candidate?.fingerprint).toBe(second.fingerprint);
    await decide(h, id, second, "SAVE");
    expect(h.inquiry.knowledgeWrites.map((w) => w.body)).toEqual(["결제 후 2~4일 안에 출고합니다."]);
  });

  it("D. the same rule again → duplicate: no second row, the settings path offered", async () => {
    const h = shippingGapHarness();
    h.inquiry.orgKnowledge = [{ id: "k1", knowledgeType: "SHIPPING_POLICY", typeLabel: "배송", title: "결제 후 2~3일 안에 출고합니다.", body: "결제 후 2~3일 안에 출고합니다." }];
    const id = await open(h);
    await say(h, id, DRAFT_ASK, { workItemId: W_SHIP });
    const dup = await say(h, id, "결제 후 2~3일 안에  출고합니다.");
    expect(capture(dup.turn).state).toBe("DUPLICATE");
    expect(dup.turn.message).toBe("같은 내용의 배송 기준이 이미 등록되어 있어 다시 저장하지 않았습니다.");
    expect(dup.turn.suggestedActions).toEqual([{ label: "설정에서 직접 편집", kind: "LINK", to: "/settings/policies" }]);
    expect(dup.turn.continuation.pendingCapture).toBeNull();
    expect(h.inquiry.knowledgeWrites).toHaveLength(0);
  });

  it("E. existing 「1~2일」, new 「2~3일」 → conflict: no overwrite, the difference said, the settings path", async () => {
    const h = shippingGapHarness();
    h.inquiry.orgKnowledge = [{ id: "k1", knowledgeType: "SHIPPING_POLICY", typeLabel: "배송", title: "배송 안내", body: "결제 후 1~2일 안에 출고합니다." }];
    const id = await open(h);
    await say(h, id, DRAFT_ASK, { workItemId: W_SHIP });
    const conflict = await say(h, id, "결제 후 2~3일 안에 출고합니다.");
    const c = capture(conflict.turn);
    expect(c).toMatchObject({ state: "CONFLICT", existing: { title: "배송 안내", excerpt: "결제 후 1~2일 안에 출고합니다." } });
    expect(conflict.turn.message).toContain("기존 배송 기준과 내용이 다릅니다.");
    expect(conflict.turn.message).toContain("자동으로 덮어쓰지 않았습니다.");
    expect(h.inquiry.knowledgeWrites).toHaveLength(0);
    expect(h.inquiry.orgKnowledge[0]!.body).toBe("결제 후 1~2일 안에 출고합니다.");
  });

  it("F. NOT_APPLICABLE → no question for the same rule; the existing link stands", async () => {
    const h = shippingGapHarness({ policyOutcome: "NOT_APPLICABLE", policyDeclaresTopic: true, productOutcome: "NO_RELEVANT_EVIDENCE" });
    const id = await open(h);
    const turn = (await say(h, id, DRAFT_ASK, { workItemId: W_SHIP })).turn;
    expect(turn.artifacts.some((a) => a.type === "KNOWLEDGE_CAPTURE")).toBe(false);
    expect(artifact(turn, "HUMAN_ACTION_REQUIRED").actionType).toBe("KNOWLEDGE_ENTRY");
    expect(turn.continuation.pendingCapture ?? null).toBeNull();
    // A sentence typed now is not a candidate: there is no open gap to file it under.
    const next = await say(h, id, "결제 후 2~3일 안에 출고합니다.");
    expect(next.turn.artifacts.some((a) => a.type === "KNOWLEDGE_CAPTURE")).toBe(false);
    expect(h.inquiry.knowledgeWrites).toHaveLength(0);
  });

  it("G. a product-specific gap binds the fact to that product exactly — no other product, no org rule", async () => {
    const h = shippingGapHarness({ topic: null, missingSubject: "가닥", productOutcome: "ABSENT", policyOutcome: "ABSENT" });
    const id = await open(h);
    const asked = await say(h, id, DRAFT_ASK, { workItemId: W_SHIP });
    expect(capture(asked.turn)).toMatchObject({ scope: "PRODUCT", productId: MOLDING.id, topicLabel: "'가닥' 정보", settingsTo: `/products/${MOLDING.id}` });
    const cand = capture((await say(h, id, "전선 3가닥까지 들어갑니다.")).turn);
    await decide(h, id, cand, "SAVE");
    expect(h.inquiry.knowledgeWrites).toEqual([{ scope: "PRODUCT", productId: MOLDING.id, knowledgeType: "DESCRIPTION", title: "전선 3가닥까지 들어갑니다.", body: "전선 3가닥까지 들어갑니다.", variantId: null }]);
    expect(h.inquiry.orgKnowledge).toHaveLength(0);
  });

  it("H. a 규격-dependent fact with the 규격 unresolved is not saved as generic: the agent asks which one, then binds it", async () => {
    const withIds = { ...KNOWLEDGE, [MOLDING.id]: { ...knownProduct(), variants: knownProduct().variants.map((v, i) => ({ ...v, id: `v-${i + 1}` })) } };
    const seeds = inquiries().map((s) => s.workItemId === W_SHIP ? { ...s, draftGeneration: { ...NO_BASIS, knowledgeGap: GAP({ topic: null, missingSubject: "가닥", applicability: "VARIANT_UNRESOLVED" }) } } : s);
    const h = harness({ plansByGoal: PLANS, knowledge: withIds }, seeds);
    const id = await open(h);
    const asked = await say(h, id, DRAFT_ASK, { workItemId: W_SHIP });
    expect(asked.turn.message).toContain("규격에 따라 다르면 어느 규격 기준인지 함께 적어 주세요.");
    const generic = await say(h, id, "3가닥까지 들어갑니다.");
    expect(generic.turn.artifacts.some((a) => a.type === "KNOWLEDGE_CAPTURE")).toBe(false);
    expect(generic.turn.message).toBe("어느 규격의 기준인지 함께 적어 주세요 (예: 화이트 / 2m · 블랙 / 2m). 모든 규격이 같다면 「공통」이라고 적어 주시면 됩니다.");
    expect(generic.turn.continuation.pendingCapture?.state).toBe("ASKED");
    const cand = capture((await say(h, id, "블랙 / 2m 는 3가닥까지 들어갑니다.")).turn);
    expect(cand).toMatchObject({ state: "CANDIDATE", variantName: "블랙 / 2m" });
    await decide(h, id, cand, "SAVE");
    expect(h.inquiry.knowledgeWrites[0]).toMatchObject({ scope: "PRODUCT", productId: MOLDING.id, variantId: "v-2" });
  });

  it("H2. a listing with no variant rows: the whole listing is the only scope, so the fact proceeds as generic", async () => {
    const h = shippingGapHarness({ topic: null, missingSubject: "가닥", applicability: "VARIANT_UNRESOLVED" });
    const id = await open(h);
    await say(h, id, DRAFT_ASK, { workItemId: W_SHIP });
    const cand = capture((await say(h, id, "최대 3가닥까지 들어갑니다.")).turn);
    expect(cand).toMatchObject({ state: "CANDIDATE", variantName: null });
    await decide(h, id, cand, "SAVE");
    expect(h.inquiry.knowledgeWrites[0]).toMatchObject({ scope: "PRODUCT", variantId: null });
  });

  it("I. reload before the seller answers → the gap is still open; the next sentence is captured normally", async () => {
    const h = shippingGapHarness();
    const id = await open(h);
    await say(h, id, DRAFT_ASK, { workItemId: W_SHIP });
    const reloaded = await h.service.get(TOKEN, id);
    expect(reloaded.pendingCapture).toMatchObject({ state: "ASKED", inquiryId: "inq-ship" });
    expect(reloaded.turns[reloaded.turns.length - 1]!.continuation.pendingCapture?.captureId).toBe(reloaded.pendingCapture!.captureId);
    const cand = capture((await say(h, id, "결제 후 2~3일 안에 출고합니다.")).turn);
    expect(cand.captureId).toBe(reloaded.pendingCapture!.captureId);
  });

  it("I2. moving to another inquiry drops the open gap — a stale question never files under another customer's case", async () => {
    const h = shippingGapHarness();
    const id = await open(h);
    await say(h, id, DRAFT_ASK, { workItemId: W_SHIP });
    // The planner turn about a DIFFERENT inquiry anchors it; the shipping gap for inq-ship is dropped.
    const other = await say(h, id, DRAFT_ASK, { workItemId: W_SIZE });
    expect(other.turn.continuation.pendingCapture ?? null).toBeNull();
    const next = await say(h, id, "결제 후 2~3일 안에 출고합니다.");
    expect(next.turn.artifacts.some((a) => a.type === "KNOWLEDGE_CAPTURE")).toBe(false);
    expect(h.inquiry.knowledgeWrites).toHaveLength(0);
  });

  it("J. the inquiry was answered meanwhile → the fact is saved as approved, no draft, no model call", async () => {
    const h = shippingGapHarness();
    const id = await open(h);
    await say(h, id, DRAFT_ASK, { workItemId: W_SHIP });
    const cand = capture((await say(h, id, "결제 후 2~3일 안에 출고합니다.")).turn);
    h.inquiry.markAnswered(W_SHIP);
    const generateBefore = h.inquiry.calls.generate;
    const saved = await decide(h, id, cand, "SAVE");
    expect(h.inquiry.knowledgeWrites).toHaveLength(1);
    expect(saved.message).toBe("배송 기준을 저장했습니다. 이 문의는 이미 처리되어 기준만 저장했습니다.");
    expect(capture(saved)).toMatchObject({ state: "SAVED", resume: "INQUIRY_NOT_ACTIONABLE" });
    expect(saved.artifacts.some((a) => a.type === "DRAFT")).toBe(false);
    expect(h.inquiry.calls.generate).toBe(generateBefore);
    expect(saved.continuation.pendingPrepared).toBeNull();
  });

  it("A2. saved but still not enough for this question → said honestly, no injection, no second question", async () => {
    const h = shippingGapHarness();
    const id = await open(h);
    await say(h, id, DRAFT_ASK, { workItemId: W_SHIP });
    const cand = capture((await say(h, id, "도서산간은 하루 더 걸립니다.")).turn);
    const saved = await decide(h, id, cand, "SAVE");
    expect(h.inquiry.knowledgeWrites).toHaveLength(1);
    expect(saved.message).toBe("배송 기준을 저장했습니다. 기준을 저장했지만 이 문의에 바로 적용할 근거로는 아직 부족합니다. '배송' 관련 내용이 없습니다.");
    expect(capture(saved).resume).toBe("DRAFT_STILL_GAP");
    expect(saved.artifacts.filter((a) => a.type === "KNOWLEDGE_CAPTURE")).toHaveLength(1);
    expect(saved.continuation.pendingCapture).toBeNull();
  });

  it("K. the agent lane: a missing rule is asked for; the save re-runs the original request ONCE and opens no new gap", async () => {
    const absent: OrgKnowledgeSearchResult = { query: "", documentsSearched: 0, passagesSearched: 0, passages: [], outcome: "ABSENT", rejectedNotApplicable: 0, candidatesTried: 1 };
    const h = harness({ plansByGoal: PLANS, orgKnowledgeSearch: absent });
    const id = await open(h);
    const asked = await say(h, id, POLICY_ASK);
    const pending = asked.turn.continuation.pendingCapture as PendingKnowledgeCapture;
    expect(pending).toMatchObject({ scope: "ORG", resume: { kind: "GOAL", turnId: asked.turn.turnId } });
    const cand = capture((await say(h, id, "결제 후 2~3일 안에 출고합니다.")).turn);
    const plansBefore = h.operator.calls.plan;
    const resumed = await decide(h, id, cand, "SAVE");
    expect(h.inquiry.knowledgeWrites).toHaveLength(1);
    expect(resumed.resumedFrom).toBe(asked.turn.turnId);
    expect(resumed.message.startsWith("배송 기준을 저장했습니다. 저장한 기준으로 원래 요청을 다시 확인합니다.")).toBe(true);
    expect(resumed.artifacts[0]).toMatchObject({ type: "KNOWLEDGE_CAPTURE", state: "SAVED", resume: "PENDING_RESUME" });
    // One re-run, and — the fake still answers ABSENT — no second question on the same breath.
    expect(h.operator.calls.plan).toBe(plansBefore + 1);
    expect(resumed.artifacts.filter((a) => a.type === "KNOWLEDGE_CAPTURE" && a.state === "ASKED")).toHaveLength(0);
    // …and no 「등록하면 답할 수 있습니다」 link beside the rule just saved.
    expect(resumed.artifacts.some((a) => a.type === "HUMAN_ACTION_REQUIRED")).toBe(false);
    expect(resumed.continuation.pendingCapture ?? null).toBeNull();
  });

  it("K2. what can never be a capture source: the customer's sentence, an AI draft, an assistant message — the writer sees only the confirmed candidate", async () => {
    const h = shippingGapHarness();
    const id = await open(h);
    const asked = await say(h, id, DRAFT_ASK, { workItemId: W_SHIP });
    const cand = capture((await say(h, id, "결제 후 2~3일 안에 출고합니다.")).turn);
    await decide(h, id, cand, "SAVE");
    const written = h.inquiry.knowledgeWrites[0]!.body;
    expect(written).toBe("결제 후 2~3일 안에 출고합니다.");
    expect(written).not.toContain("주문했는데 택배가 아직이에요");
    expect(written).not.toContain(asked.turn.message.slice(0, 20));
  });

  it("L. 「최근 문의 3개」 → capture 0, knowledge write 0, retrieval 0", async () => {
    const h = harness({ plansByGoal: PLANS });
    const id = await open(h);
    const rows = await say(h, id, ROWS_ASK);
    expect(rows.turn.artifacts.some((a) => a.type === "KNOWLEDGE_CAPTURE")).toBe(false);
    expect(rows.turn.continuation.pendingCapture ?? null).toBeNull();
    expect(h.inquiry.knowledgeWrites).toHaveLength(0);
    expect(h.operator.calls.knowledgeSearch + h.operator.calls.orgKnowledgeSearch + h.operator.calls.answerMemorySearch).toBe(0);
    expect(h.inquiry.methodCalls.some((c) => /Knowledge/.test(c.method))).toBe(false);
  });
});
