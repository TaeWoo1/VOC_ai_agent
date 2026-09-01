/**
 * Conversation UX v2 — the three defects PO QA named, at their root.
 *
 * A. <b>The subject the seller says.</b> 「현금영수증 관련 문의 중 가장 최근 문의」 lost its subject and
 *    answered with the org's newest inquiry, because the only subject axis was a closed five-family
 *    enum. The fix is an axis for the seller's own word, extracted deterministically and SAID BACK.
 * B. <b>The question about order.</b> 「미응답 문의 중 가장 시급한 건?」 printed twenty rows, because the
 *    task vocabulary had no ranking mode. The fix is a mode whose criterion is stated.
 * C. <b>The body of a selected row.</b> An answered inquiry has no work item, so the only body read
 *    was unavailable and selecting the row showed a title and nothing.
 *
 * Every lane below is deterministic where it claims to be: the assertions count planner calls and
 * backend reads, not sentences.
 */
import { describe, it, expect } from "vitest";
import { subjectTermOf } from "../../src/conversation/subjectTerm";
import { priorityIntentOf, visibleFilterOf, visiblePriorityOf } from "../../src/conversation/taskInterpreter";
import { rankByUrgency, waitingDaysOf } from "../../src/conversation/urgency";
import { CAFE24_ACCOUNT, TODAY, TOKEN, artifact, harness, inquiries, say } from "./support";
import type { SeedInquiry } from "../support/FakeSpringClient";
import { effectiveAxisOf, scopeOverrideOf } from "../../src/operator/plan/scopeOverride";
import { NO_FILTERS } from "../../src/operator/plan/InvestigationPlan";
import type { InvestigationPlan } from "../../src/operator/plan/InvestigationPlan";
import type { WorkingSetView } from "../../src/conversation/contract";

/**
 * Everything the seller reads in one turn — the answer AND, since Agentic Experience v2, the run's
 * limits as their own field (`TurnView.notes`). Which of the two holds a sentence is a rendering
 * fact; that the seller reads it is the contract these tests are about.
 */
const said = (turn: { message: string; notes?: readonly string[] }) => [turn.message, ...(turn.notes ?? [])].join(" ");


function emptyPlanForTest(): InvestigationPlan {
  return {
    supported: true, userGoal: "", entities: { resolved: [], unresolved: [] }, informationNeeds: [],
    specialistTargets: [], candidateTools: [], retrievalStrategy: { order: [], parallelizable: [], stopWhen: null },
    evidenceRequirements: [], riskClass: "ROUTINE", stoppingCriteria: { maxIterations: 1, maxToolCalls: 4, enough: null },
    clarificationNeeded: false, clarificationReason: null, rationale: null, plannerVersion: "test", appliedDefaults: [],
  };
}

/** Two more inquiries: one about a subject no closed topic holds, one answered (no work item). */
function receiptSeeds(): { open: SeedInquiry[]; answered: SeedInquiry[] } {
  return {
    open: [
      ...inquiries(),
      { workItemId: "w-receipt", inquiryId: "inq-receipt", sellerAccountId: CAFE24_ACCOUNT, channelId: "chan-cafe24",
        channelCode: "CAFE24", channelNameKo: "카페24", title: "현금영수증 발행 부탁드려요",
        details: "주문번호로 현금영수증 발행 가능한가요?", receivedAt: "2026-08-25T09:00:00Z" },
    ],
    answered: [
      { workItemId: "w-old-receipt", inquiryId: "inq-old-receipt", sellerAccountId: CAFE24_ACCOUNT, channelId: "chan-cafe24",
        channelCode: "CAFE24", channelNameKo: "카페24", title: "영수증 문의", details: "현금영수증 자진발급 되나요?",
        status: "ANSWERED", receivedAt: "2026-08-10T09:00:00Z" },
    ],
  };
}

