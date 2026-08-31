/**
 * Conversation Object Integrity v1 (2026-08-30) — the seven regression cases the live QA wrote down,
 * through the real graph over recording fakes:
 *
 *  A. 「최근 문의 3개」 → 「첫 번째 거」 resolves the INQUIRY (by inquiry id) whether or not it has a work item.
 *  B. A COMPLETED / answered inquiry asked for a draft → draft model 0, proposal 0, a DONE turn that says so.
 *  D. An OPEN inquiry → 「답변 준비해줘」 keeps the same inquiry anchor.
 *  E. 「이 상품 기준으로」 afterwards adds product context and keeps the inquiry.
 *  F. 「조금 더 부드럽게」 afterwards is a tone revision only: planner 0, list/workload tools 0, same facts.
 *  G. After a reload the selected inquiry and its draft continue.
 *  (C — one effective answer state — is the backend's: `InquiryPublishServiceTest` + V88.)
 *
 * No sentence is parsed by a model here: the planner is a recording; the two closed intents
 * (`styleIntent.ts`) are the only thing that reads the seller's words, and they are unit-tested below.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { CAFE24_ACCOUNT, TODAY, TOKEN, artifact, harness, say } from "./support";
import type { Harness } from "./support";
import { CONVERSATION_PLANS, PREPARE_FIRST_DRAFT_PLAN, RECORDED_PLANS } from "../support/recordedPlans";
import type { AgentPlanView } from "../../src/spring/types";
import type { SeedInquiry } from "../support/FakeSpringClient";
import { resetJudgeCapabilityMemo } from "../../src/operator/judge/EvidenceJudge";
import { ConversationService } from "../../src/conversation/ConversationService";
import { FakeReviewSpringClient } from "../support/FakeReviewSpringClient";
import { FakeIssueSpringClient } from "../support/FakeIssueSpringClient";
import { fourIssues } from "../support/issueFixtures";
import { twoReviews } from "../support/reviewFixtures";
import { ordinalSelectionOf, toneIntentOf } from "../../src/conversation/styleIntent";
import { actionabilityOf } from "../../src/conversation/inquiryActionability";
import { MOLDING } from "../support/operatorFixtures";

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

/** 「답변 준비해줘」 / 「이 문의 답변 준비해줘」 — PREPARE over THIS: the anchor, the hint, or the one row. */
const PREPARE_THIS_PLAN: AgentPlanView = {
  ...PREPARE_FIRST_DRAFT_PLAN, userGoal: "선택한 문의의 답변을 준비하고 싶다", target: { selector: "THIS", index: null },
};

const NAVER = { sellerAccountId: "acct-naver", channelId: "chan-naver", channelCode: "NAVER", channelNameKo: "네이버" } as const;
const CAFE24 = { sellerAccountId: CAFE24_ACCOUNT, channelId: "chan-cafe24", channelCode: "CAFE24", channelNameKo: "카페24" } as const;

/** Newest first: an inquiry answered through the executor (COMPLETED work item), then two open ones. */
function seeds(): SeedInquiry[] {
  return [
    { workItemId: "w-done", inquiryId: "i-done", ...NAVER, title: "네이버 오늘 저녁 (답변함)", details: "…",
      receivedAt: `${TODAY}T08:00:00Z`, status: "ANSWERED", phase: "COMPLETED" },
    { workItemId: "w-c1", inquiryId: "i-c1", ...CAFE24, title: "카페24 오늘", details: "…",
      receivedAt: `${TODAY}T05:00:00Z`, productId: MOLDING.id, productName: MOLDING.name },
    { workItemId: "w-n2", inquiryId: "i-n2", ...NAVER, title: "네이버 오늘 점심", details: "…", receivedAt: `${TODAY}T04:00:00Z` },
    { workItemId: "w-old", inquiryId: "i-old", ...CAFE24, title: "지난주 문의", details: "…", receivedAt: "2026-08-20T09:00:00Z" },
  ];
}

