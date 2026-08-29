/**
 * Acceptance Closure — the freshness table (§8), the review-intent plan token (§9), the Coupang / unknown
 * capability fence (§10) and the NONE-identity refusal (§11), each through the real graph over seeded fakes.
 */
import { describe, expect, it } from "vitest";
import {
  CAFE24_ACCOUNT, COUPANG_ACCOUNT, TODAY, TOKEN, artifact, coverageRow, freshReviews, harness, say,
  staleCoupangCoverage,
} from "./support";
import { CONVERSATION_PLANS, RECORDED_PLANS } from "../support/recordedPlans";
import { LIVE_RECORDED_PLANS } from "../support/liveRecordedPlans";
import type { AgentPlanView, RecentReviewsResponse } from "../../src/spring/types";
import { MOLDING } from "../support/operatorFixtures";

const V3 = "agent-plan-prompt/v3";

function reviewPlan(goal: string, filters: AgentPlanView["filters"], extra: Partial<AgentPlanView> = {}): AgentPlanView {
  return {
    available: true, supported: true, userGoal: goal, unresolvedEntities: [],
    informationNeeds: [{ id: "n1", question: "리뷰는 무엇인가", kind: "REVIEW_SIGNAL", why: "리뷰가 질문이다", required: true }],
    specialists: ["REVIEW_OPS"], tools: ["list_recent_reviews", "search_review_issues"], retrievalOrder: ["n1"], retrievalParallel: [],
    retrievalStopWhen: null, evidenceRequirements: [{ needId: "n1", minEvidence: 1, acceptableKinds: ["REVIEW_LIST", "REVIEW_ISSUE"] }],
    riskClass: "ROUTINE", maxIterations: 1, maxToolCalls: 6, stopWhenEnough: null, clarificationNeeded: false,
    clarificationReason: null, rationale: "리뷰", providerVersion: V3,
    requestedAction: "NONE", tone: null, filters, target: { selector: "NONE", index: null }, ...extra,
  };
}

const NO = { period: null, rating: null, channel: null, scope: null, topic: null };
const PLANS: Record<string, AgentPlanView> = {
  ...RECORDED_PLANS, ...CONVERSATION_PLANS,
  // Authored: ROWS with NO period at all — the token alone must route to rows.
  "최근 리뷰 목록 보여줘": reviewPlan("최근 들어온 리뷰를 보고 싶다", { ...NO, reviewIntent: "ROWS" }),
  // LIVE recordings of the two natural variants (see liveRecordedPlans.ts).
  ...LIVE_RECORDED_PLANS,
  "첫 번째 리뷰 답변해줘": reviewPlan("방금 본 첫 번째 리뷰의 답글을 준비한다", { ...NO, scope: "WORKING_SET" },
    { requestedAction: "PREPARE_INQUIRY_DRAFT", target: { selector: "FIRST", index: null } }),
  "좋아 게시해": reviewPlan("준비한 답글을 채널에 게시한다", { ...NO, scope: "WORKING_SET" },
    { requestedAction: "REQUEST_SEND_APPROVAL", target: { selector: "FIRST", index: null } }),
};

function staleCafe24() {
  return [
    coverageRow({ state: "OBSERVED_FRESHNESS_UNPROVEN", lastSuccessfulSyncAt: "2026-01-01T00:00:00Z" }),
    coverageRow({ channelCode: "COUPANG", channelNameKo: "쿠팡", state: "OBSERVED_FRESH" }),
    coverageRow({ channelCode: "NAVER", channelNameKo: "네이버", state: "OBSERVED_FRESH" }),
  ];
}

function coupangRows(identity: "MARKETPLACE" | "NONE" = "MARKETPLACE"): RecentReviewsResponse {
  const base = freshReviews();
  return {
    ...base, total: 1,
    items: [{ id: "r-cp", sellerAccountId: COUPANG_ACCOUNT, channelCode: "COUPANG", channelNameKo: "쿠팡", writtenOn: TODAY,
      rating: 1, negative: true, preview: "포장이 찢어져 왔어요", productId: MOLDING.id, productName: MOLDING.name, replyState: "NONE",
      executableIdentity: identity }],
  };
}