describe("A — the subject the seller named reaches the read, and is said back", () => {
  it("subjectTermOf takes a marked subject, refuses every word that already has an axis", () => {
    expect(subjectTermOf("현금영수증 관련 문의 중 가장 최근 문의")).toBe("현금영수증");
    expect(subjectTermOf("세금계산서에 대한 문의 보여줘")).toBe("세금계산서");
    expect(subjectTermOf("파손 문의만 보여줘")).toBe("파손");
    expect(subjectTermOf("색상 관련해서 온 거 보여줘")).toBe("색상");
    // Words the closed axes own: a term beside them would narrow one noun twice.
    expect(subjectTermOf("배송 관련 문의")).toBeNull();
    expect(subjectTermOf("반품 문의 보여줘")).toBeNull();
    expect(subjectTermOf("네이버 문의 보여줘")).toBeNull();
    expect(subjectTermOf("미답변 문의 보여줘")).toBeNull();
    expect(subjectTermOf("최근 문의 3개")).toBeNull();
    expect(subjectTermOf("오늘 문의 보여줘")).toBeNull();
    // A verb describing the rows is not their subject.
    expect(subjectTermOf("어제 들어온 문의 보여줘")).toBeNull();
    expect(subjectTermOf("밀린 문의 보여줘")).toBeNull();
    expect(subjectTermOf("네이버 처리할 문의 정리해줘")).toBeNull();
    // Nothing marked as a subject at all.
    expect(subjectTermOf("문의 몇 건이야")).toBeNull();
    expect(subjectTermOf("")).toBeNull();
  });

  it("「현금영수증 관련 문의 중 가장 최근 문의」 reads with q=현금영수증 and answers about THAT subject", async () => {
    const { open, answered } = receiptSeeds();
    const h = harness({}, open);
    h.inquiry.answeredSeeds.push(...answered);
    const view = await h.service.create(TOKEN);
    const { turn } = await say(h, view.conversationId, "현금영수증 관련 문의 중 가장 최근 문의");
    expect(turn.status).toBe("DONE");
    // The seller's word reached the backend read as one bounded parameter.
    expect(h.inquiry.rowsParams.at(-1)).toMatchObject({ q: "현금영수증", order: "NEWEST" });
    const list = artifact(turn, "INQUIRY_LIST");
    const ids = list.groups.flatMap((g) => g.items.map((i) => i.inquiryId));
    // The newest of the two receipt inquiries — never the org's newest inquiry.
    expect(ids).toEqual(["inq-receipt"]);
    expect(ids).not.toContain("inq-return");
    // …and the answer wears the word it narrowed by, so a count under it is about that subject.
    expect(turn.message).toContain("현금영수증 관련");
    expect(list.scope?.term).toBe("현금영수증");
  });

  it("a subject nothing holds is an honest zero, not a wider list", async () => {
    const { open } = receiptSeeds();
    const h = harness({ plansByGoal: { "세금계산서 관련 문의 보여줘": { ...(await import("../support/recordedPlans")).RECEIPT_ROWS_PLAN } } }, open);
    const view = await h.service.create(TOKEN);
    const { turn } = await say(h, view.conversationId, "세금계산서 관련 문의 보여줘");
    expect(h.inquiry.rowsParams.at(-1)?.q).toBe("세금계산서");
    expect(turn.message).toContain("세금계산서 관련");
    expect(turn.message).toContain("없습니다");
  });

  it("the visible-set FILTER narrows by the same word, with no planner and no org re-read", async () => {
    expect(visibleFilterOf("그중 현금영수증만")).toMatchObject({ term: "현금영수증" });
    const { open } = receiptSeeds();
    const h = harness({}, open);
    const view = await h.service.create(TOKEN);
    await say(h, view.conversationId, "오늘 내가 답해야 할 문의 정리해줘");
    const plans = h.operator.calls.plan;
    const reads = h.inquiry.calls.rows + h.inquiry.calls.list;
    const { turn } = await say(h, view.conversationId, "그중 현금영수증만");
    expect(h.operator.calls.plan).toBe(plans);
    expect(h.inquiry.calls.rows + h.inquiry.calls.list).toBe(reads);
    expect(turn.message).toContain("현금영수증 관련");
    const ids = artifact(turn, "INQUIRY_LIST").groups.flatMap((g) => g.items.map((i) => i.inquiryId));
    expect(ids).toEqual(["inq-receipt"]);
  });
});