const PLANS: Record<string, AgentPlanView> = {
  ...RECORDED_PLANS, ...CONVERSATION_PLANS,
  "최근 문의 3개 보여줘": rowsPlan("최근 문의 3개", { inquiryIntent: "ROWS", order: "NEWEST", limit: 3 }),
  "답변 준비해줘": PREPARE_THIS_PLAN,
  "이 문의 답변 준비해줘": PREPARE_THIS_PLAN,
  "이 상품 기준으로 답변 준비해줘": PREPARE_THIS_PLAN,
};

async function fresh(): Promise<{ h: Harness; id: string }> {
  const h = harness({ plansByGoal: PLANS }, seeds());
  const view = await h.service.create(TOKEN);
  return { h, id: view.conversationId };
}
const generates = (h: Harness) => h.inquiry.methodCalls.filter((c) => c.method === "generateDraftFor");

beforeEach(() => resetJudgeCapabilityMemo());

describe("closed intents — the only readers of the seller's words in this lane", () => {
  it("toneIntentOf: one family, short sentence, no read verb", () => {
    expect(toneIntentOf("조금 더 부드럽게")).toBe("SOFTER");
    expect(toneIntentOf("조금 더 부드럽게 써줘")).toBe("SOFTER");
    expect(toneIntentOf("더 짧게")).toBe("SHORTER");
    expect(toneIntentOf("조금 정중하게")).toBe("MORE_FORMAL");
    expect(toneIntentOf("부드럽고 짧게")).toBeNull();             // two families ⇒ the planner's
    expect(toneIntentOf("부드러운 케이블 문의 보여줘")).toBeNull(); // a read verb ⇒ the planner's
    expect(toneIntentOf("최근 문의 3개 보여줘")).toBeNull();
    expect(toneIntentOf("")).toBeNull();
  });

  it("ordinalSelectionOf: a bare ordinal is a selection; an ordinal with a verb is the planner's", () => {
    expect(ordinalSelectionOf("첫 번째 거")).toBe(1);
    expect(ordinalSelectionOf("두 번째 문의")).toBe(2);
    expect(ordinalSelectionOf("3번째")).toBe(3);
    expect(ordinalSelectionOf("첫번째 거요")).toBe(1);
    expect(ordinalSelectionOf("첫 번째 거 답변 준비해줘")).toBeNull();
    expect(ordinalSelectionOf("첫 번째 리뷰 답변해줘")).toBeNull();
  });

  it("actionabilityOf: the effective answer state wins; only OPEN/PROPOSED with a work item is draftable", () => {
    expect(actionabilityOf({ workItemId: "w", phase: "OPEN", status: "UNANSWERED" })).toBe("DRAFTABLE");
    expect(actionabilityOf({ workItemId: "w", phase: "PROPOSED", status: "UNANSWERED" })).toBe("DRAFTABLE");
    expect(actionabilityOf({ workItemId: "w", phase: "COMPLETED", status: "UNANSWERED" })).toBe("ALREADY_ANSWERED");
    expect(actionabilityOf({ workItemId: null, phase: null, status: "ANSWERED" })).toBe("ALREADY_ANSWERED");
    expect(actionabilityOf({ workItemId: "w", phase: "APPROVED", status: "UNANSWERED" })).toBe("AWAITING_SEND");
    expect(actionabilityOf({ workItemId: null, phase: null, status: "UNANSWERED" })).toBe("NOT_WORKABLE");
    expect(actionabilityOf({ workItemId: "w", phase: "DISMISSED", status: "UNANSWERED" })).toBe("NOT_WORKABLE");
  });
});

