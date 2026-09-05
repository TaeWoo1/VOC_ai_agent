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
 * <b>The choice comes from the plan, because the plan already made it.</b> The two senses name two
 * different reads, and both are in the catalogue the planner is shown with descriptions that tell them
 * apart ("리뷰 자체의 수" vs "반복 리뷰 문제의 근거 건수"). Traced live against the real
 * planner on eight sentences (2026-09-06, `docs/agent_semantic_ownership_v1.md` §2), the plan agreed
 * with the word table on seven and was RIGHT on the eighth — 「리뷰가 안 좋은 상품 뭐야?」 names no word
 * in either list and the table fell to its default. So the table was not the authority; it was a
 * second, weaker planner for a question the first one had already answered, and it lost.
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
 * Which sense this question is asking for — read from the reads the plan named.
 *
 * <b>The ladder, and the trace it was fitted to</b> (real planner, Demo Org, 2026-09-06 — eight
 * sentences, `docs/agent_semantic_ownership_v1.md` §2):
 *
 * 1. `get_review_issue_evidence_summary` — this sense's own declared read. Naming it is naming it.
 * 2. `search_review_issues` — the issue list every repeated-problem answer is built from. A plan that
 *    asked for it is asking about repetition, and that is the conservative direction this module has
 *    always taken: labelling a number 「리뷰 문제 근거」 is true whichever way the sentence was meant,
 *    while the reverse prints a negative-review count under a question about repetition.
 * 3. `get_dashboard_product_issues` alone — the reviews themselves, per product. `NEGATIVE_REVIEW`.
 * 4. Neither — `ISSUE_EVIDENCE`, which is what every grouped run did before this module existed.
 *
 * Rung 2 is why this is a ladder and not one lookup: the planner names the dashboard read liberally as
 * a supporting one, so 「최근 반복적으로 리뷰 문제가 나온 상품은?」 comes back with BOTH names and only the
 * issue list says what the answer is about.
 *
 * <b>`candidateTools`, never `allowedTools`.</b> The allow-list is authorization — it holds every tool
 * REVIEW_OPS may call, all three of these included — so reading it would make the plan's choice
 * invisible and answer the same sense every time.
 */
export function senseOf(candidateTools: readonly string[]): ReviewEvidenceSense {
  const named = new Set(candidateTools);
  if (named.has(OPERATOR_TOOL.GET_ISSUE_EVIDENCE_SUMMARY)) return "ISSUE_EVIDENCE";
  if (named.has(OPERATOR_TOOL.SEARCH_REVIEW_ISSUES)) return "ISSUE_EVIDENCE";
  return named.has(OPERATOR_TOOL.GET_DASHBOARD_PRODUCT_ISSUES) ? "NEGATIVE_REVIEW" : "ISSUE_EVIDENCE";
}
