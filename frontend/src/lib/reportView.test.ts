import { describe, expect, it } from "vitest";
import { DETAIL_PAGE_CANDIDATE, FAQ_CANDIDATE, buildWeeklyReport } from "./reportView";
import type { ChannelReviewPageView, FeedItem, ItemAnalysis, ReviewIssueView, SellerAccountResponse } from "./types";
import type { ReviewSource } from "./todayInbox";

function issue(over: Partial<ReviewIssueView> & Pick<ReviewIssueView, "id">): ReviewIssueView {
  return {
    title: "제목",
    aspect: "측면",
    problem: "문제",
    severity: "NORMAL",
    lifecycleState: "NEEDS_REVIEW",
    lifecycleLabelKo: "확인 필요",
    evidenceCount: 2,
    firstEvidenceOn: null,
    lastEvidenceOn: null,
    dominantProductId: null,
    dominantProductName: null,
    dismissed: false,
    extractorKind: "RULE_BASED",
    change: { kinds: [], labelsKo: [], highSurge: false, surgeWindowCount: 0, surgeBaselineWeekly: 0 },
    ...over,
  } as ReviewIssueView;
}

function feedItem(over: Partial<FeedItem> & Pick<FeedItem, "id" | "type">): FeedItem {
  return {
    channelNameKo: "채널",
    productName: "상품",
    snippet: "내용",
    rating: null,
    status: "NORMAL",
    receivedAt: "2026-08-03T00:00:00Z",
    ...over,
  } as FeedItem;
}

function analysis(action: string, id: string): ItemAnalysis {
  return {
    sourceType: "REVIEW",
    sourceId: id,
    summary: "요약",
    category: "분류",
    sentiment: "NEUTRAL",
    urgency: "NORMAL",
    recommendedAction: action,
    analyzerKind: "RULE_BASED",
    analyzerName: "rule-based",
    analyzerVersion: "rules-v1",
    createdAt: "2026-08-03T00:00:00Z",
  };
}

const warned = issue({
  id: "w",
  change: { kinds: ["SURGING"], labelsKo: ["증가 중"] } as ReviewIssueView["change"],
});
const improved = issue({
  id: "g",
  change: { kinds: ["IMPROVED"], labelsKo: ["개선됨"] } as ReviewIssueView["change"],
});
const unanswered = feedItem({ id: "i1", type: "INQUIRY", status: "UNANSWERED" });
const negative = feedItem({ id: "r1", type: "REVIEW", status: "NEGATIVE", rating: 1 });

function reviewSource(accountId: string, total: number, page: boolean = true): ReviewSource {
  const account: SellerAccountResponse = { id: accountId, channelId: `${accountId}-ch`, channelNameKo: "네이버", alias: null, connectionStatus: "CONNECTED", lastSyncedAt: null, fileUpload: false };
  return {
    account: { account, channel: { id: `${accountId}-ch`, code: "NAVER", nameKo: "네이버 스마트스토어" } as ReviewSource["account"]["channel"], label: "네이버 스마트스토어" },
    page: page
      ? ({ page: 0, size: 1, total, newCount: 0, lastImportAt: null, lastImportComplete: true, aiPilotEnabled: false, channel: { channelCode: "NAVER", aiTriage: true, originalLocate: "NONE", replySupported: true }, triageSummary: { needsAttention: total, watch: 0, fyi: 0, aiAttention: 0, repeatedCategories: [] }, items: [] } as ChannelReviewPageView)
      : null,
  };
}