describe("A — 「최근 문의 3개」 → 「첫 번째 거」 resolves the inquiry, work item or not", () => {
  it("the first row is the answered one: selected by inquiry id, said as answered, zero reads and zero plans", async () => {
    const { h, id } = await fresh();
    const list = await say(h, id, "최근 문의 3개 보여줘");
    const rows = artifact(list.turn, "INQUIRY_LIST").groups.flatMap((g) => g.items);
    expect(rows.map((r) => r.inquiryId)).toEqual(["i-done", "i-c1", "i-n2"]);
    expect(rows[0]!.workItemId).toBeNull();
    expect(rows.every((r) => r.title)).toBe(true);
    const plans = h.operator.calls.plan;
    const reads = h.inquiry.calls.rows + h.inquiry.calls.list + h.inquiry.calls.detail;

    const { turn, stages } = await say(h, id, "첫 번째 거");
    expect(turn.status).toBe("DONE");
    // Agent Interaction Model v2 §4: an ordinal is an INSPECT — the row itself, as one compact object.
    expect(turn.message).toBe("1번째 문의입니다. 이미 답변된 문의입니다.");
    const detail = artifact(turn, "INQUIRY_DETAIL");
    expect(detail.title).toContain("네이버 오늘 저녁");
    expect(detail.actionability).toBe("ALREADY_ANSWERED");
    // The list stays the set (an ordinal after this still counts on the same rows); the selection rides beside it.
    expect(turn.continuation.workingSet).toMatchObject({
      kind: "INQUIRIES", ids: ["i-done", "i-c1", "i-n2"], selectedInquiry: { inquiryId: "i-done", workItemId: null },
    });
    expect(turn.continuation.activeTask).toBe("INSPECT");
    expect(h.operator.calls.plan).toBe(plans);
    // No work item on the row ⇒ nothing to read: the inspect card is composed from the shown row alone.
    expect(h.inquiry.calls.rows + h.inquiry.calls.list + h.inquiry.calls.detail).toBe(reads);
    expect(stages).toEqual(["UNDERSTANDING"]);
  });

  it("「두 번째 거」 → the open Cafe24 row, with its product beside the anchor and draft chips offered", async () => {
    const { h, id } = await fresh();
    await say(h, id, "최근 문의 3개 보여줘");
    const plans = h.operator.calls.plan;
    const { turn } = await say(h, id, "두 번째 거");
    expect(turn.message).toContain("2번째 문의입니다.");
    expect(artifact(turn, "INQUIRY_DETAIL")).toMatchObject({ inquiryId: "i-c1", actionability: "DRAFTABLE" });
    expect(turn.continuation.workingSet).toMatchObject({
      ids: ["i-done", "i-c1", "i-n2"], productIds: [MOLDING.id],
      selectedInquiry: { inquiryId: "i-c1", workItemId: "w-c1", productId: MOLDING.id, channelCode: "CAFE24" },
    });
    expect(turn.suggestedActions.map((s) => s.label)).toEqual(expect.arrayContaining(["답변 준비해줘", "이 상품 기준으로 답변 준비해줘"]));
    // Agent Interaction Model v2 §13: with an anchored inquiry, 「답변 준비해줘」 is the product's own
    // draft path directly — the planner is not called, and the draft is for the anchor.
    const { turn: prepared } = await say(h, id, "답변 준비해줘");
    expect(h.operator.calls.plan).toBe(plans);
    expect(artifact(prepared, "DRAFT")).toMatchObject({ workItemId: "w-c1", inquiryId: "i-c1" });
  });

  it("an ordinal AFTER a selection still counts on the list the seller saw", async () => {
    const { h, id } = await fresh();
    await say(h, id, "최근 문의 3개 보여줘");
    await say(h, id, "첫 번째 거");
    const { turn } = await say(h, id, "세 번째 거");
    expect(turn.message).toContain("3번째 문의입니다.");
    expect(turn.continuation.workingSet?.selectedInquiry?.inquiryId).toBe("i-n2");
    expect(turn.continuation.workingSet?.ids).toEqual(["i-done", "i-c1", "i-n2"]);
  });

  it("a tone word with a selected inquiry but no draft on the table is answered without a plan", async () => {
    const { h, id } = await fresh();
    await say(h, id, "최근 문의 3개 보여줘");
    await say(h, id, "두 번째 거");
    const plans = h.operator.calls.plan;
    const { turn } = await say(h, id, "조금 더 부드럽게");
    expect(turn.message).toContain("말투를 바꿀 초안을 찾지 못했습니다.");
    expect(h.operator.calls.plan).toBe(plans);
    expect(turn.continuation.workingSet?.selectedInquiry?.inquiryId).toBe("i-c1");
  });

  it("an ordinal past the end of the list is said, and the set stays", async () => {
    const { h, id } = await fresh();
    await say(h, id, "최근 문의 3개 보여줘");
    const { turn } = await say(h, id, "네 번째 거");
    expect(turn.message).toBe("방금 본 목록에는 4번째 문의가 없습니다.");
    expect(turn.continuation.workingSet?.ids).toEqual(["i-done", "i-c1", "i-n2"]);
  });

  it("「첫 번째 거 답변 준비해줘」 over a ROWS list (the planner's FIRST) drafts the first DRAFTABLE row by inquiry id", async () => {
    const { h, id } = await fresh();
    // Answered row first: the planner's FIRST lands on it and the gate says so — no draft, no 409.
    await say(h, id, "최근 문의 3개 보여줘");
    const { turn } = await say(h, id, "첫 번째 거 답변 준비해줘");
    expect(turn.status).toBe("DONE");
    expect(turn.message).toContain("이미 답변된 문의라 새 초안은 만들지 않았습니다.");
    expect(generates(h)).toHaveLength(0);
    expect(h.inquiry.calls.propose).toBe(0);
    expect(turn.continuation.workingSet?.selectedInquiry?.inquiryId).toBe("i-done");
  });
});

