/**
 * Freshness UX v1 — the four facts the answer keeps apart (last successful observation · requested
 * window · freshness verdict · acquisition capability), and what each is allowed to make the seller read.
 *
 *  - a question answerable from held rows shows the RESULT first, 「채널 · 언제 기준」 compactly, and OFFERS a
 *    refresh (turn DONE, `optional` card);
 *  - a question that needs current rows (「오늘」) names the channel and the instant it was last observed,
 *    and asks for exactly that channel's step (WAITING_HUMAN);
 *  - Cafe24 (AUTOMATIC) refreshes itself either way; NAVER / Coupang (GUIDED) get their guided path;
 *  - partial / failed collections are said once, as what they are;
 *  - an unrelated sync (another data type, another account) satisfies nothing;
 *  - resume shows the ORIGINAL request's result; claim levels stay B/C, never A.
 */
import { describe, expect, it } from "vitest";
import {
  CAFE24_ACCOUNT, COUPANG_ACCOUNT, TODAY, TOKEN, artifact, coverageRow, freshReviews, harness, say, staleCoupangCoverage,
} from "./support";
import { CONVERSATION_PLANS, RECORDED_PLANS } from "../support/recordedPlans";
import type { AgentPlanView, RecentReviewsResponse } from "../../src/spring/types";
import type { HumanActionRequiredArtifact, ReviewListArtifact } from "../../src/conversation/contract";
import { asOfWord, asOfStatus } from "../../src/conversation/asOf";
import { isFreshnessRequired, rowsSentence, staleSentence } from "../../src/operator/graph/reviewRows";

function reviewPlan(goal: string, filters: AgentPlanView["filters"]): AgentPlanView {
  return {
    available: true, supported: true, userGoal: goal, unresolvedEntities: [],
    informationNeeds: [{ id: "n1", question: "리뷰는 무엇인가", kind: "REVIEW_SIGNAL", why: "리뷰가 질문이다", required: true }],
    specialists: ["REVIEW_OPS"], tools: ["list_recent_reviews", "search_review_issues"], retrievalOrder: ["n1"], retrievalParallel: [],
    retrievalStopWhen: null, evidenceRequirements: [{ needId: "n1", minEvidence: 1, acceptableKinds: ["REVIEW_LIST", "REVIEW_ISSUE"] }],
    riskClass: "ROUTINE", maxIterations: 1, maxToolCalls: 6, stopWhenEnough: null, clarificationNeeded: false,
    clarificationReason: null, rationale: "리뷰", providerVersion: "agent-plan-prompt/v4",
    requestedAction: "NONE", tone: null, filters, target: { selector: "NONE", index: null },
  };
}
const NO = { period: null, rating: null, channel: null, scope: null, topic: null };
const PLANS: Record<string, AgentPlanView> = {
  ...RECORDED_PLANS, ...CONVERSATION_PLANS,
  // The two browser-QA sentences: one needs current rows, one is answered from what is held.
  "별점 2점 이하 리뷰 보여줘": reviewPlan("낮은 평점 리뷰를 본다", { ...NO, rating: "LOW", reviewIntent: "ROWS" }),
  "오늘 리뷰 뭐 들어왔어?": reviewPlan("오늘 들어온 리뷰를 본다", { ...NO, period: "TODAY", reviewIntent: "ROWS" }),
};

