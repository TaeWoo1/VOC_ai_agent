/**
 * Query Accuracy v1 (2026-08-28) — the typed QuerySpec, end to end: Planner filters → tool args → result.
 *
 * Each case replays a v4 plan (the closed tokens a live planner emits for the sentence — see
 * `docs/agentic_operating_workspace_v2.md` §25 for the live recordings this shape was taken from) through
 * the real graph over fakes that RECORD every request, and asserts three things at once: the tool was
 * called with exactly the spec's axes, the rows the seller sees are the rows that spec selects, and the
 * working set carries the spec forward so the next sentence refines it. No sentence is parsed anywhere.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { CAFE24_ACCOUNT, TODAY, TOKEN, artifact, harness, say } from "./support";
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

function plan(kind: "INQUIRY_VOLUME" | "REVIEW_SIGNAL", goal: string, filters: Partial<Filters>): AgentPlanView {
  const specialist = kind === "REVIEW_SIGNAL" ? "REVIEW_OPS" : "INQUIRY_OPS";
  return {
    available: true, supported: true, userGoal: goal, unresolvedEntities: [],
    informationNeeds: [{ id: "n1", question: goal, kind, why: "목록이 질문이다", required: true }],
    specialists: [specialist], tools: [], retrievalOrder: ["n1"], retrievalParallel: [],
    retrievalStopWhen: null, evidenceRequirements: [], riskClass: "ROUTINE", maxIterations: 1, maxToolCalls: 8,
    stopWhenEnough: null, clarificationNeeded: false, clarificationReason: null, rationale: "목록",
    providerVersion: V4, requestedAction: "NONE", tone: null, filters: { ...NONE, ...filters }, target: { selector: "NONE", index: null },
  };
}

/** Seven inquiries across two channels and ten years; two of them answered (no work item). */
const NAVER = { sellerAccountId: "acct-naver", channelId: "chan-naver", channelCode: "NAVER", channelNameKo: "네이버" } as const;
const CAFE24 = { sellerAccountId: CAFE24_ACCOUNT, channelId: "chan-cafe24", channelCode: "CAFE24", channelNameKo: "카페24" } as const;
function seeds(): { open: SeedInquiry[]; answered: SeedInquiry[] } {
  const open: SeedInquiry[] = [
    { workItemId: "w-2016", inquiryId: "i-2016", ...CAFE24, title: "오래된 문의", details: "…", receivedAt: "2016-03-19T09:00:00Z" },
    { workItemId: "w-0820", inquiryId: "i-0820", ...CAFE24, title: "지난주 문의", details: "…", receivedAt: "2026-08-20T09:00:00Z" },
    { workItemId: "w-n1", inquiryId: "i-n1", ...NAVER, title: "네이버 오늘 아침", details: "…", receivedAt: `${TODAY}T01:00:00Z` },
    { workItemId: "w-n2", inquiryId: "i-n2", ...NAVER, title: "네이버 오늘 점심", details: "…", receivedAt: `${TODAY}T04:00:00Z` },
    { workItemId: "w-c1", inquiryId: "i-c1", ...CAFE24, title: "카페24 오늘", details: "…", receivedAt: `${TODAY}T05:00:00Z` },
  ];
  const answered: SeedInquiry[] = [
    { workItemId: "w-n3", inquiryId: "i-n3", ...NAVER, title: "네이버 오늘 저녁 (답변함)", details: "…", receivedAt: `${TODAY}T08:00:00Z`, status: "ANSWERED" },
    { workItemId: "w-c2", inquiryId: "i-c2", ...CAFE24, title: "카페24 어제 (답변함)", details: "…", receivedAt: "2026-08-26T08:00:00Z", status: "ANSWERED" },
  ];
  return { open, answered };
}