describe("B — an answered / COMPLETED inquiry asked for a draft: model 0, proposal 0, a DONE turn that says so", () => {
  it("selected by ordinal, then 「답변 준비해줘」", async () => {
    const { h, id } = await fresh();
    await say(h, id, "최근 문의 3개 보여줘");
    await say(h, id, "첫 번째 거");
    const { turn, stages } = await say(h, id, "답변 준비해줘");
    expect(turn.status).toBe("DONE");
    expect(turn.message).toContain("이미 답변된 문의라 새 초안은 만들지 않았습니다.");
    const state = artifact(turn, "SUMMARY");
    expect(state.title).toBe("초안을 만들지 않은 문의");
    // No internal path in the prose: the FE prints a summary's note as text.
    expect(JSON.stringify(state)).not.toContain("/inquiries/");
    expect(stages).not.toContain("PREPARING_DRAFT");
    expect(generates(h)).toHaveLength(0);
    expect(h.inquiry.calls.propose).toBe(0);
    expect(turn.continuation.pendingPrepared).toBeNull();
    expect(turn.continuation.workingSet?.selectedInquiry?.inquiryId).toBe("i-done");
  });

  it("launched from the screen with the COMPLETED work item as the hint", async () => {
    const { h, id } = await fresh();
    const { turn } = await say(h, id, "이 문의 답변 준비해줘", { workItemId: "w-done" });
    expect(turn.status).toBe("DONE");
    expect(turn.message).toContain("이미 답변된 문의라 새 초안은 만들지 않았습니다.");
    expect(generates(h)).toHaveLength(0);
    expect(h.inquiry.calls.propose).toBe(0);
    // The turn persisted, and the inquiry it was about is the anchor now.
    const stored = await h.service.get(TOKEN, id);
    expect(stored.turns.at(-1)?.status).toBe("DONE");
    expect(stored.workingSet?.selectedInquiry).toMatchObject({ inquiryId: "i-done", workItemId: "w-done" });
  });

  it("a draft path that still refuses becomes a sentence on a DONE turn, never a lost turn", async () => {
    const { h, id } = await fresh();
    await say(h, id, "최근 문의 3개 보여줘");
    await say(h, id, "두 번째 거");
    h.inquiry.proposeInquiry = async () => { throw new Error("backend down"); };
    const { turn } = await say(h, id, "답변 준비해줘");
    expect(turn.status).toBe("DONE");
    expect(turn.message).toContain("초안을 준비하는 중 문제가 생겨 이번에는 만들지 못했습니다.");
    expect(turn.message).not.toContain("backend down");
    expect((await h.service.get(TOKEN, id)).turns.at(-1)?.status).toBe("DONE");
  });
});