const NAVER_ACCOUNT = "acct-naver";
function withNaver(h: ReturnType<typeof harness>) {
  h.inquiry.sellerAccounts.push({ id: NAVER_ACCOUNT, channelId: "chan-naver", channelNameKo: "네이버", alias: null,
    connectionStatus: "CONNECTED", lastSyncedAt: null, fileUpload: true });
  return h;
}
const staleNaver = () => [
  coverageRow({}),
  coverageRow({ channelCode: "COUPANG", channelNameKo: "쿠팡", state: "ZERO", rows: 0, openRows: 0, newestObservedAt: null }),
  coverageRow({ channelCode: "NAVER", channelNameKo: "네이버", state: "NOT_SUPPORTED", supported: false, connected: true,
    rows: 40, openRows: 2, lastSuccessfulSyncAt: "2026-08-10T00:00:00Z", newestObservedAt: "2026-08-09T00:00:00Z" }),
];
const staleCafe24 = () => [
  coverageRow({ state: "OBSERVED_FRESHNESS_UNPROVEN", lastSuccessfulSyncAt: "2026-08-01T00:12:00Z" }),
  coverageRow({ channelCode: "COUPANG", channelNameKo: "쿠팡", state: "OBSERVED_FRESH" }),
  coverageRow({ channelCode: "NAVER", channelNameKo: "네이버", state: "OBSERVED_FRESH" }),
];
function lowRows(coverage = staleCoupangCoverage()): RecentReviewsResponse {
  const base = freshReviews(coverage);
  return { ...base, negativeOnly: true, total: 1,
    items: [{ id: "r-low", sellerAccountId: CAFE24_ACCOUNT, channelCode: "CAFE24", channelNameKo: "카페24", writtenOn: "2026-08-25",
      rating: 2, negative: true, preview: "접착이 약해요", productId: null, productName: null, replyState: "NONE" }] };
}
async function fresh(seed: Parameters<typeof harness>[0] = {}) {
  const h = harness({ plansByGoal: PLANS, ...seed });
  const view = await h.service.create(TOKEN);
  return { h, id: view.conversationId };
}
const humansOf = (t: { artifacts: readonly unknown[] }) =>
  (t.artifacts as Array<{ type: string }>).filter((a) => a.type === "HUMAN_ACTION_REQUIRED") as HumanActionRequiredArtifact[];
const once = (text: string, needle: string) => text.split(needle).length === 2;

describe("the vocabulary — one instant, one phrase", () => {
  it("asOfWord: today / yesterday keep the time, older days drop it, another year names the year", () => {
    expect(asOfWord(`${TODAY}T00:12:00Z`, TODAY)).toBe("오늘 09:12");
    expect(asOfWord("2026-08-26T09:40:00Z", TODAY)).toBe("어제 18:40");
    expect(asOfWord("2026-08-20T01:00:00Z", TODAY)).toBe("8월 20일");
    expect(asOfWord("2025-12-30T23:00:00Z", TODAY)).toBe("2025년 12월 31일");
    expect(asOfWord(null, TODAY)).toBeNull();
    expect(asOfStatus("네이버", `${TODAY}T00:12:00Z`, TODAY)).toBe("네이버 · 오늘 09:12 기준");
    expect(asOfStatus("네이버", null, TODAY)).toBe("네이버 · 확인 기록 없음");
  });
  it("only 「오늘 / 어제 / 이번 주」 require current rows; a stale zero is never 「0건」", () => {
    expect(isFreshnessRequired("TODAY")).toBe(true);
    expect(isFreshnessRequired("THIS_WEEK")).toBe(true);
    expect(isFreshnessRequired("LAST_7_DAYS")).toBe(false);
    expect(isFreshnessRequired(null)).toBe(false);
    expect(rowsSentence(null, "낮은 평점 ", "최근 7일", 0, true, "LAST_7_DAYS")).toBe("지금까지 확인한 범위에는 최근 7일 낮은 평점 리뷰가 없습니다.");
    expect(rowsSentence(null, "", "오늘", 0, false, "TODAY")).toBe("오늘 들어온 리뷰는 없습니다.");
    expect(staleSentence("네이버", "오늘 09:12", true)).toBe("네이버 리뷰는 오늘 09:12 이후 아직 확인하지 못했어요.");
    expect(staleSentence("네이버", "8월 20일", false)).toBe("네이버 리뷰는 8월 20일 기준입니다.");
  });
});