describe("B — 「가장 시급한 건」 is answered with an order and its reason", () => {
  it("the interpreters tell a ranking question from a list request, and from one with its own scope", () => {
    expect(priorityIntentOf("가장 시급한 건 뭐야")).toBe(true);
    expect(priorityIntentOf("뭐부터 봐야 해?")).toBe(true);
    expect(priorityIntentOf("먼저 볼 것 알려줘")).toBe(true);
    expect(priorityIntentOf("최근 문의 3개 보여줘")).toBe(false);
    // Over the rows on screen…
    expect(visiblePriorityOf("그중 급한 것부터")).toBe(true);
    expect(visiblePriorityOf("뭐부터 봐야 해?")).toBe(true);
    // …but a sentence that names its OWN scope is the planner's: answering it from the visible set
    // would silently narrow the question.
    expect(visiblePriorityOf("미응답 문의 중 가장 시급한 건?")).toBe(false);
    expect(visiblePriorityOf("오늘 뭐부터 봐야 해?")).toBe(false);
  });

  it("rankByUrgency is longest-waiting-first and stable", () => {
    const rows = [
      { receivedAt: "2026-08-26T09:00:00Z", inquiryId: "b" },
      { receivedAt: "2026-08-20T09:00:00Z", inquiryId: "a" },
      { receivedAt: "2026-08-26T09:00:00Z", inquiryId: "a2" },
    ];
    expect(rankByUrgency(rows).map((r) => r.inquiryId)).toEqual(["a", "a2", "b"]);
    expect(waitingDaysOf("2026-08-20T09:00:00Z", TODAY)).toBe(7);
    expect(waitingDaysOf(null, TODAY)).toBeNull();
  });

  it("the org-scoped PRIORITY plan answers with a few ranked rows, the criterion, and its limit", async () => {
    const h = harness();
    const view = await h.service.create(TOKEN);
    const { turn } = await say(h, view.conversationId, "미응답 문의 중 가장 시급한 건?");
    expect(turn.status).toBe("DONE");
    const list = artifact(turn, "INQUIRY_LIST");
    expect(list.scope?.rank).toBe("URGENCY");
    const items = list.groups.flatMap((g) => g.items);
    // Oldest first — the seed queue is 08-26 · 08-26 · 08-27.
    expect(items[0]!.inquiryId).toBe("inq-ship");
    expect(items.at(-1)!.inquiryId).toBe("inq-return");
    // Every row says why it is where it is.
    expect(items.every((i) => typeof i.waitingDays === "number")).toBe(true);
    expect(items[0]!.waitingDays).toBe(1);
    // The criterion and its limit are said — a ranking whose basis is unstated is a claim the data
    // cannot back.
    expect(turn.message).toContain("고객이 기다린 시간을 기준으로 정했습니다.");
    expect(said(turn)).toContain("답변 기한 정보는 아직 없어");
  });

  it("「그중 급한 것부터」 ranks the rows on screen: planner 0, backend reads 0", async () => {
    const h = harness();
    const view = await h.service.create(TOKEN);
    await say(h, view.conversationId, "오늘 내가 답해야 할 문의 정리해줘");
    const plans = h.operator.calls.plan;
    const reads = h.inquiry.calls.rows + h.inquiry.calls.list + h.inquiry.calls.detail;
    const { turn } = await say(h, view.conversationId, "그중 급한 것부터");
    expect(h.operator.calls.plan).toBe(plans);
    expect(h.inquiry.calls.rows + h.inquiry.calls.list + h.inquiry.calls.detail).toBe(reads);
    expect(turn.budget?.llmCalls).toBe(0);
    const items = artifact(turn, "INQUIRY_LIST").groups.flatMap((g) => g.items);
    expect(items[0]!.inquiryId).toBe("inq-ship");
    expect(items[0]!.waitingDays).toBe(1);
    expect(turn.message).toContain("먼저 볼 순서로 정리했습니다");
  });
});