describe("D/E/F — one inquiry through draft → product context → tone, the same anchor all the way", () => {
  async function drafted(): Promise<{ h: Harness; id: string }> {
    const { h, id } = await fresh();
    await say(h, id, "최근 문의 3개 보여줘");
    await say(h, id, "두 번째 거");
    const { turn } = await say(h, id, "답변 준비해줘");
    expect(artifact(turn, "DRAFT")).toMatchObject({ workItemId: "w-c1", inquiryId: "i-c1", version: 1 });
    expect(turn.continuation.workingSet?.selectedInquiry?.inquiryId).toBe("i-c1");
    expect(turn.continuation.pendingPrepared).toMatchObject({ kind: "INQUIRY_DRAFT", workItemId: "w-c1", draftVersion: 1 });
    return { h, id };
  }

  it("D — the draft is for the selected inquiry (propose → generate once), and the anchor survives it", async () => {
    const { h } = await drafted();
    expect(h.inquiry.calls.propose).toBe(1);
    expect(generates(h)).toEqual([{ method: "generateDraftFor", workItemId: "w-c1", tone: null }]);
  });

  it("E — 「이 상품 기준으로 답변 준비해줘」 keeps the inquiry and carries the product beside it", async () => {
    const { h, id } = await drafted();
    const plans = h.operator.calls.plan;
    const { turn } = await say(h, id, "이 상품 기준으로 답변 준비해줘");
    expect(artifact(turn, "DRAFT")).toMatchObject({ workItemId: "w-c1", inquiryId: "i-c1", version: 2 });
    expect(turn.continuation.workingSet).toMatchObject({
      kind: "INQUIRIES", productIds: [MOLDING.id], selectedInquiry: { inquiryId: "i-c1", productId: MOLDING.id },
    });
    expect(h.inquiry.calls.propose).toBe(1);
    // Agent Interaction Model v2 §13: an anchored PREPARE spends no plan — the inquiry's own product
    // binding scopes the draft, and 「이 상품」 needs no resolver because the anchor already names it.
    expect(h.operator.calls.plan).toBe(plans);
  });

  it("F — 「조금 더 부드럽게」 is a tone revision only: planner 0, list/workload/detail reads 0, same inquiry, same facts, new version", async () => {
    const { h, id } = await drafted();
    const plans = h.operator.calls.plan;
    const reads = { rows: h.inquiry.calls.rows, list: h.inquiry.calls.list, detail: h.inquiry.calls.detail };
    const { turn, stages } = await say(h, id, "조금 더 부드럽게");
    expect(turn.status).toBe("DONE");
    expect(turn.message).toBe("말투를 바꿔 초안을 다시 준비했습니다.");
    expect(h.operator.calls.plan).toBe(plans);
    expect(h.inquiry.calls.rows).toBe(reads.rows);
    expect(h.inquiry.calls.list).toBe(reads.list);
    // One detail read: the head the tone variant is checked against — not a workload or a list.
    expect(h.inquiry.calls.detail).toBe(reads.detail + 1);
    expect(stages).toEqual(["UNDERSTANDING", "PREPARING_DRAFT"]);
    expect(generates(h).at(-1)).toEqual({ method: "generateDraftFor", workItemId: "w-c1", tone: "SOFTER" });
    const draft = artifact(turn, "DRAFT");
    expect(draft).toMatchObject({ workItemId: "w-c1", inquiryId: "i-c1", version: 2, tone: "SOFTER" });
    expect(turn.artifacts.filter((a) => a.type === "INQUIRY_LIST")).toHaveLength(0);
    // The factual envelope did not move: the fake keeps the same body for every tone.
    expect((await h.inquiry.getInquiryDetail("w-c1")).draft?.comments).toBe("안녕하세요. 문의 주신 내용 확인했습니다.");
    expect(turn.continuation.workingSet?.selectedInquiry?.inquiryId).toBe("i-c1");
    expect(turn.continuation.pendingPrepared).toMatchObject({ workItemId: "w-c1", draftVersion: 2 });
    expect(turn.budget).toMatchObject({ toolCalls: 0, llmCalls: 0, stopReason: "TONE_REVISION" });
  });

  it("F′ — 「더 짧게」 and 「조금 정중하게」 are the other two tokens of the same contract", async () => {
    const { h, id } = await drafted();
    await say(h, id, "더 짧게");
    await say(h, id, "조금 정중하게");
    expect(generates(h).slice(1).map((g) => g.tone)).toEqual(["SHORTER", "MORE_FORMAL"]);
  });

  it("a product question after the selection adds the product, and does not replace the inquiry", async () => {
    const { h, id } = await drafted();
    const { turn } = await say(h, id, "요즘 문제 생기는 상품 있어?");
    expect(turn.status).toBe("DONE");
    expect(turn.continuation.workingSet).toMatchObject({ kind: "INQUIRIES", selectedInquiry: { inquiryId: "i-c1" } });
    expect(turn.continuation.workingSet?.productIds).toContain(MOLDING.id);
  });

  it("a NEW list the seller asks for releases the anchor", async () => {
    const { h, id } = await drafted();
    const { turn } = await say(h, id, "최근 문의 3개 보여줘");
    expect(turn.continuation.workingSet?.ids).toEqual(["i-done", "i-c1", "i-n2"]);
    expect(turn.continuation.workingSet?.selectedInquiry ?? null).toBeNull();
  });
});