describe("stale data + a question the held rows can answer", () => {
  it("shows the result FIRST, the compact as-of, and OFFERS the refresh — turn DONE, one sentence, no warning", async () => {
    const { h, id } = await fresh({ recentReviews: { "true:ALL": lowRows() } });
    const { turn, stages } = await say(h, id, "별점 2점 이하 리뷰 보여줘");
    expect(turn.status).toBe("DONE");
    expect(turn.artifacts[0]!.type).toBe("REVIEW_LIST");
    const list = artifact(turn, "REVIEW_LIST") as ReviewListArtifact;
    expect(list.freshnessRequired).toBe(false);
    expect(list.referenceDate).toBe(TODAY);
    expect(list.note).toBeUndefined();
    expect(list.freshness.find((f) => f.channelCode === "COUPANG")).toMatchObject({ verdict: "UNPROVEN", lastSuccessfulSyncAt: "2026-08-20T01:00:00Z" });
    const [offer] = humansOf(turn);
    expect(offer).toMatchObject({ optional: true, channelCode: "COUPANG", path: "WING_READ_ACTION_WINDOW", asOf: "2026-08-20T01:00:00Z", title: "쿠팡 리뷰 최신 상태로 갱신" });
    expect(turn.message.startsWith("지금까지 확인한 최근 7일 낮은 평점 리뷰는 1건입니다.")).toBe(true);
    expect(once(turn.message, "쿠팡 리뷰는 8월 20일 기준입니다.")).toBe(true);
    expect(turn.message).not.toContain("최신 상태가 아닙니다");
    expect(turn.message).not.toContain("아직 확인하지 못했어요");
    expect(turn.continuation.pendingHumanActions?.[0]).toMatchObject({ optional: true, accountId: COUPANG_ACCOUNT });
    expect(turn.suggestedActions.some((s) => s.kind === "RESUME")).toBe(false);
    expect(stages).not.toContain("REFRESHING");
    expect(h.inquiry.manualSyncCalls).toHaveLength(0);
  });
  it("an offered refresh does NOT gate the next question, and a stale zero is said as a bound, not 「0건」", async () => {
    const { h, id } = await fresh({ recentReviews: { "true:ALL": { ...lowRows(), items: [], total: 0 } } });
    const first = await say(h, id, "별점 2점 이하 리뷰 보여줘");
    expect(first.turn.message).toContain("지금까지 확인한 범위에는 최근 7일 낮은 평점 리뷰가 없습니다.");
    expect(first.turn.message).not.toContain("0건");
    const again = await say(h, id, "별점 2점 이하 리뷰 보여줘");
    expect(again.turn.status).toBe("DONE");
    expect(humansOf(again.turn)).toHaveLength(1); // offered again, compactly — never a gate
  });
});

describe("stale + a question that needs current rows", () => {
  it("names the channel and its last observation once, asks for exactly that step, keeps the rows", async () => {
    const { h, id } = await fresh();
    h.recentReviews["false:ALL"] = freshReviews(staleCoupangCoverage());
    const { turn } = await say(h, id, "오늘 리뷰 뭐 들어왔어?");
    expect(turn.status).toBe("WAITING_HUMAN");
    const list = artifact(turn, "REVIEW_LIST") as ReviewListArtifact;
    expect(list.freshnessRequired).toBe(true);
    expect(list.items).toHaveLength(3);
    const [step] = humansOf(turn);
    expect(step!.optional).toBeUndefined();
    expect(step).toMatchObject({ title: "쿠팡 최신 리뷰 가져오기", asOf: "2026-08-20T01:00:00Z", reason: "FRESHNESS_UNPROVEN" });
    expect(turn.message).toContain("지금까지 확인한 오늘 리뷰는 3건입니다.");
    expect(once(turn.message, "쿠팡 리뷰는 8월 20일 이후 아직 확인하지 못했어요.")).toBe(true);
    expect(turn.message).not.toContain("카페24 리뷰는");
    expect(turn.message).not.toContain("최신 수집");
    expect(turn.message).not.toMatch(/SyncJob|coverage|sync/i);
  });
});

