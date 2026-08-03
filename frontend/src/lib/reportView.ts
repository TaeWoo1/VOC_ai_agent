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
import { needsCheck, needsReply } from "./inboxWorkspace";
import { changedIssues, improvedIssues } from "./reviewIssuesView";

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
  reviewsToCheck: ReportSection<number>;
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
  topLimit = 5,
): WeeklyReport {
  const issuesAvailable = issues !== null;
  const inboxAvailable = inbox !== null;

  const needsReviewList = issuesAvailable
    ? changedIssues([...(issues as ReviewIssueView[])]).slice(0, topLimit)
    : [];
  const improvedList = issuesAvailable
    ? improvedIssues([...(issues as ReviewIssueView[])]).slice(0, topLimit)
    : [];
  const unanswered = inboxAvailable ? (inbox as FeedItem[]).filter(needsReply).length : 0;
  const toCheck = inboxAvailable ? (inbox as FeedItem[]).filter(needsCheck).length : 0;
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
    summaryLines.push(`답변이 필요한 문의 ${unanswered}건, 확인이 필요한 리뷰 ${toCheck}건입니다.`);
    if (faq > 0 || detailPage > 0) {
      summaryLines.push(
        `자주 나오는 질문 ${faq}건, 상세페이지에서 다룰 만한 내용 ${detailPage}건이 후보로 잡혔습니다.`,
      );
    }
  }

  return {
    hasAnything: issuesAvailable || inboxAvailable,
    issuesNeedingReview: { available: issuesAvailable, value: needsReviewList },
    issuesImproved: { available: issuesAvailable, value: improvedList },
    unansweredInquiries: { available: inboxAvailable, value: unanswered },
    reviewsToCheck: { available: inboxAvailable, value: toCheck },
    faqCandidates: { available: inboxAvailable, value: faq },
    detailPageCandidates: { available: inboxAvailable, value: detailPage },
    summaryLines,
  };
}
