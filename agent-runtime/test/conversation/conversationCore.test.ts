/**
 * Conversation Core v1 — the two PO-QA failures (2026-08-31), reproduced and closed.
 *
 * <b>Failure 1.</b> 「최근 문의 5개」 → 「배송 관련 문의만 봐줘」 answered with the SAME five rows: the
 * planner's `filters.topic` died at the ROWS step (no topic axis), and no deterministic filter lane
 * existed. Now the sentence is a deterministic FILTER over the visible set (plan 0, re-read 0), and a
 * topic that reaches the planner path is applied by the ROWS step itself.
 *
 * <b>Failure 2.</b> 「이 고객한테 뭐라고 답하면 좋을까?」 over a selected ANSWERED inquiry was read as
 * PREPARE and refused by the actionability gate — the conversation dead-ended. Now it is ANALYZE:
 * the state is a fact, the advice comes from the seller's own corpus, and only the imperative
 * 「답변 준비해줘」 meets the gate.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearLogSink, getLogSink } from "../../src/log";
import { TODAY, TOKEN, artifact, harness, say } from "./support";
import type { Harness } from "./support";
import { CONVERSATION_PLANS, RECORDED_PLANS } from "../support/recordedPlans";
import type { AgentPlanView } from "../../src/spring/types";
import type { SeedInquiry } from "../support/FakeSpringClient";
import { resetJudgeCapabilityMemo } from "../../src/operator/judge/EvidenceJudge";

const V4 = "agent-plan-prompt/v4";
type Filters = NonNullable<AgentPlanView["filters"]>;
const NONE: Filters = {
  period: null, rating: null, channel: null, scope: null, topic: null, reviewIntent: null,
  inquiryIntent: null, limit: null, order: null, status: null,
};

function rowsPlan(goal: string, filters: Partial<Filters>): AgentPlanView {
  return {
    available: true, supported: true, userGoal: goal, unresolvedEntities: [],
    informationNeeds: [{ id: "n1", question: goal, kind: "INQUIRY_VOLUME", why: "목록이 질문이다", required: true }],
    specialists: ["INQUIRY_OPS"], tools: [], retrievalOrder: ["n1"], retrievalParallel: [],
    retrievalStopWhen: null, evidenceRequirements: [], riskClass: "ROUTINE", maxIterations: 1, maxToolCalls: 8,
    stopWhenEnough: null, clarificationNeeded: false, clarificationReason: null, rationale: "목록",
    providerVersion: V4, requestedAction: "NONE", tone: null, filters: { ...NONE, ...filters }, target: { selector: "NONE", index: null },
  };
}

const NAVER = { sellerAccountId: "acct-naver", channelId: "chan-naver", channelCode: "NAVER", channelNameKo: "네이버" } as const;
const CAFE24 = { sellerAccountId: "acct-cafe24-1", channelId: "chan-cafe24", channelCode: "CAFE24", channelNameKo: "카페24" } as const;

/** Five inquiries: two shipping-titled, one shipping only in its BODY, two unrelated; one answered. */
function seeds(): { open: SeedInquiry[]; answered: SeedInquiry[] } {
  const open: SeedInquiry[] = [
    { workItemId: "w-s1", inquiryId: "i-s1", ...NAVER, title: "배송 언제 되나요", details: "주문한 상품 배송 일정 문의", receivedAt: `${TODAY}T05:00:00Z` },
    { workItemId: "w-s2", inquiryId: "i-s2", ...CAFE24, title: "택배가 아직 안 왔어요", details: "…", receivedAt: `${TODAY}T04:00:00Z` },
    { workItemId: "w-body", inquiryId: "i-body", ...CAFE24, title: "주문 관련 질문", details: "발송이 언제 되는지 알고 싶습니다", receivedAt: `${TODAY}T03:00:00Z` },
    { workItemId: "w-x1", inquiryId: "i-x1", ...NAVER, title: "규격이 어떻게 되나요", details: "…", receivedAt: `${TODAY}T02:00:00Z` },
  ];
  const answered: SeedInquiry[] = [
    { workItemId: "w-a1", inquiryId: "i-a1", ...NAVER, title: "배송비는 얼마인가요", details: "…", receivedAt: `${TODAY}T01:00:00Z`, status: "ANSWERED" },
  ];
  return { open, answered };
}