describe("weekly report — every figure comes from a source that loaded", () => {
  it("reports counts when both sources loaded", () => {
    const report = buildWeeklyReport([warned, improved], [unanswered, negative], [], [reviewSource("acc-nv", 7)]);
    expect(report.issuesNeedingReview.available).toBe(true);
    expect(report.issuesNeedingReview.value.map((i) => i.id)).toEqual(["w"]);
    expect(report.issuesImproved.value.map((i) => i.id)).toEqual(["g"]);
    expect(report.unansweredInquiries).toEqual({ available: true, value: 1 });
    // 확인이 필요한 리뷰 is the triage count (7), NOT the feed's one negative row — one definition
    // shared with 홈 and the 리뷰 screen.
    expect(report.reviewsToCheck).toEqual({ available: true, value: 7 });
    expect(report.reviewsToCheckTo).toBe("/reviews/acc-nv?tier=NEEDS_ATTENTION");
    expect(report.summaryLines.join("\n")).toContain("확인이 필요한 리뷰 7건");
  });

  it("spreads the review figure over accounts with exact links when there are several", () => {
    const report = buildWeeklyReport([], [], [], [reviewSource("a", 2), reviewSource("b", 3)]);
    expect(report.reviewsToCheck).toEqual({ available: true, value: 5 });
    expect(report.reviewsToCheckTo).toBeNull();
    expect(report.reviewsToCheckShares.map((s) => [s.count, s.to])).toEqual([
      [2, "/reviews/a?tier=NEEDS_ATTENTION"],
      [3, "/reviews/b?tier=NEEDS_ATTENTION"],
    ]);
  });

  it("marks the review figure unavailable — not zero — when its reads failed, and drops it from the summary line", () => {
    const failed = buildWeeklyReport([], [unanswered], [], null);
    expect(failed.reviewsToCheck.available).toBe(false);
    expect(failed.summaryLines.join("\n")).toContain("답변이 필요한 문의 1건입니다.");
    expect(failed.summaryLines.join("\n")).not.toContain("확인이 필요한 리뷰");
    const allFailed = buildWeeklyReport([], [unanswered], [], [reviewSource("a", 2, false)]);
    expect(allFailed.reviewsToCheck.available).toBe(false);
  });

  it("marks issue sections unavailable — not zero — when their read failed", () => {
    const report = buildWeeklyReport(null, [unanswered], [], []);
    expect(report.issuesNeedingReview.available).toBe(false);
    expect(report.issuesImproved.available).toBe(false);
    // The inbox still loaded, so its own figures stay available.
    expect(report.unansweredInquiries.available).toBe(true);
  });

  it("marks inbox-derived sections unavailable when the inbox read failed", () => {
    const report = buildWeeklyReport([warned], null, [analysis(FAQ_CANDIDATE, "r1")], null);
    expect(report.unansweredInquiries.available).toBe(false);
    expect(report.reviewsToCheck.available).toBe(false);
    expect(report.faqCandidates.available).toBe(false);
    expect(report.detailPageCandidates.available).toBe(false);
  });

  it("has nothing to render when every source failed", () => {
    const report = buildWeeklyReport(null, null, [], null);
    expect(report.hasAnything).toBe(false);
    expect(report.summaryLines).toEqual([]);
  });
});

describe("weekly report — candidate counts", () => {
  it("counts the analyzer's own FAQ and detail-page verdicts", () => {
    const report = buildWeeklyReport(
      [],
      [negative],
      [
        analysis(FAQ_CANDIDATE, "r1"),
        analysis(FAQ_CANDIDATE, "r2"),
        analysis(DETAIL_PAGE_CANDIDATE, "r3"),
        analysis("답변 필요", "r4"),
      ],
      [],
    );
    expect(report.faqCandidates.value).toBe(2);
    expect(report.detailPageCandidates.value).toBe(1);
  });
});

describe("weekly report — summary lines", () => {
  it("writes a line only for a source that loaded", () => {
    const issuesOnly = buildWeeklyReport([warned], null, [], null);
    expect(issuesOnly.summaryLines.join("\n")).toContain("반복 문제");
    expect(issuesOnly.summaryLines.join("\n")).not.toContain("답변이 필요한 문의");

    const inboxOnly = buildWeeklyReport(null, [unanswered], [], null);
    expect(inboxOnly.summaryLines.join("\n")).toContain("답변이 필요한 문의");
    expect(inboxOnly.summaryLines.join("\n")).not.toContain("반복 문제");
  });

  it("says plainly when there is nothing new, rather than omitting the line", () => {
    const report = buildWeeklyReport([], [], [], []);
    expect(report.summaryLines.join("\n")).toContain("새로 확인이 필요한 반복 문제는 없었습니다");
  });

  it("asserts no business outcome anywhere", () => {
    const report = buildWeeklyReport([warned, improved], [unanswered, negative], [
      analysis(FAQ_CANDIDATE, "r1"),
    ], []);
    const text = report.summaryLines.join("\n");
    for (const claim of ["매출", "전환율", "만족도", "향상", "개선되었습니다"]) {
      expect(text).not.toContain(claim);
    }
  });
});