async function fresh(seed: Parameters<typeof harness>[0] = {}) {
  const h = harness({ plansByGoal: PLANS, ...seed });
  const view = await h.service.create(TOKEN);
  return { h, id: view.conversationId };
}

describe("§8 — acquisition capability ≠ freshness: the AUTOMATIC branch, case by case", () => {
  it("AUTOMATIC + stale + SUCCESS: the agent refreshes itself, no human step, the channel reads FRESH", async () => {
    const { h, id } = await fresh();
    h.recentReviews["false:ALL"] = freshReviews(staleCafe24());
    const { turn, stages } = await say(h, id, "오늘 새로 달린 리뷰 보여줘");
    expect(turn.status).toBe("DONE");
    expect(stages).toContain("REFRESHING");
    expect(h.inquiry.manualSyncCalls).toEqual([{ accountId: CAFE24_ACCOUNT, dataType: "REVIEW" }]);
    expect(turn.artifacts.some((a) => a.type === "HUMAN_ACTION_REQUIRED")).toBe(false);
    expect(artifact(turn, "REVIEW_LIST").freshness.find((f) => f.channelCode === "CAFE24")?.verdict).toBe("FRESH");
    expect(turn.message).not.toContain("판매자님의 한 번의 작업");
  });

  it("AUTOMATIC + QUEUED: a run that has not finished is not a collection — nothing is claimed fresh", async () => {
    const { h, id } = await fresh();
    h.recentReviews["false:ALL"] = freshReviews(staleCafe24());
    h.inquiry.manualSyncBehavior = { runStatus: "QUEUED" };
    const { turn } = await say(h, id, "오늘 새로 달린 리뷰 보여줘");
    expect(turn.status).toBe("DONE");
    expect(artifact(turn, "REVIEW_LIST").freshness.find((f) => f.channelCode === "CAFE24")?.verdict).toBe("UNPROVEN");
    expect(turn.message).toContain("이미 수집이 진행 중입니다");
    expect(turn.message).not.toMatch(/오늘 것은 0건/);
  });

  it("AUTOMATIC + FAILED: said as a failed refresh, rows shown as stale, never 「0건」", async () => {
    const { h, id } = await fresh();
    h.recentReviews["false:ALL"] = { ...freshReviews(staleCafe24()), items: [], total: 0 };
    h.inquiry.manualSyncBehavior = { runStatus: "FAILED" };
    const { turn } = await say(h, id, "오늘 새로 달린 리뷰 보여줘");
    expect(turn.message).toContain("수집이 실패했습니다");
    expect(turn.message).toContain("1월 1일 기준으로 보여 드립니다.");
    expect(turn.message).not.toMatch(/0건/);
    expect(turn.artifacts.some((a) => a.type === "HUMAN_ACTION_REQUIRED")).toBe(false);
  });

  it("AUTOMATIC + PARTIAL: shown, said as partial, and NOT promoted to FRESH", async () => {
    const { h, id } = await fresh();
    h.recentReviews["false:ALL"] = freshReviews(staleCafe24());
    h.inquiry.manualSyncBehavior = { runStatus: "PARTIAL", successRows: 1 };
    const { turn } = await say(h, id, "오늘 새로 달린 리뷰 보여줘");
    expect(turn.message).toContain("일부만 가져왔습니다");
    expect(artifact(turn, "REVIEW_LIST").freshness.find((f) => f.channelCode === "CAFE24")?.verdict).toBe("UNPROVEN");
    expect(h.inquiry.manualSyncCalls).toHaveLength(1);
  });

  it("GUIDED pending: the same window asked again gets no second card, and still no 「0건」", async () => {
    const { h, id } = await fresh();
    h.recentReviews["false:ALL"] = { ...freshReviews(staleCoupangCoverage()), items: [], total: 0 };
    const first = await say(h, id, "오늘 새로 달린 리뷰 보여줘");
    expect(first.turn.status).toBe("WAITING_HUMAN");
    const again = await say(h, id, "오늘 새로 달린 리뷰 보여줘");
    expect(again.turn.artifacts.filter((a) => a.type === "HUMAN_ACTION_REQUIRED")).toHaveLength(0);
    expect(again.turn.message).not.toMatch(/오늘 것은 0건/);
    expect(again.turn.message).toContain("쿠팡 리뷰는 8월 20일 이후 아직 확인하지 못했어요.");
  });

  it("GUIDED completed: only THIS account's run (or an upload-shaped run on its channel) satisfies the step", async () => {
    const { h, id } = await fresh();
    h.recentReviews["false:ALL"] = freshReviews(staleCoupangCoverage());
    const first = await say(h, id, "오늘 새로 달린 리뷰 보여줘");
    // An unrelated account's run on the same channel: not this step.
    h.inquiry.syncRuns.push({
      id: "run-other", sellerAccountId: "acc-other", channelId: "chan-coupang", dataType: "REVIEW", trigger: "MANUAL",
      status: "SUCCESS", successRows: 9, startedAt: "2099-01-01T00:00:00Z", finishedAt: "2099-01-01T00:01:00Z",
    } as never);
    const still = await say(h, id, "", { resumeOfTurnId: first.turn.turnId });
    expect(still.turn.status).toBe("WAITING_HUMAN");
    // An upload-shaped run on the account's channel (no account on the row, uploadType REVIEW): this step.
    h.inquiry.syncRuns.push({
      id: "run-upload", sellerAccountId: null, channelId: "chan-coupang", dataType: null, uploadType: "REVIEW", trigger: "UPLOAD",
      status: "SUCCESS", successRows: 2, startedAt: "2099-01-01T00:00:00Z", finishedAt: "2099-01-01T00:02:00Z",
    } as never);
    h.recentReviews["false:ALL"] = freshReviews();
    const done = await say(h, id, "", { resumeOfTurnId: first.turn.turnId });
    expect(done.turn.status).toBe("DONE");
    expect(done.turn.resumedFrom).toBe(first.turn.turnId);
  });

  it("GUIDED completed PARTIAL: resumed, said as partial, the channel not claimed fresh", async () => {
    const { h, id } = await fresh();
    h.recentReviews["false:ALL"] = freshReviews(staleCoupangCoverage());
    const first = await say(h, id, "오늘 새로 달린 리뷰 보여줘");
    h.inquiry.syncRuns.push({
      id: "run-p", sellerAccountId: COUPANG_ACCOUNT, channelId: "chan-coupang", dataType: "REVIEW", trigger: "MANUAL",
      status: "PARTIAL", successRows: 1, startedAt: "2099-01-01T00:00:00Z", finishedAt: "2099-01-01T00:01:00Z",
    } as never);
    const done = await say(h, id, "", { resumeOfTurnId: first.turn.turnId });
    expect(done.turn.status).toBe("DONE");
    expect(done.turn.message).toContain("일부만");
    expect(artifact(done.turn, "REVIEW_LIST").freshness.find((f) => f.channelCode === "COUPANG")?.verdict).not.toBe("FRESH");
  });
});