const PLANS: Record<string, AgentPlanView> = {
  ...RECORDED_PLANS, ...CONVERSATION_PLANS,
  "최근 문의 5개 보여줘": rowsPlan("최근 문의 5개", { inquiryIntent: "ROWS", order: "NEWEST", limit: 5 }),
  // A semantic phrasing the deterministic grammar declines (「얘기」 is a leftover) — the planner's topic.
  "그중 배송 얘기만 볼래": rowsPlan("방금 본 문의 중 배송 관련만", { inquiryIntent: "ROWS", scope: "WORKING_SET", topic: "SHIPPING" }),
  // The contaminated shape observed live 2026-08-31: on a NAVER/UNANSWERED set the planner marked an
  // explicit new-list sentence a follow-up AND copied the set's axes into filters. The runtime must
  // void the refine (NEW_LIMIT) and drop the copied base with it.
  "최근 문의 7개 보여줘": rowsPlan("최근 문의 7개", {
    inquiryIntent: "ROWS", scope: "WORKING_SET", order: "NEWEST", limit: 7, channel: "NAVER", status: "UNANSWERED",
  }),
  // The anchored variant: the base the planner copied is the set's channel alone.
  "최근 문의 7개 볼래": rowsPlan("최근 문의 7개", {
    inquiryIntent: "ROWS", scope: "WORKING_SET", order: "NEWEST", limit: 7, channel: "NAVER",
  }),
};

async function fresh(): Promise<{ h: Harness; id: string }> {
  const { open, answered } = seeds();
  const h = harness({ plansByGoal: PLANS }, open);
  h.inquiry.answeredSeeds.push(...answered);
  const view = await h.service.create(TOKEN);
  return { h, id: view.conversationId };
}
const ids = (turn: Awaited<ReturnType<typeof say>>["turn"]) =>
  artifact(turn, "INQUIRY_LIST").groups.flatMap((g) => g.items.map((i) => i.inquiryId));

beforeEach(() => resetJudgeCapabilityMemo());

describe("FILTER — 「배송 관련 문의만 봐줘」 narrows to the shipping subset (failure 1)", () => {
  it("deterministic over the visible set: shipping rows only, body matched by bounded detail reads, plan 0", async () => {
    const { h, id } = await fresh();
    const first = await say(h, id, "최근 문의 5개 보여줘");
    expect(ids(first.turn)).toEqual(["i-s1", "i-s2", "i-body", "i-x1", "i-a1"]);
    const plans = h.operator.calls.plan;
    const reads = h.inquiry.rowsParams.length;

    const { turn } = await say(h, id, "배송 관련 문의만 봐줘");
    // The exact PO failure: the same five rows again. The subset — and only the subset — must return.
    expect(ids(turn)).toEqual(["i-s1", "i-s2", "i-body", "i-a1"]);
    expect(h.operator.calls.plan).toBe(plans);
    expect(h.inquiry.rowsParams).toHaveLength(reads);
    expect(turn.budget?.llmCalls).toBe(0);
    // 「i-body」 has no shipping word in its title — one bounded detail read found it in the body.
    expect(h.inquiry.methodCalls.filter((c) => c.method === "getInquiryDetail" && c.workItemId === "w-body")).toHaveLength(1);
    expect(turn.message).toContain("배송 관련");
    expect(turn.continuation.workingSet?.ids).toEqual(["i-s1", "i-s2", "i-body", "i-a1"]);
    expect(turn.continuation.workingSet?.filters.topic).toBe("SHIPPING");
  });

  it("the planner path applies a topic too: a WORKING_SET plan with filters.topic narrows the re-read (rows step)", async () => {
    const { h, id } = await fresh();
    await say(h, id, "최근 문의 5개 보여줘");
    const { turn } = await say(h, id, "그중 배송 얘기만 볼래");
    // Title/product matching on the planner path (no bounded detail reads there): the two titled rows
    // and the answered one — never the same five rows back.
    expect(ids(turn)).toEqual(["i-s1", "i-s2", "i-a1"]);
    expect(turn.message).toContain("배송 관련");
  });

  it("chained refines stand on the filtered set: 「그중 네이버 것만」 → the NAVER shipping rows", async () => {
    const { h, id } = await fresh();
    await say(h, id, "최근 문의 5개 보여줘");
    await say(h, id, "배송 관련 문의만 봐줘");
    const { turn } = await say(h, id, "그중 네이버 것만");
    expect(ids(turn)).toEqual(["i-s1", "i-a1"]);
    expect(turn.budget?.llmCalls).toBe(0);
  });
});