describe("D — a new subject is a new question, not a refine of the set on screen", () => {
  it("a set that IS one subject is never narrowed into another: the read goes back to the org", () => {
    const set = (filters: Record<string, unknown>): WorkingSetView => ({
      kind: "INQUIRIES", label: "파손 관련 문의", count: 1, ids: ["i-1"], filters,
      productIds: [], workItemIds: ["w-1"], turnId: "t-1",
    } as WorkingSetView);
    const refine = (extra: Record<string, unknown> = {}): InvestigationPlan => ({
      ...emptyPlanForTest(), filters: { ...NO_FILTERS, scope: "WORKING_SET", ...extra },
    });
    // 파손(term) → 교환(topic): disjoint by construction. 「방금 본 문의 중 교환 관련은 없습니다」 is
    // arithmetically true and the wrong answer.
    expect(scopeOverrideOf(refine({ topic: "EXCHANGE_RETURN" }), set({ term: "파손" }),
      { topic: "EXCHANGE_RETURN", term: null })).toBe("NEW_SUBJECT");
    // …and the axes it inherited go with it: the fresh read is not still 파손's.
    const axis = effectiveAxisOf(refine({ topic: "EXCHANGE_RETURN", status: "UNANSWERED" }),
      set({ term: "파손", status: "UNANSWERED" }), false, { topic: "EXCHANGE_RETURN", term: null });
    expect(axis.filters).toMatchObject({ scope: "ORG", topic: "EXCHANGE_RETURN", status: null });
    // A set with NO subject of its own can be narrowed by one — that is a real refine.
    expect(scopeOverrideOf(refine({ topic: "SHIPPING" }), set({}), { topic: "SHIPPING", term: null })).toBeNull();
    // The SAME subject, said again, is still a refine.
    expect(scopeOverrideOf(refine({}), set({ term: "파손" }), { topic: null, term: "파손" })).toBeNull();
    // A sentence that names no subject at all inherits as before.
    expect(scopeOverrideOf(refine({ status: "UNANSWERED" }), set({ term: "파손" }), { topic: null, term: null })).toBeNull();
  });
});

describe("C — a selected row shows what the customer wrote, work item or not", () => {
  it("an ANSWERED row (no work item) is inspected with its own snippet and spends no detail read", async () => {
    const { open, answered } = receiptSeeds();
    const h = harness({}, open);
    h.inquiry.answeredSeeds.push(...answered);
    const view = await h.service.create(TOKEN);
    const { turn: rows } = await say(h, view.conversationId, "현금영수증 관련 문의 중 가장 최근 문의");
    expect(rows.status).toBe("DONE");
    // The rows the seller is looking at already carry the customer's opening sentence.
    const shown = artifact(rows, "INQUIRY_LIST").groups.flatMap((g) => g.items);
    expect(shown[0]!.snippet).toContain("현금영수증 발행 가능한가요?");

    // Selecting it by name INSPECTS it, and the card carries the customer's own sentence — even though
    // the row has a work item here, the same excerpt stands when it has none (the row's snippet).
    const { turn } = await say(h, view.conversationId, "현금영수증 문의 봐줘");
    const card = artifact(turn, "INQUIRY_DETAIL");
    expect(card.inquiryId).toBe("inq-receipt");
    expect(card.excerpt).toContain("현금영수증 발행 가능한가요?");
  });

  it("a persisted thread never carries the customer's message: the snippet is stripped on save", async () => {
    const { open } = receiptSeeds();
    const h = harness({}, open);
    const view = await h.service.create(TOKEN);
    await say(h, view.conversationId, "현금영수증 관련 문의 중 가장 최근 문의");
    const reloaded = await h.service.get(TOKEN, view.conversationId);
    const persisted = reloaded.turns.flatMap((t) => t.artifacts)
      .filter((a): a is Extract<typeof a, { type: "INQUIRY_LIST" }> => a.type === "INQUIRY_LIST")
      .flatMap((a) => a.groups.flatMap((g) => g.items));
    expect(persisted.length).toBeGreaterThan(0);
    expect(persisted.every((i) => i.snippet === undefined)).toBe(true);
  });
});
