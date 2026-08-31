/**
 * Agent Interaction Model v2 — the conversation as an operating workspace:
 *
 *  §2  Natural-language selection over the VISIBLE set: 「배송 문의 봐줘」 selects the row, never
 *      re-lists, never re-queries the org; ambiguity shows candidates instead of guessing.
 *  §3  A CLICK on a shown row is the same focus transition — persisted, transcript-silent.
 *  §4  INSPECT ≠ WORKLOAD: the selected inquiry is shown as one compact object with the customer's
 *      excerpt (≤1 read), and 「이 문의 자세히」 works on the anchor.
 *  §13 With an anchor, 「뭐라고 답하면 좋을까」 runs the product's own draft path with NO planner call.
 *  §0  Org isolation: another org's token can never load, list or continue this conversation.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { CAFE24_ACCOUNT, CONFIG, TODAY, TOKEN, artifact, harness, inquiries, say } from "./support";
import type { Harness } from "./support";
import { CONVERSATION_PLANS, RECORDED_PLANS } from "../support/recordedPlans";
import type { AgentPlanView } from "../../src/spring/types";
import type { SeedInquiry } from "../support/FakeSpringClient";
import { FakeSpringClient } from "../support/FakeSpringClient";
import { FakeOperatorSpringClient } from "../support/FakeOperatorSpringClient";
import { FakeReviewSpringClient } from "../support/FakeReviewSpringClient";
import { FakeIssueSpringClient } from "../support/FakeIssueSpringClient";
import { fourIssues } from "../support/issueFixtures";
import { twoReviews } from "../support/reviewFixtures";
import { resetJudgeCapabilityMemo } from "../../src/operator/judge/EvidenceJudge";
import { ConversationService } from "../../src/conversation/ConversationService";
import { RunStoreProvider } from "../../src/http/runStoreProvider";
import type { SpringClientFactory } from "../../src/http/AgentRunService";
import { prepareIntentOf, pronounInspectOf, visibleSelectionOf } from "../../src/conversation/visibleSelection";
import { analyzeIntentOf, visibleFilterOf } from "../../src/conversation/taskInterpreter";
import { HttpError } from "../../src/http/errors";
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

const PLANS = {
  ...RECORDED_PLANS, ...CONVERSATION_PLANS,
  "최근 문의 3개 보여줘": rowsPlan("최근 문의 3개", { inquiryIntent: "ROWS", order: "NEWEST", limit: 3 }),
};

async function fresh(seeds: SeedInquiry[] = inquiries()): Promise<{ h: Harness; id: string }> {
  const h = harness({ plansByGoal: PLANS }, seeds);
  const view = await h.service.create(TOKEN);
  await say(h, view.conversationId, "최근 문의 3개 보여줘");
  return { h, id: view.conversationId };
}

const ROWS = [
  { id: "a", title: "배송 후 분실", productName: "종이컵보관함 수거함", channelCode: "NAVER", channelNameKo: "네이버" },
  { id: "b", title: "제목 없는 문의", productName: "전선몰딩 1호", channelCode: "NAVER", channelNameKo: "네이버" },
  { id: "c", title: "반품하고 싶어요", productName: null, channelCode: "CAFE24", channelNameKo: "카페24" },
];

beforeEach(() => resetJudgeCapabilityMemo());

describe("visibleSelectionOf — deterministic, conservative, closed classes", () => {
  it("a topic word selects the one row whose title carries it", () => {
    expect(visibleSelectionOf("배송 문의 봐줘", ROWS)).toEqual({ kind: "SELECTED", id: "a" });
    expect(visibleSelectionOf("배송 문의", ROWS)).toEqual({ kind: "SELECTED", id: "a" });
  });
  it("a product word selects the row it names — with or without a viewing verb", () => {
    expect(visibleSelectionOf("종이컵 문의 봐줘", ROWS)).toEqual({ kind: "SELECTED", id: "a" });
    expect(visibleSelectionOf("전선몰딩 문의", ROWS)).toEqual({ kind: "SELECTED", id: "b" });
  });
  it("a channel narrows: 「네이버 배송 문의」 is the NAVER shipping row", () => {
    expect(visibleSelectionOf("네이버 배송 문의 봐줘", ROWS)).toEqual({ kind: "SELECTED", id: "a" });
  });
  it("two rows matching ⇒ AMBIGUOUS with the candidates, never a silent pick", () => {
    const twoShipping = [...ROWS, { id: "d", title: "배송 언제 오나요", productName: null, channelCode: "CAFE24", channelNameKo: "카페24" }];
    expect(visibleSelectionOf("배송 문의 봐줘", twoShipping)).toEqual({ kind: "AMBIGUOUS", ids: ["a", "d"] });
  });
  it("a literal that matches no row (something outside the set) declines to the planner", () => {
    expect(visibleSelectionOf("의자 문의 봐줘", ROWS)).toEqual({ kind: "NONE" });
  });
  it("action / list / filter sentences are never selections", () => {
    expect(visibleSelectionOf("배송 문의 답변 준비해줘", ROWS)).toEqual({ kind: "NONE" });
    expect(visibleSelectionOf("답변 안 한 문의만 보여줘", ROWS)).toEqual({ kind: "NONE" });
    expect(visibleSelectionOf("배송 관련 문의 전부 보여줘", ROWS)).toEqual({ kind: "NONE" });
    expect(visibleSelectionOf("문의 봐줘", ROWS)).toEqual({ kind: "NONE" });
    expect(visibleSelectionOf("배송 문의가 몇 건이야?", ROWS)).toEqual({ kind: "NONE" });
  });
  it("pronoun, prepare and analyze intents are their own closed readers (Conversation Core v1)", () => {
    expect(pronounInspectOf("이 문의")).toBe(true);
    expect(pronounInspectOf("이 문의 자세히")).toBe(true);
    expect(pronounInspectOf("아까 그 문의 봐줘")).toBe(true);
    expect(pronounInspectOf("이 고객한테 뭐라고 답하면 좋을까?")).toBe(false);
    // Advisory questions are ANALYZE, never PREPARE — the actionability gate applies only to the
    // imperative families (PO QA 2026-08-31, failure 2).
    expect(analyzeIntentOf("이 고객한테 뭐라고 답하면 좋을까?")).toBe(true);
    expect(analyzeIntentOf("뭐라고 답하지")).toBe(true);
    expect(analyzeIntentOf("어떻게 대응하면 좋을까")).toBe(true);
    expect(analyzeIntentOf("답변 준비해줘")).toBe(false);
    expect(prepareIntentOf("이 고객한테 뭐라고 답하면 좋을까?")).toBe(false);
    expect(prepareIntentOf("답변 준비해줘")).toBe(true);
    expect(prepareIntentOf("새 답변 준비해줘")).toBe(true);
    expect(prepareIntentOf("첫 번째 거 답변 준비해줘")).toBe(false); // names another object — the planner's
    expect(prepareIntentOf("답변 안 한 문의만 보여줘")).toBe(false);
  });

  it("visibleFilterOf — a narrowing needs refine wording (~만·그중·중에서·여기서·방금 본); selections stay selections", () => {
    expect(visibleFilterOf("배송 관련 문의만 봐줘")).toMatchObject({ topic: "SHIPPING" });
    expect(visibleFilterOf("네이버 것만")).toMatchObject({ channel: "NAVER" });
    expect(visibleFilterOf("답변 안 한 것만")).toMatchObject({ status: "UNANSWERED" });
    expect(visibleFilterOf("여기서 답변 안 한 것만")).toMatchObject({ status: "UNANSWERED" });
    expect(visibleFilterOf("그중 최근 2개")).toMatchObject({ order: "NEWEST", limit: 2 });
    expect(visibleFilterOf("방금 본 것 중에서 최근 2개")).toMatchObject({ order: "NEWEST", limit: 2 });
    expect(visibleFilterOf("그중 가장 오래된 1개")).toMatchObject({ order: "OLDEST", limit: 1 });
    expect(visibleFilterOf("네이버 배송 관련 답변 안 한 것만")).toMatchObject({ channel: "NAVER", topic: "SHIPPING", status: "UNANSWERED" });
    // A bare label + viewing verb is the SELECTION lane's (§2), not a filter.
    expect(visibleFilterOf("배송 문의 봐줘")).toBeNull();
    // An explicit NEW-LIST request is a fresh ORG question, never a refine of the rows on screen —
    // even when its axes (limit·order·status) are ones this grammar could read. The 만 of a count
    // (「7개만」) is not refine wording; only 「~만」 on a named thing is (New-list Scope Integrity).
    expect(visibleFilterOf("최근 문의 7개 보여줘")).toBeNull();
    expect(visibleFilterOf("최근 문의 7개만 보여줘")).toBeNull();
    expect(visibleFilterOf("최근 2개 보여줘")).toBeNull();
    expect(visibleFilterOf("답변 안 한 문의 보여줘")).toBeNull();
    // ONE leftover content token is the SUBJECT the seller narrowed by — the axis the closed topic
    // families cannot hold (Conversation UX v2 §A). 「~만」 still decides filter-vs-select: the bare
    // label above is a selection, this is a narrowing.
    expect(visibleFilterOf("종이컵 문의만 보여줘")).toMatchObject({ term: "종이컵" });
    expect(visibleFilterOf("그중 현금영수증 관련만")).toMatchObject({ term: "현금영수증" });
    // Two leftovers say more than these tables can read; the planner decides what.
    expect(visibleFilterOf("종이컵 파손 문의만 보여줘")).toBeNull();
    expect(visibleFilterOf("배송 관련 문의 정리해줘")).toBeNull();
    expect(visibleFilterOf("답변 준비해줘")).toBeNull();
  });
});

describe("§2/§4 — label selection over the visible set is an INSPECT, not a re-list", () => {
  it("「배송 문의 봐줘」 selects the shipping row: detail card, anchor set, plan 0, org re-query 0", async () => {
    const { h, id } = await fresh();
    const plans = h.operator.calls.plan;
    const rowsReads = h.inquiry.calls.rows + h.inquiry.calls.list;
    const { turn, stages } = await say(h, id, "배송 문의 봐줘");
    expect(turn.status).toBe("DONE");
    expect(h.operator.calls.plan).toBe(plans);
    expect(h.inquiry.calls.rows + h.inquiry.calls.list).toBe(rowsReads);
    expect(turn.artifacts.filter((a) => a.type === "INQUIRY_LIST")).toHaveLength(0);
    const detail = artifact(turn, "INQUIRY_DETAIL");
    expect(detail.inquiryId).toBe("inq-ship");
    expect(detail.excerpt).toContain("택배가 아직");
    expect(turn.continuation.workingSet?.selectedInquiry?.inquiryId).toBe("inq-ship");
    expect(turn.continuation.activeTask).toBe("INSPECT");
    expect(stages).toEqual(["UNDERSTANDING"]);
  });

  it("「이 문의 자세히」 afterwards inspects the same anchor — still no plan", async () => {
    const { h, id } = await fresh();
    await say(h, id, "배송 문의 봐줘");
    const plans = h.operator.calls.plan;
    const { turn } = await say(h, id, "이 문의 자세히");
    expect(artifact(turn, "INQUIRY_DETAIL").inquiryId).toBe("inq-ship");
    expect(h.operator.calls.plan).toBe(plans);
  });

  it("two matching rows ⇒ candidates are shown and the set narrows to them; an ordinal then picks one", async () => {
    const seeds: SeedInquiry[] = [
      ...inquiries(),
      { workItemId: "w-ship2", inquiryId: "inq-ship2", sellerAccountId: CAFE24_ACCOUNT, channelId: "chan-cafe24",
        channelCode: "CAFE24", channelNameKo: "카페24", title: "배송 조회가 안돼요", details: "송장이 없어요",
        receivedAt: `${TODAY}T02:00:00Z` },
    ];
    const h = harness({ plansByGoal: { ...PLANS, "최근 문의 4개 보여줘": rowsPlan("최근 문의 4개", { inquiryIntent: "ROWS", order: "NEWEST", limit: 4 }) } }, seeds);
    const view = await h.service.create(TOKEN);
    await say(h, view.conversationId, "최근 문의 4개 보여줘");
    const { turn } = await say(h, view.conversationId, "배송 문의 봐줘");
    expect(turn.message).toContain("하나를 골라 주세요");
    const list = artifact(turn, "INQUIRY_LIST");
    expect(list.groups.flatMap((g) => g.items).map((i) => i.inquiryId).sort()).toEqual(["inq-ship", "inq-ship2"]);
    expect(turn.continuation.workingSet?.ids).toHaveLength(2);
    expect(turn.continuation.workingSet?.selectedInquiry ?? null).toBeNull();
    // The candidates ARE the visible set now: the ordinal counts on them, in the shown order.
    const shown = turn.continuation.workingSet!.ids;
    const picked = await say(h, view.conversationId, "두 번째 거");
    expect(picked.turn.continuation.workingSet?.selectedInquiry?.inquiryId).toBe(shown[1]);
  });
});

describe("§13 — an anchored PREPARE spends no plan", () => {
  it("「이 고객한테 뭐라고 답하면 좋을까?」 after a label selection → the anchor's draft lane, plan 0", async () => {
    const { h, id } = await fresh();
    await say(h, id, "배송 문의 봐줘");
    const plans = h.operator.calls.plan;
    const { turn } = await say(h, id, "이 고객한테 뭐라고 답하면 좋을까?");
    expect(h.operator.calls.plan).toBe(plans);
    expect(turn.status).toBe("DONE");
    // The shipping inquiry has no answer basis in these seeds — the honest gap flow answers, not a queue.
    expect(turn.artifacts.filter((a) => a.type === "INQUIRY_LIST")).toHaveLength(0);
    expect(turn.artifacts.some((a) => a.type === "DRAFT")).toBe(true);
  });
});

describe("§3/§9 — a click is the same focus transition, transcript-silent and persisted", () => {
  it("select lands the anchor without appending turns; the next sentence acts on it", async () => {
    const { h, id } = await fresh();
    const before = (await h.service.get(TOKEN, id)).turns.length;
    const turn = await h.service.turn(TOKEN, id, { select: { kind: "INQUIRY", inquiryId: "inq-ship", workItemId: "w-ship" } } as never, () => undefined);
    expect(turn.continuation.workingSet?.selectedInquiry?.inquiryId).toBe("inq-ship");
    expect(turn.continuation.activeTask).toBe("INSPECT");
    const stored = await h.service.get(TOKEN, id);
    expect(stored.turns.length).toBe(before);
    expect(stored.workingSet?.selectedInquiry?.inquiryId).toBe("inq-ship");
    // 「뭐라고 답하면 좋을까?」 now acts on the clicked inquiry with no plan.
    const plans = h.operator.calls.plan;
    const prepared = await say(h, id, "이 고객한테 뭐라고 답하면 좋을까?");
    expect(h.operator.calls.plan).toBe(plans);
    expect(prepared.turn.artifacts.some((a) => a.type === "DRAFT" || a.type === "SUMMARY")).toBe(true);
  });

  it("a click on an id the thread never showed is verified by one org-scoped read — an unverifiable id changes nothing", async () => {
    const { h, id } = await fresh();
    const turn = await h.service.turn(TOKEN, id, { select: { kind: "INQUIRY", inquiryId: "inq-외부", workItemId: "w-없음" } } as never, () => undefined);
    expect(turn.continuation.workingSet?.selectedInquiry?.inquiryId).not.toBe("inq-외부");
  });
});

describe("§0 — org isolation: another org's token can never reach this conversation", () => {
  function twoOrgService(): { service: ConversationService } {
    const clientFactory: SpringClientFactory = (token) => ({
      inquiry: new FakeSpringClient(inquiries()),
      review: new FakeReviewSpringClient(twoReviews()),
      issue: new FakeIssueSpringClient(fourIssues()),
      identity: { whoami: async () => ({ userId: `u-${token}`, orgId: `org-${token}` }) },
      operator: new FakeOperatorSpringClient({ inbox: { items: [], total: 0, unansweredInquiries: 0 }, products: [MOLDING], signals: {}, plansByGoal: PLANS }),
    });
    const stores = new RunStoreProvider(CONFIG);
    return { service: new ConversationService({ storeProvider: stores, clientFactory }) };
  }

  it("get / turn / list are scoped: org B sees nothing of org A's thread", async () => {
    const { service } = twoOrgService();
    const mine = await service.create("A");
    expect(mine.orgId).toBe("org-A");
    await expect(service.get("B", mine.conversationId)).rejects.toMatchObject({ status: 404 });
    await expect(
      service.turn("B", mine.conversationId, { text: "이 문의 봐줘" } as never, () => undefined),
    ).rejects.toBeInstanceOf(HttpError);
    const theirs = await service.list("B", 10);
    expect(theirs.map((c) => c.conversationId)).not.toContain(mine.conversationId);
    // And the tenant stamp is defense in depth even if a store were mis-scoped:
    const viewA = await service.get("A", mine.conversationId);
    expect(viewA.orgId).toBe("org-A");
  });
});