describe("New-list Scope Integrity — an explicit new LIST never inherits the visible set's axes (§9)", () => {
  beforeEach(() => { getLogSink(); });
  afterEach(() => clearLogSink());

  it("5개 → 「네이버 것만」 → 「답변 안 한 것만」 → 「최근 문의 7개 보여줘」 = the org's recent 7, no channel/status carry-over", async () => {
    const { h, id } = await fresh();
    await say(h, id, "최근 문의 5개 보여줘");
    const naver = await say(h, id, "네이버 것만");
    expect(ids(naver.turn)).toEqual(["i-s1", "i-x1", "i-a1"]);
    const unanswered = await say(h, id, "답변 안 한 것만");
    expect(ids(unanswered.turn)).toEqual(["i-s1", "i-x1"]);

    const { turn } = await say(h, id, "최근 문의 7개 보여줘");
    // The live defect answered 「네이버 답변 안 한 가장 최근 7건 = 2건」 here. The refine is void
    // (7 > 2) and the copied base goes with it: an org-wide recent read, nothing NAVER, nothing
    // UNANSWERED-only — the answered row is in the list.
    expect(ids(turn)).toEqual(["i-s1", "i-s2", "i-body", "i-x1", "i-a1"]);
    const read = h.inquiry.rowsParams.at(-1)!;
    expect(read.channel).toBeUndefined();
    expect(read.status).toBe("ALL");
    expect(read.limit).toBe(7);
    expect(turn.message).not.toContain("방금 본");
    expect(turn.message).not.toContain("네이버");
    const override = getLogSink().find((r) => r.event === "operator_scope_override");
    expect(override?.meta.reason).toBe("NEW_LIMIT");
    // The planner was told the set's axes describe the screen, not the next sentence.
    expect(h.operator.planPriorContexts.at(-1)).toContain("집합 규칙");
    expect(h.operator.planPriorContexts.at(-1)).toContain("복사하지 마세요");
  });

  it("the counter-chain still refines: 5개 → 「네이버 것만」 → 「그중 최근 2개」 = the NAVER subset's 2, LLM 0", async () => {
    const { h, id } = await fresh();
    await say(h, id, "최근 문의 5개 보여줘");
    const plans = h.operator.calls.plan;
    await say(h, id, "네이버 것만");
    const { turn } = await say(h, id, "그중 최근 2개");
    expect(ids(turn)).toEqual(["i-s1", "i-x1"]);
    expect(turn.budget?.llmCalls).toBe(0);
    expect(h.operator.calls.plan).toBe(plans);
    expect(turn.message).toContain("방금 본");
  });

  it("a selected inquiry does not contaminate the new list either — the fresh read drops the anchor with the set", async () => {
    const { h, id } = await fresh();
    await say(h, id, "최근 문의 5개 보여줘");
    await say(h, id, "네이버 것만");
    await h.service.turn(TOKEN, id, { select: { kind: "INQUIRY", inquiryId: "i-s1", workItemId: "w-s1" } } as never, () => undefined);

    const { turn } = await say(h, id, "최근 문의 7개 볼래");
    expect(ids(turn)).toEqual(["i-s1", "i-s2", "i-body", "i-x1", "i-a1"]);
    expect(h.inquiry.rowsParams.at(-1)!.channel).toBeUndefined();
    // A new list is drawn: the anchor does not ride along as a filter source or as the selection.
    expect(turn.continuation.workingSet?.selectedInquiry ?? null).toBeNull();
  });
});