describe("G — reload: the selected inquiry and its draft continue from the store", () => {
  it("a second service over the same store sees the anchor, the titles and the draft, and a tone turn continues it", async () => {
    const { h, id } = await fresh();
    await say(h, id, "최근 문의 3개 보여줘");
    await say(h, id, "두 번째 거");
    await say(h, id, "답변 준비해줘");

    // The same store, a fresh service — what a page reload is to the runtime.
    const reloaded = new ConversationService({ storeProvider: h.stores, clientFactory: () => ({
      inquiry: h.inquiry, operator: h.operator, review: new FakeReviewSpringClient(twoReviews()),
      issue: new FakeIssueSpringClient(fourIssues()),
      identity: { whoami: async () => ({ userId: "u-1", orgId: "org-conversation-test" }) },
    }) });
    const view = await reloaded.get(TOKEN, id);
    expect(view.workingSet?.selectedInquiry).toMatchObject({ inquiryId: "i-c1", workItemId: "w-c1" });
    expect(view.pendingPrepared).toMatchObject({ workItemId: "w-c1", draftVersion: 1 });
    const list = view.turns.map((t) => t.artifacts.find((a) => a.type === "INQUIRY_LIST")).find((a) => a != null)!;
    expect(list.type === "INQUIRY_LIST" && list.groups.flatMap((g) => g.items).map((i) => i.title)).toEqual(
      ["네이버 오늘 저녁 (답변함)", "카페24 오늘", "네이버 오늘 점심"]);

    const stages: string[] = [];
    const turn = await reloaded.turn(TOKEN, id, { text: "조금 더 부드럽게", referenceDate: TODAY } as never, (e) => {
      if (e.type === "stage") stages.push(e.stage);
    });
    expect(turn.message).toBe("말투를 바꿔 초안을 다시 준비했습니다.");
    expect(artifact(turn, "DRAFT")).toMatchObject({ workItemId: "w-c1", version: 2, tone: "SOFTER" });
    expect(turn.continuation.workingSet?.selectedInquiry?.inquiryId).toBe("i-c1");
  });
});