describe("§9 — the plan says what the review need is FOR; a rows request never reads repeated problems", () => {
  it("reviewIntent ROWS with no period → the rows for the default window, no ISSUE reader, no 「반복 문제 없음」", async () => {
    const { h, id } = await fresh();
    const { turn } = await say(h, id, "최근 리뷰 목록 보여줘");
    expect(turn.status).toBe("DONE");
    expect(artifact(turn, "REVIEW_LIST").items).toHaveLength(3);
    expect(turn.artifacts.some((a) => a.type === "ISSUE_LIST")).toBe(false);
    expect(turn.message).not.toContain("반복");
    expect(h.operator.calls.recentReviews).toBeGreaterThan(0);
  });

  it("LIVE recording: 「요즘 들어온 리뷰 보여줘」 planned ROWS (LAST_7_DAYS) → REVIEW_LIST, never the issues sentence", async () => {
    const { h, id } = await fresh();
    const { turn } = await say(h, id, "요즘 들어온 리뷰 보여줘");
    expect(turn.status).toBe("DONE");
    expect(artifact(turn, "REVIEW_LIST").scope.period?.token).toBe("LAST_7_DAYS");
    expect(turn.message).not.toContain("반복");
  });

  it("reviewIntent ISSUES with a period → the repeated-problems reader, not the rows", async () => {
    const { h, id } = await fresh();
    const { turn } = await say(h, id, "리뷰에서 반복되는 문제 있어?");
    expect(turn.status).toBe("DONE");
    expect(turn.artifacts.some((a) => a.type === "REVIEW_LIST")).toBe(false);
  });
});