describe("ANALYZE — advisory over a selected ANSWERED inquiry (failure 2)", () => {
  async function selectAnswered(h: Harness, id: string): Promise<void> {
    await say(h, id, "최근 문의 5개 보여줘");
    await h.service.turn(TOKEN, id, { select: { kind: "INQUIRY", inquiryId: "i-a1", workItemId: null } } as never, () => undefined);
  }

  it("「이 고객한테 뭐라고 답하면 좋을까?」 answers with advice — never the gate's refusal, plan 0", async () => {
    const { h, id } = await fresh();
    await selectAnswered(h, id);
    const plans = h.operator.calls.plan;
    const { turn } = await say(h, id, "이 고객한테 뭐라고 답하면 좋을까?");
    expect(turn.status).toBe("DONE");
    expect(h.operator.calls.plan).toBe(plans);
    expect(turn.message).toContain("이미 답변된 문의입니다");
    expect(turn.message).not.toContain("만들지 않았습니다");
    // Nothing registered in this seed: the honest gap, with the next step offered.
    expect(turn.message).toContain("찾지 못했습니다");
    expect(turn.continuation.workingSet?.selectedInquiry?.inquiryId).toBe("i-a1");
  });

  it("with registered rules and past answers, the advice quotes the seller's own corpus (bounded excerpts)", async () => {
    const { open, answered } = seeds();
    const h = harness({
      plansByGoal: PLANS,
      orgKnowledgeSearch: {
        query: "", documentsSearched: 1, passagesSearched: 1, outcome: "FOUND",
        passages: [{ sourceId: "k1", chunkId: "c1", knowledgeType: "POLICY", title: "배송비 기준", content: "기본 배송비는 3,000원이며 5만원 이상 무료입니다.", ordinal: 0, score: 1, authorName: null, sourceUrl: null, version: 1, updatedAt: null }],
      },
      answerMemorySearch: {
        query: "", memoriesSearched: 1, supersededByConflict: 0, outcome: "FOUND",
        passages: [{ memoryId: "m1", topicSignature: null, topicCategory: null, answerTitle: "배송비 안내", answerBody: "안녕하세요. 배송비는 3,000원입니다.", score: 1, strength: "USER_APPROVED", strengthLabel: "승인된 답변", productId: null, channelCode: null, authorName: null, version: 1, updatedAt: null }],
      },
    }, open);
    h.inquiry.answeredSeeds.push(...answered);
    const view = await h.service.create(TOKEN);
    await selectAnswered(h, view.conversationId);
    const { turn } = await say(h, view.conversationId, "이 고객한테 뭐라고 답하면 좋을까?");
    expect(turn.message).toContain("이미 답변된 문의입니다");
    const advice = artifact(turn, "SUMMARY");
    expect(advice.title).toBe("참고할 답변 방향");
    expect(advice.lines.some((l) => l.includes("운영 정책") && l.includes("배송비 기준"))).toBe(true);
    expect(advice.lines.some((l) => l.includes("과거 답변"))).toBe(true);
  });

  it("「그럼 새 답변 준비해줘」 on the same inquiry meets the actionability gate — PREPARE only (scenario 3)", async () => {
    const { h, id } = await fresh();
    await selectAnswered(h, id);
    const { turn } = await say(h, id, "그럼 새 답변 준비해줘");
    expect(turn.status).toBe("DONE");
    expect(turn.message).toContain("이미 답변된 문의라 새 초안은 만들지 않았습니다");
    expect(turn.artifacts.some((a) => a.type === "DRAFT")).toBe(false);
  });
});
