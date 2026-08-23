/**
 * Two kinds of review evidence, and the rule that they are never each other.
 *
 * <b>Why this file exists.</b> The product axis (`ProductGrouping.ts`) made "어느 상품이?" answerable,
 * and it answered it with the only attributed evidence the runtime had: review-ISSUE evidence —
 * opinion units an extractor tied to a repeated problem. Asked "최근 부정적인 리뷰가 있는 상품을
 * 알려줘", the honest answer was therefore about something adjacent to what was asked, and the
 * tempting fix was to call those rows "부정 리뷰". They are not. A negative review is a whole review
 * the ingest marked negative (`Review.isNegative`); an issue evidence row is one opinion unit inside
 * a review, counted once per issue it supports. One review can produce two evidence rows or none, so
 * the two numbers are not even the same order of magnitude for the same data.
 *
 * <b>So the sense is chosen, declared, and carried.</b> Each sense names its own read, its own
 * evidence kind and its own noun, and `reviewEvidenceSenses.test.ts` asserts the three never cross.
 * A future package adding a third sense adds a row here; it cannot add one by writing a sentence.
 *
 * <b>The choice comes from the seller's words, not from a model.</b> Same shape as
 * {@link asksForAxis}: a short closed table, matched literally. The default is `ISSUE_EVIDENCE`,
 * which is what every grouped run did before this module existed — a sentence that names neither
 * family gets exactly the behaviour it got yesterday.
 */
import type { EvidenceKind } from "../state/OperatorState";
import { OPERATOR_TOOL } from "../tools/OperatorTools";
import type { OperatorToolName } from "../tools/OperatorTools";

/** Which review evidence answers this question. Closed: each value owns a read and a noun. */
export type ReviewEvidenceSense = "NEGATIVE_REVIEW" | "ISSUE_EVIDENCE";

export interface ReviewSenseDeclaration {
  readonly sense: ReviewEvidenceSense;
  /** The read that produces this sense's grouped rows. */
  readonly tool: OperatorToolName;
  /** The evidence kind its rows are minted with. Two senses never share one. */
  readonly evidenceKind: EvidenceKind;
  /** The noun a sentence may use for its number. Two senses never share one. */
  readonly noun: string;
  /** What the number counts, precisely enough to re-check against the backend. */
  readonly counts: string;
}

export const REVIEW_SENSES: readonly ReviewSenseDeclaration[] = [
  {
    sense: "NEGATIVE_REVIEW",
    tool: OPERATOR_TOOL.GET_DASHBOARD_PRODUCT_ISSUES,
    evidenceKind: "NEGATIVE_REVIEW",
    noun: "부정 리뷰",
    counts: "dashboard/summary:topProductIssues — reviews where is_negative, grouped by product_id",
  },
  {
    sense: "ISSUE_EVIDENCE",
    tool: OPERATOR_TOOL.GET_ISSUE_EVIDENCE_SUMMARY,
    evidenceKind: "ISSUE_EVIDENCE",
    noun: "리뷰 문제 근거",
    counts: "review-issues/{id}/evidence-summary:byProduct — opinion units tied to a repeated issue",
  },
];

export function senseDeclaration(sense: ReviewEvidenceSense): ReviewSenseDeclaration {
  return REVIEW_SENSES.find((d) => d.sense === sense)!;
}

/**
 * Words that name a negative REVIEW — a rating judgement about a whole review.
 *
 * "별점"/"평점" are here because a low-rating question is a question about the same corpus the
 * negative flag is derived from. "리뷰" alone is not, and must never be: "리뷰 문제가 많은 상품" is
 * the other sense, and a bare noun that appears in both questions cannot discriminate them.
 */
const NEGATIVE_WORDS = ["부정", "부정적", "악평", "불만족", "낮은 별점", "별점 낮", "낮은 평점", "혹평"] as const;

/**
 * Words that name a repeated / classified ISSUE.
 *
 * Checked FIRST, and that precedence is the conservative direction: "부정적인 리뷰가 반복되는 상품"
 * asks about the issue memory, which is the narrower and better-evidenced claim, and answering it
 * with the issue split labels its number "리뷰 문제 근거" — true whichever way the sentence was meant.
 * The reverse mistake would print a negative-review count under a question about repetition.
 */
const ISSUE_WORDS = ["반복", "재발", "리뷰 문제", "문제 근거", "이슈"] as const;

/**
 * Which sense this question is asking for.
 *
 * <b>The seller's own sentence decides, and the planner's restatement is only a fallback.</b> Unlike
 * the axis — which the planner often mentions and the seller sometimes does not — both families of
 * word are in the question by construction, because they ARE the question. And a paraphrase drifts:
 * "부정적인 리뷰가 있는 상품" restated as "부정적 리뷰 이슈" would flip the sense on a word the seller
 * never wrote, which is the planner rephrasing the meaning of the answer.
 */
export function senseOf(goalText: string, plannerGoal?: string): ReviewEvidenceSense {
  const text = goalText.trim().length > 0 ? goalText : (plannerGoal ?? "");
  if (ISSUE_WORDS.some((w) => text.includes(w))) {
    return "ISSUE_EVIDENCE";
  }
  return NEGATIVE_WORDS.some((w) => text.includes(w)) ? "NEGATIVE_REVIEW" : "ISSUE_EVIDENCE";
}
