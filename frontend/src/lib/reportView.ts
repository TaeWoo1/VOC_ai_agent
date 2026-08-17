// Pure derivation for the weekly customer-operations report. No React, no I/O.
//
// THE RULE: every line is computed from a source that loaded. A source that failed contributes NO
// line — not a zero, not a placeholder. A report is read as a statement of fact, so a fabricated
// row here is worse than a shorter report.
//
// There are no outcome claims anywhere in this module (매출, 전환율, 만족도). Nothing in the data
// measures them, and a report that asserts them teaches the reader to distrust the rows that are
// true.

import type { FeedItem, ItemAnalysis, ReviewIssueView } from "./types";
import { needsReply } from "./inboxWorkspace";
import { changedIssues, improvedIssues } from "./reviewIssuesView";
import { buildReviewToday, type ReviewSource, type TodayBreakdown } from "./todayInbox";

/** The recommended-action vocabulary the rule-based analyzer emits that this report reports on. */
export const FAQ_CANDIDATE = "FAQ 후보";
export const DETAIL_PAGE_CANDIDATE = "상세페이지 개선 후보";

export interface ReportSection<T> {
  /** False when the source did not load. The section renders as unavailable, never as empty. */
  available: boolean;
  value: T;
}

export interface WeeklyReport {
  /** True when at least one source produced something to report. */
  hasAnything: boolean;
  issuesNeedingReview: ReportSection<ReviewIssueView[]>;
  issuesImproved: ReportSection<ReviewIssueView[]>;
  unansweredInquiries: ReportSection<number>;
  /**
   * 확인이 필요한 리뷰 — the canonical definition (triage tier NEEDS_ATTENTION per account, the same
   * number the 리뷰 screen shows under that filter; `todayInbox.buildReviewToday`). Not the feed's
   * low-rating rule: the report used to count 2-star-or-negative feed rows here, which put a
   * different number on this page than on 홈 and 리뷰 for the same words.
   */
  reviewsToCheck: ReportSection<number>;
  /** Per-account shares of `reviewsToCheck`, each with the destination that shows exactly that count. */
  reviewsToCheckShares: TodayBreakdown[];
  /** Where the 확인이 필요한 리뷰 figure may link as a whole (one account), or null. */
  reviewsToCheckTo: string | null;
  faqCandidates: ReportSection<number>;
  detailPageCandidates: ReportSection<number>;
  /** Sentences for the "대표 보고용" block. Only lines whose source loaded. */
  summaryLines: string[];
}

function countAction(analyses: readonly ItemAnalysis[], action: string): number {
  return analyses.filter((analysis) => analysis.recommendedAction === action).length;
}

/**
 * Builds the report.
 *
 * `issues` / `inbox` are null when their read failed. Analyses are optional enrichment: an empty
 * list is indistinguishable from a failed read for this purpose, so the candidate sections are
 * marked available only when the inbox itself loaded (analyses without an inbox describe nothing).
 */
export function buildWeeklyReport(
  issues: readonly ReviewIssueView[] | null,
  inbox: readonly FeedItem[] | null,
  analyses: readonly ItemAnalysis[],
  reviewSources: readonly ReviewSource[] | null,
  topLimit = 5,
): WeeklyReport {
  const issuesAvailable = issues !== null;
  const inboxAvailable = inbox !== null;
  const reviews = buildReviewToday(reviewSources);
  // "Nothing connected" is a measured zero for a report; only a failed read is unavailable.
  const reviewsAvailable = reviews.signal.kind !== "UNAVAILABLE";
  const toCheck = reviews.signal.kind === "READY" ? reviews.signal.count : 0;

  const needsReviewList = issuesAvailable
    ? changedIssues([...(issues as ReviewIssueView[])]).slice(0, topLimit)
    : [];
  const improvedList = issuesAvailable
    ? improvedIssues([...(issues as ReviewIssueView[])]).slice(0, topLimit)
    : [];
  const unanswered = inboxAvailable ? (inbox as FeedItem[]).filter(needsReply).length : 0;
  const faq = inboxAvailable ? countAction(analyses, FAQ_CANDIDATE) : 0;
  const detailPage = inboxAvailable ? countAction(analyses, DETAIL_PAGE_CANDIDATE) : 0;

  const summaryLines: string[] = [];
  if (issuesAvailable) {
    summaryLines.push(
      needsReviewList.length > 0
        ? `확인이 필요한 반복 문제 ${needsReviewList.length}건을 정리했습니다.`
        : "이번 기간에 새로 확인이 필요한 반복 문제는 없었습니다.",
    );
    if (improvedList.length > 0) {
      summaryLines.push(`관련 리뷰가 줄어든 문제가 ${improvedList.length}건 있습니다.`);
    }
  }
  if (inboxAvailable) {
    summaryLines.push(
      reviewsAvailable
        ? `답변이 필요한 문의 ${unanswered}건, 확인이 필요한 리뷰 ${toCheck}건입니다.`
        : `답변이 필요한 문의 ${unanswered}건입니다.`,
    );
  } else if (reviewsAvailable) {
    summaryLines.push(`확인이 필요한 리뷰 ${toCheck}건입니다.`);
  }
  if (inboxAvailable) {
    if (faq > 0 || detailPage > 0) {
      summaryLines.push(
        `자주 나오는 질문 ${faq}건, 상세페이지에서 다룰 만한 내용 ${detailPage}건이 후보로 잡혔습니다.`,
      );
    }
  }

  return {
    hasAnything: issuesAvailable || inboxAvailable || reviewsAvailable,
    issuesNeedingReview: { available: issuesAvailable, value: needsReviewList },
    issuesImproved: { available: issuesAvailable, value: improvedList },
    unansweredInquiries: { available: inboxAvailable, value: unanswered },
    reviewsToCheck: { available: reviewsAvailable, value: toCheck },
    reviewsToCheckShares: reviews.breakdown,
    // Unavailable still offers the way in; several accounts offer their shares instead.
    reviewsToCheckTo: reviews.to ?? (reviewsAvailable ? null : "/reviews"),
    faqCandidates: { available: inboxAvailable, value: faq },
    detailPageCandidates: { available: inboxAvailable, value: detailPage },
    summaryLines,
  };
}
