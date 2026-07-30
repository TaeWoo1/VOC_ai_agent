/**
 * The boundary to the Spring backend for the review-issue-memory domain — a sibling of
 * {@link SpringClient} and {@link ReviewSpringClient}, kept separate so the merged inquiry and
 * review surfaces (and their fakes) are untouched. Every method maps onto ONE existing
 * read-only endpoint under `/api/review-issues`.
 *
 * <b>Read-only, by design.</b> There is no write method here and there can be none: the
 * issue-memory subgraph reports on operations issues and never changes an issue's state, starts
 * an action, or writes feedback. Those mutations live on the human {@code /acting},
 * {@code /remediated}, {@code /dismiss}, {@code /extract}, {@code /lifecycle-pass} endpoints,
 * which this client deliberately does not expose. The backend owns every extraction,
 * aggregation, and lifecycle rule; the runtime only reads these summaries.
 *
 * <b>Quote-free, by design.</b> None of these reads carries a review/inquiry body, a masked
 * quote, or an operator note. `search` and `getTrend` return closed-vocabulary issue signals;
 * `getContext` is identity + note-free history; `getEvidenceSummary` is aggregate counts. So no
 * customer text ever crosses this boundary into the graph.
 */
import type {
  IssueContext,
  IssueEvidenceSummary,
  IssueTrend,
  ReviewIssueSummary,
} from "./types";

export interface ListReviewIssuesParams {
  /** Reproducibility anchor for the change/trend judgements; defaults to today on the backend. */
  readonly referenceDate?: string;
  /** false = the working list; true = the 중요하지 않음 (dismissed) list. Defaults to false. */
  readonly dismissed?: boolean;
}

export interface IssueSpringClient {
  /** The working list of issues (or, with dismissed=true, the set-aside list). Quote-free rows. */
  searchReviewIssues(params: ListReviewIssuesParams): Promise<ReviewIssueSummary[]>;
  /** One issue's identity + note-free lifecycle history. */
  getIssueContext(issueId: string, referenceDate?: string): Promise<IssueContext>;
  /** One issue's sanitized, quote-free evidence roll-up (all-time). */
  getIssueEvidenceSummary(issueId: string): Promise<IssueEvidenceSummary>;
  /** One issue's current severity/change/concentration signal as of the reference date. */
  getIssueTrend(issueId: string, referenceDate?: string): Promise<IssueTrend>;
}
