/**
 * A contract-faithful in-memory stand-in for the Spring review-issue-memory backend.
 *
 * It mirrors the four read endpoints the issue subgraph uses:
 *  - searchReviewIssues: the working (or dismissed) issue list, quote-free rows;
 *  - getIssueContext: identity + note-free lifecycle history;
 *  - getIssueEvidenceSummary: the sanitized evidence roll-up;
 *  - getIssueTrend: the current severity/change/concentration signal.
 *
 * <b>It has no write method, mirroring what the subgraph is allowed to touch</b> — no extract, no
 * lifecycle transition, no dismiss. `reads` counts calls; there is no mutation to count, which is
 * the point. Every method is deterministic: the same call returns the same value, so a re-run
 * reproduces the brief exactly.
 *
 * To prove the search-node projection, the constructor can be told to `leakInSearch`: it then
 * attaches an extra, customer-text-shaped field to each search row. The runtime must drop it — it
 * must never reach the graph state or the composed brief.
 */
import type {
  IssueContext,
  IssueEvidenceSummary,
  IssueTrend,
  IssueTransition,
  ReviewIssueSummary,
} from "../../src/spring/types";
import { SpringApiError } from "../../src/spring/SpringClient";
import type { IssueSpringClient, ListReviewIssuesParams } from "../../src/spring/IssueSpringClient";
import { evidenceSummaryFor, historyFor } from "./issueFixtures";

export interface SeedIssue {
  readonly summary: ReviewIssueSummary;
  readonly history?: IssueTransition[];
  readonly evidence?: IssueEvidenceSummary;
}

export class FakeIssueSpringClient implements IssueSpringClient {
  private readonly byId = new Map<string, SeedIssue>();
  readonly reads = { search: 0, context: 0, evidenceSummary: 0, trend: 0 };
  private readonly leakInSearch: boolean;

  constructor(summaries: readonly ReviewIssueSummary[] = [], opts: { leakInSearch?: boolean } = {}) {
    this.leakInSearch = opts.leakInSearch ?? false;
    for (const summary of summaries) {
      this.byId.set(summary.id, {
        summary,
        history: historyFor(summary.id),
        evidence: evidenceSummaryFor(summary),
      });
    }
  }

  /** Register a seed with explicit history/evidence (for tests that need specific roll-ups). */
  put(seed: SeedIssue): void {
    this.byId.set(seed.summary.id, {
      summary: seed.summary,
      history: seed.history ?? historyFor(seed.summary.id),
      evidence: seed.evidence ?? evidenceSummaryFor(seed.summary),
    });
  }

  private require(issueId: string): SeedIssue {
    const it = this.byId.get(issueId);
    if (!it) throw new SpringApiError(404, "NOT_FOUND", "이슈를 찾을 수 없습니다.");
    return it;
  }

  async searchReviewIssues(params: ListReviewIssuesParams): Promise<ReviewIssueSummary[]> {
    this.reads.search += 1;
    const dismissed = params.dismissed ?? false;
    const rows = [...this.byId.values()]
      .map((s) => s.summary)
      .filter((s) => s.dismissed === dismissed);
    if (!this.leakInSearch) return rows;
    // Simulate a backend row that carried an unexpected customer-text-shaped field. The runtime's
    // search-node projection must strip it — it must never appear downstream.
    return rows.map((r) => ({ ...r, redactedBody: "고객이 남긴 원문 본문 — 절대 유출 금지" }) as ReviewIssueSummary);
  }

  async getIssueContext(issueId: string, _referenceDate?: string): Promise<IssueContext> {
    this.reads.context += 1;
    const it = this.require(issueId);
    return { issue: it.summary, history: it.history ?? [] };
  }

  async getIssueEvidenceSummary(issueId: string): Promise<IssueEvidenceSummary> {
    this.reads.evidenceSummary += 1;
    const it = this.require(issueId);
    return it.evidence ?? evidenceSummaryFor(it.summary);
  }

  async getIssueTrend(issueId: string, _referenceDate?: string): Promise<IssueTrend> {
    this.reads.trend += 1;
    return this.require(issueId).summary;
  }
}