const PLANS: Record<string, AgentPlanView> = {
  ...RECORDED_PLANS, ...CONVERSATION_PLANS,
  "가장 최근 리뷰 1개만 보여줘": plan("REVIEW_SIGNAL", "가장 최근 리뷰 1개", { period: "LAST_7_DAYS", reviewIntent: "ROWS", order: "NEWEST", limit: 1 }),
  "가장 오래된 리뷰 1개만 보여줘": plan("REVIEW_SIGNAL", "가장 오래된 리뷰 1개", { period: "LAST_7_DAYS", reviewIntent: "ROWS", order: "OLDEST", limit: 1 }),
  "최근 문의 3개 보여줘": plan("INQUIRY_VOLUME", "최근 문의 3개", { inquiryIntent: "ROWS", order: "NEWEST", limit: 3 }),
  "가장 오래된 문의 1개 보여줘": plan("INQUIRY_VOLUME", "가장 오래된 문의 1개", { inquiryIntent: "ROWS", order: "OLDEST", limit: 1 }),
  "오늘 들어온 문의 보여줘": plan("INQUIRY_VOLUME", "오늘 들어온 문의", { inquiryIntent: "ROWS", period: "TODAY" }),
  "오늘 네이버 문의 중 최근 2개만 보여줘": plan("INQUIRY_VOLUME", "오늘 네이버 문의 최근 2개", { inquiryIntent: "ROWS", period: "TODAY", channel: "NAVER", order: "NEWEST", limit: 2 }),
  "답변 안 한 문의만 보여줘": plan("INQUIRY_VOLUME", "미답변 문의만", { inquiryIntent: "ROWS", status: "UNANSWERED" }),
  "최근 문의 5개 보여줘": plan("INQUIRY_VOLUME", "최근 문의 5개", { inquiryIntent: "ROWS", order: "NEWEST", limit: 5 }),
  "그중 네이버만": plan("INQUIRY_VOLUME", "방금 본 문의 중 네이버만", { inquiryIntent: "ROWS", scope: "WORKING_SET", channel: "NAVER" }),
  "그중 최근 1개": plan("INQUIRY_VOLUME", "방금 본 문의 중 가장 최근 1개", { inquiryIntent: "ROWS", scope: "WORKING_SET", order: "NEWEST", limit: 1 }),
  "답변 안 한 것만": plan("INQUIRY_VOLUME", "방금 본 문의 중 미답변만", { inquiryIntent: "ROWS", scope: "WORKING_SET", status: "UNANSWERED" }),
  "내가 답해야 할 문의 정리해줘": plan("INQUIRY_VOLUME", "내가 답해야 할 문의", { inquiryIntent: "WORKLOAD" }),
  "미답변 문의 몇 건이야?": plan("INQUIRY_VOLUME", "미답변 문의 수", { inquiryIntent: "COUNT" }),
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

describe("Query Accuracy v1 — Planner QuerySpec → tool args → result", () => {
  it("「가장 최근 리뷰 1개만」: order to the backend, limit on the rows, total still the window's", async () => {
    const { h, id } = await fresh();
    const { turn } = await say(h, id, "가장 최근 리뷰 1개만 보여줘");
    expect(h.operator.recentReviewParams.at(-1)).toMatchObject({ order: "NEWEST", size: 50 });
    const list = artifact(turn, "REVIEW_LIST");
    expect(list.items).toHaveLength(1);
    expect(list.items[0]!.reviewId).toBe("r-1");
    expect(list.totalCount).toBe(3);
    expect(turn.message).toContain("가장 최근 1건");
  });

  it("「가장 오래된 리뷰 1개만」: OLDEST reaches the backend — not the newest page reversed", async () => {
    const { h, id } = await fresh();
    const { turn } = await say(h, id, "가장 오래된 리뷰 1개만 보여줘");
    expect(h.operator.recentReviewParams.at(-1)).toMatchObject({ order: "OLDEST" });
    expect(artifact(turn, "REVIEW_LIST").items).toHaveLength(1);
  });

  it("「최근 문의 3개」: the ROWS read, not the work queue — newest 3 of every status, no count summary", async () => {
    const { h, id } = await fresh();
    const { turn } = await say(h, id, "최근 문의 3개 보여줘");
    expect(h.inquiry.rowsParams).toEqual([{ status: "ALL", order: "NEWEST", limit: 3 }]);
    expect(h.inquiry.calls.list).toBe(0);
    expect(h.operator.calls.inbox).toBe(0);
    expect(ids(turn)).toEqual(["i-n3", "i-c1", "i-n2"]);
    expect(artifact(turn, "INQUIRY_LIST").totalCount).toBe(7);
    expect(turn.message).not.toContain("답변 대기열");
    expect(turn.continuation.workingSet).toMatchObject({ kind: "INQUIRIES", ids: ["i-n3", "i-c1", "i-n2"], filters: { inquiryIntent: "ROWS", status: "ALL" } });
  });

  it("「가장 오래된 문의 1개」: OLDEST + limit 1 — one row, from 2016", async () => {
    const { h, id } = await fresh();
    const { turn } = await say(h, id, "가장 오래된 문의 1개 보여줘");
    expect(h.inquiry.rowsParams).toEqual([{ status: "ALL", order: "OLDEST", limit: 1 }]);
    expect(ids(turn)).toEqual(["i-2016"]);
  });

  it("「오늘 들어온 문의」: the period reaches the tool as a window; a 2016 inquiry cannot appear", async () => {
    const { h, id } = await fresh();
    const { turn } = await say(h, id, "오늘 들어온 문의 보여줘");
    expect(h.inquiry.rowsParams).toEqual([{ from: TODAY, to: TODAY, status: "ALL", order: "NEWEST", limit: 50 }]);
    expect(ids(turn)).toEqual(["i-n3", "i-c1", "i-n2", "i-n1"]);
    expect(artifact(turn, "INQUIRY_LIST").scope).toMatchObject({ period: { token: "TODAY" }, status: "ALL" });
  });

  it("「오늘 네이버 문의 중 최근 2개만」: period AND channel AND order AND limit all survive to the tool", async () => {
    const { h, id } = await fresh();
    const { turn } = await say(h, id, "오늘 네이버 문의 중 최근 2개만 보여줘");
    expect(h.inquiry.rowsParams).toEqual([{ from: TODAY, to: TODAY, channel: "NAVER", status: "ALL", order: "NEWEST", limit: 2 }]);
    expect(ids(turn)).toEqual(["i-n3", "i-n2"]);
    expect(artifact(turn, "INQUIRY_LIST").groups.flatMap((g) => g.items).every((i) => i.channelCode === "NAVER")).toBe(true);
  });

  it("「답변 안 한 문의만」: status is the inquiry's own answered state, not a work-queue phase", async () => {
    const { h, id } = await fresh();
    const { turn } = await say(h, id, "답변 안 한 문의만 보여줘");
    expect(h.inquiry.rowsParams).toEqual([{ status: "UNANSWERED", order: "NEWEST", limit: 50 }]);
    expect(ids(turn)).toEqual(["i-c1", "i-n2", "i-n1", "i-0820", "i-2016"]);
    expect(artifact(turn, "INQUIRY_LIST").groups.map((g) => g.key)).toEqual(["UNANSWERED"]);
    expect(turn.message).not.toContain("답변 대기열");
  });

  it("refine chain: 최근 5개 → 그중 네이버만 → 그중 최근 1개 → 답변 안 한 것만 — each stands on the previous set", async () => {
    const { h, id } = await fresh();
    const first = await say(h, id, "최근 문의 5개 보여줘");
    expect(ids(first.turn)).toEqual(["i-n3", "i-c1", "i-n2", "i-n1", "i-c2"]);

    const naver = await say(h, id, "그중 네이버만");
    expect(h.inquiry.rowsParams.at(-1)).toEqual({ channel: "NAVER", status: "ALL", order: "NEWEST", limit: 50 });
    expect(ids(naver.turn)).toEqual(["i-n3", "i-n2", "i-n1"]);
    expect(naver.turn.message).toContain("방금 본 문의 중");
    expect(h.operator.planPriorContexts.at(-1)).toContain("직전 작업 집합: INQUIRIES");
    expect(naver.turn.continuation.workingSet?.filters).toMatchObject({ channelCode: "NAVER", status: "ALL", inquiryIntent: "ROWS" });

    const one = await say(h, id, "그중 최근 1개");
    expect(h.inquiry.rowsParams.at(-1)).toEqual({ channel: "NAVER", status: "ALL", order: "NEWEST", limit: 50 });
    expect(ids(one.turn)).toEqual(["i-n3"]);

    // 「답변 안 한 것만」 over a set whose one row is answered: an honest 0, and the anchor stays.
    const open = await say(h, id, "답변 안 한 것만");
    expect(h.inquiry.rowsParams.at(-1)).toEqual({ channel: "NAVER", status: "UNANSWERED", order: "NEWEST", limit: 50 });
    expect(ids(open.turn)).toEqual([]);
    expect(open.turn.message).toContain("없습니다");
    expect(open.turn.continuation.workingSet?.ids).toEqual(["i-n3"]);
  });

  it("「내가 답해야 할 문의」 is the work queue (WORKLOAD), 「몇 건이야」 is one number (COUNT) — three paths, one token each", async () => {
    const { h, id } = await fresh();
    const work = await say(h, id, "내가 답해야 할 문의 정리해줘");
    expect(h.inquiry.calls.rows).toBe(0);
    expect(h.inquiry.calls.list).toBe(2);
    expect(artifact(work.turn, "INQUIRY_LIST").groups.flatMap((g) => g.items).every((i) => i.workItemId != null)).toBe(true);
    expect(work.turn.continuation.workingSet?.filters.inquiryIntent).toBe("WORKLOAD");

    const { h: h2, id: id2 } = await fresh();
    const count = await say(h2, id2, "미답변 문의 몇 건이야?");
    expect(h2.inquiry.calls.rows).toBe(0);
    expect(h2.operator.calls.inbox).toBe(1);
    expect(count.turn.artifacts.some((a) => a.type === "INQUIRY_LIST")).toBe(false);
  });

  it("a filter the tool schema does not name cannot be dropped silently: the workload read sees the channel", async () => {
    const { h, id } = await fresh();
    const withChannel = plan("INQUIRY_VOLUME", "네이버 처리할 문의", { inquiryIntent: "WORKLOAD", channel: "NAVER" });
    const hh = harness({ plansByGoal: { ...PLANS, "네이버 처리할 문의 정리해줘": withChannel } }, seeds().open);
    void h; void id;
    const view = await hh.service.create(TOKEN);
    const { turn } = await say(hh, view.conversationId, "네이버 처리할 문의 정리해줘");
    const items = artifact(turn, "INQUIRY_LIST").groups.flatMap((g) => g.items);
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.channelCode === "NAVER")).toBe(true);
  });

  it("the judge round-trip is paid once per org, not once per turn, while the capability is off", async () => {
    const { h, id } = await fresh();
    await say(h, id, "최근 문의 3개 보여줘");
    const after1 = h.operator.calls.judge;
    await say(h, id, "가장 오래된 문의 1개 보여줘");
    expect(h.operator.calls.judge).toBe(after1);
  });
});