describe("§10 — Coupang review reply is NOT_SUPPORTED; an unreadable capability is not a loophole", () => {
  it("CHANNEL_UNSUPPORTED (the real executionReason shape) → SUMMARY + servable chips, no DRAFT, no triage write", async () => {
    const { h, id } = await fresh({
      reviewChannelCapabilities: {
        [COUPANG_ACCOUNT]: { replySupported: false, executionKind: "NOT_SUPPORTED", executionReason: "CHANNEL_UNSUPPORTED" } as never,
        [CAFE24_ACCOUNT]: { replySupported: true, executionKind: "API_EXECUTION" } as never,
      },
    });
    h.recentReviews["false:ALL"] = coupangRows();
    await say(h, id, "오늘 새로 달린 리뷰 보여줘");
    const { turn } = await say(h, id, "첫 번째 리뷰 답변해줘");
    expect(turn.artifacts.some((a) => a.type === "DRAFT")).toBe(false);
    expect(turn.message).toContain("쿠팡에서는 판매자가 리뷰에 직접 답글을 남기는 기능을 지원하지 않습니다");
    expect(turn.suggestedActions.map((s) => s.label)).toEqual(
      expect.arrayContaining(["이 상품 리뷰 더 보여줘", "이 상품 관련 문의 확인해줘", "이 상품에 반복되는 문제 있어?"]));
    expect(turn.suggestedActions.map((s) => s.label)).not.toContain("상세페이지 개선 검토");
    expect(h.operator.calls.reviewChannelCapability).toBeGreaterThan(0);
  });

  it("capability read fails (CAPABILITY_UNKNOWN) → no draft is prepared, and 「게시해」 gets no approval", async () => {
    const { h, id } = await fresh({ reviewChannelCapabilities: { [CAFE24_ACCOUNT]: { replySupported: true, executionKind: "API_EXECUTION" } as never } });
    h.recentReviews["false:ALL"] = coupangRows();
    await say(h, id, "오늘 새로 달린 리뷰 보여줘");
    const prepared = await say(h, id, "첫 번째 리뷰 답변해줘");
    expect(prepared.turn.artifacts.some((a) => a.type === "DRAFT")).toBe(false);
    expect(prepared.turn.message).toContain("확인하지 못해 초안을 준비하지 않았습니다");
    const send = await say(h, id, "좋아 게시해");
    expect(send.turn.artifacts.some((a) => a.type === "APPROVAL" || a.type === "GUIDED_EXECUTION")).toBe(false);
  });
});

describe("E — an OPEN inquiry is proposed through the product's own seam before its draft is generated", () => {
  it("propose → generate → GROUNDED v1; a second draft on the same item does not propose again", async () => {
    const { h, id } = await fresh();
    await say(h, id, "오늘 내가 답해야 할 문의 정리해줘");
    const { turn } = await say(h, id, "첫 번째 거 답변 준비해줘");
    const draft = artifact(turn, "DRAFT");
    expect(draft.answerBasis).toBe("GROUNDED");
    expect(draft.version).toBe(1);
    expect(h.inquiry.calls.propose).toBe(1);
    const again = await say(h, id, "조금 더 부드럽게 써줘");
    expect(artifact(again.turn, "DRAFT").version).toBe(2);
    expect(h.inquiry.calls.propose).toBe(1);
  });
});

describe("§11 — a NONE-identity review gets copy only, whatever the channel can do", () => {
  it("「게시해」 on a file-imported Cafe24 row → no APPROVAL, the copy-only sentence", async () => {
    const { h, id } = await fresh();
    const rows = freshReviews();
    h.recentReviews["false:ALL"] = { ...rows, items: rows.items.map((r) => ({ ...r, executableIdentity: "NONE" as const })) };
    await say(h, id, "오늘 새로 달린 리뷰 보여줘");
    const { turn } = await say(h, id, "좋아 게시해");
    expect(turn.artifacts.some((a) => a.type === "APPROVAL" || a.type === "GUIDED_EXECUTION")).toBe(false);
    expect(turn.message).toContain("채널로 보낼 수 없습니다");
  });
});