describe("per channel: acquisition capability decides the step, never the seller", () => {
  it("Cafe24 AUTOMATIC + stale: refreshed by the agent, no card, then answered FRESH — for a held-rows question too", async () => {
    const { h, id } = await fresh({ recentReviews: { "true:ALL": lowRows(staleCafe24()) } });
    const { turn, stages } = await say(h, id, "별점 2점 이하 리뷰 보여줘");
    expect(stages).toContain("REFRESHING");
    expect(h.inquiry.manualSyncCalls).toEqual([{ accountId: CAFE24_ACCOUNT, dataType: "REVIEW" }]);
    expect(humansOf(turn)).toHaveLength(0);
    expect(turn.status).toBe("DONE");
    expect((artifact(turn, "REVIEW_LIST") as ReviewListArtifact).freshness.find((f) => f.channelCode === "CAFE24")?.verdict).toBe("FRESH");
    expect(turn.message).toBe("최근 7일 확인 가능한 낮은 평점 리뷰가 1건입니다.");
  });
  it("NAVER GUIDED + stale: the export Action Window with the file upload as the explicit fallback", async () => {
    const { h, id } = await fresh();
    withNaver(h);
    h.recentReviews["false:ALL"] = freshReviews(staleNaver());
    const { turn } = await say(h, id, "오늘 리뷰 뭐 들어왔어?");
    expect(turn.status).toBe("WAITING_HUMAN");
    expect(humansOf(turn)[0]).toMatchObject({ channelCode: "NAVER", path: "EXPORT_ACTION_WINDOW", accountId: NAVER_ACCOUNT,
      fallback: { path: "FILE_UPLOAD" }, asOf: "2026-08-10T00:00:00Z", title: "네이버 최신 리뷰 가져오기" });
    expect(once(turn.message, "네이버 리뷰는 8월 10일 이후 아직 확인하지 못했어요.")).toBe(true);
    expect(h.inquiry.manualSyncCalls).toHaveLength(0);
  });
  it("Coupang GUIDED + stale: the WING read Action Window, requiring the local helper", async () => {
    const { h, id } = await fresh();
    h.recentReviews["false:ALL"] = freshReviews(staleCoupangCoverage());
    const { turn } = await say(h, id, "오늘 리뷰 뭐 들어왔어?");
    expect(humansOf(turn)[0]).toMatchObject({ channelCode: "COUPANG", path: "WING_READ_ACTION_WINDOW", requiresLocalAgent: true, accountId: COUPANG_ACCOUNT });
    expect(h.inquiry.manualSyncCalls).toHaveLength(0);
  });
});

describe("partial / failed acquisition", () => {
  it("a FAILED automatic refresh is said once with the as-of it falls back to; rows stay stale, no card", async () => {
    const { h, id } = await fresh({ recentReviews: { "true:ALL": lowRows(staleCafe24()) } });
    h.inquiry.manualSyncBehavior = { runStatus: "FAILED" };
    const { turn } = await say(h, id, "별점 2점 이하 리뷰 보여줘");
    expect(turn.status).toBe("DONE");
    expect(once(turn.message, "카페24 리뷰를 최신 상태로 갱신하지 못했습니다 (수집이 실패했습니다). 8월 1일 기준으로 보여 드립니다.")).toBe(true);
    expect(turn.message).not.toContain("카페24 리뷰는 8월 1일 기준입니다.");
    expect((artifact(turn, "REVIEW_LIST") as ReviewListArtifact).freshness.find((f) => f.channelCode === "CAFE24")?.verdict).toBe("UNPROVEN");
    expect(humansOf(turn)).toHaveLength(0);
  });
  it("a PARTIAL automatic refresh is shown, said as partial, and never promoted to FRESH", async () => {
    const { h, id } = await fresh();
    h.recentReviews["false:ALL"] = freshReviews(staleCafe24());
    h.inquiry.manualSyncBehavior = { runStatus: "PARTIAL", successRows: 1 };
    const { turn } = await say(h, id, "오늘 리뷰 뭐 들어왔어?");
    expect(once(turn.message, "카페24 리뷰는 일부만 가져왔습니다.")).toBe(true);
    expect((artifact(turn, "REVIEW_LIST") as ReviewListArtifact).freshness.find((f) => f.channelCode === "CAFE24")?.verdict).not.toBe("FRESH");
  });
});

describe("resume: only the requested collection satisfies the step, and the ORIGINAL request is answered", () => {
  it("an unrelated sync (another data type · another account) satisfies nothing", async () => {
    const { h, id } = await fresh();
    withNaver(h);
    h.recentReviews["false:ALL"] = freshReviews(staleNaver());
    const first = await say(h, id, "오늘 리뷰 뭐 들어왔어?");
    h.inquiry.syncRuns.push(
      { id: "inq", sellerAccountId: NAVER_ACCOUNT, channelId: "chan-naver", dataType: "INQUIRY", uploadType: null, trigger: "MANUAL",
        status: "SUCCESS", successRows: 9, startedAt: "2099-01-01T00:00:00Z", finishedAt: "2099-01-01T00:01:00Z" },
      { id: "other", sellerAccountId: COUPANG_ACCOUNT, channelId: "chan-coupang", dataType: "REVIEW", uploadType: null, trigger: "MANUAL",
        status: "SUCCESS", successRows: 9, startedAt: "2099-01-01T00:00:00Z", finishedAt: "2099-01-01T00:01:00Z" },
    );
    const { turn } = await say(h, id, "", { resumeOfTurnId: first.turn.turnId });
    expect(turn.status).toBe("WAITING_HUMAN");
    expect(turn.message).toBe("아직 수집이 끝나지 않았습니다.");
    expect(turn.artifacts.every((a) => a.type === "HUMAN_ACTION_REQUIRED")).toBe(true);
  });
  it("the requested collection lands → the original question is answered, level B, never A", async () => {
    const { h, id } = await fresh();
    withNaver(h);
    h.recentReviews["false:ALL"] = { ...freshReviews(staleNaver()), items: [], total: 0 };
    const first = await say(h, id, "오늘 리뷰 뭐 들어왔어?");
    h.inquiry.syncRuns.push({ id: "up-1", sellerAccountId: null, channelId: "chan-naver", dataType: null, uploadType: "REVIEW", trigger: "UPLOAD",
      status: "SUCCESS", successRows: 3, startedAt: "2099-01-01T00:00:00Z", finishedAt: "2099-01-01T00:02:00Z" });
    const base = freshReviews(staleNaver());
    h.recentReviews["false:ALL"] = { ...base, total: 1, items: [{ ...base.items[0]!, id: "r-nv", sellerAccountId: NAVER_ACCOUNT, channelCode: "NAVER", channelNameKo: "네이버", writtenOn: TODAY }] };
    const { turn } = await say(h, id, "", { resumeOfTurnId: first.turn.turnId });
    expect(turn.status).toBe("DONE");
    expect(turn.resumedFrom).toBe(first.turn.turnId);
    expect(turn.message.startsWith("새 리뷰 가져오기가 끝났습니다. 계속 확인하겠습니다. 오늘 확인 가능한 리뷰가 1건입니다.")).toBe(true);
    expect(turn.message).toContain("이번에 확인한 네이버 리뷰 중 오늘 작성된 리뷰는 1건입니다.");
    expect(turn.message).not.toMatch(/전부 확인|모두 확인|새로 가져왔습니다/);
    expect((artifact(turn, "REVIEW_LIST") as ReviewListArtifact).freshness.find((f) => f.channelCode === "NAVER")?.verdict).toBe("FRESH");
    expect(humansOf(turn)).toHaveLength(0);
  });
  it("level C when the run brought rows but none written in the window — 「새로 가져왔습니다」, never 「작성된」", async () => {
    const { h, id } = await fresh();
    withNaver(h);
    h.recentReviews["false:ALL"] = { ...freshReviews(staleNaver()), items: [], total: 0 };
    const first = await say(h, id, "오늘 리뷰 뭐 들어왔어?");
    h.inquiry.syncRuns.push({ id: "up-2", sellerAccountId: null, channelId: "chan-naver", dataType: null, uploadType: "REVIEW", trigger: "UPLOAD",
      status: "SUCCESS", successRows: 5, startedAt: "2099-01-01T00:00:00Z", finishedAt: "2099-01-01T00:02:00Z" });
    const { turn } = await say(h, id, "", { resumeOfTurnId: first.turn.turnId });
    expect(turn.message).toContain("이전에 없던 네이버 리뷰 5건을 새로 가져왔습니다.");
    expect(turn.message).not.toContain("작성된 리뷰는");
    expect(turn.message).toContain("오늘 들어온 리뷰는 없습니다.");
  });
  it("an OFFERED refresh the seller took resumes the same way — the rows are re-read and the offer is gone", async () => {
    const { h, id } = await fresh({ recentReviews: { "true:ALL": lowRows() } });
    const first = await say(h, id, "별점 2점 이하 리뷰 보여줘");
    expect(first.turn.status).toBe("DONE");
    h.inquiry.syncRuns.push({ id: "wing", sellerAccountId: COUPANG_ACCOUNT, channelId: "chan-coupang", dataType: "REVIEW", uploadType: null,
      trigger: "ACTION_WINDOW", status: "SUCCESS", successRows: 2, startedAt: "2099-01-01T00:00:00Z", finishedAt: "2099-01-01T00:02:00Z" });
    const { turn } = await say(h, id, "", { resumeOfTurnId: first.turn.turnId });
    expect(turn.status).toBe("DONE");
    expect(humansOf(turn)).toHaveLength(0);
    expect((artifact(turn, "REVIEW_LIST") as ReviewListArtifact).freshness.find((f) => f.channelCode === "COUPANG")?.verdict).toBe("FRESH");
    expect(turn.message).not.toContain("기준입니다");
  });
});
