// Pure view logic for 고객운영 메모리. No React, no I/O.
//
// Sits on top of `reviewIssuesView`, which owns the wording rules (no cause, 해결됨 is never
// described as disappearance). This module adds only what the two-pane surface needs: grouping,
// deep-link resolution, and the one rule that decides whether an evidence row may link anywhere.

import type { ReviewIssueView } from "./types";
import { changedIssues, improvedIssues, steadyIssues } from "./reviewIssuesView";

export type IssueSelection =
  | { kind: "NONE" }
  | { kind: "FOUND"; issue: ReviewIssueView }
  | { kind: "MISSING"; issueId: string };

/**
 * Resolves the deep-linked issue against every loaded issue — not against the visible group — so a
 * shared link opens its issue regardless of how the reader's list happens to be arranged.
 */
export function resolveIssueSelection(
  issues: readonly ReviewIssueView[],
  issueId: string | undefined,
): IssueSelection {
  if (!issueId) {
    return { kind: "NONE" };
  }
  const issue = issues.find((candidate) => candidate.id === issueId);
  return issue ? { kind: "FOUND", issue } : { kind: "MISSING", issueId };
}

export interface IssueGroup {
  key: "changed" | "steady" | "improved";
  heading: string;
  issues: ReviewIssueView[];
}

/**
 * Three mutually exclusive groups, worst first.
 *
 * An issue carrying both a warning judgement and IMPROVED belongs under 확인 필요: the surface is a
 * call to look, and filing a still-warning issue under good news would bury it.
 */
export function groupIssues(issues: readonly ReviewIssueView[]): IssueGroup[] {
  const list = [...issues];
  const changed = changedIssues(list);
  const changedIds = new Set(changed.map((issue) => issue.id));
  const improved = improvedIssues(list).filter((issue) => !changedIds.has(issue.id));

  return [
    { key: "changed", heading: "확인 필요", issues: changed },
    { key: "steady", heading: "지켜보는 중", issues: steadyIssues(list) },
    { key: "improved", heading: "개선됨", issues: improved },
  ].filter((group) => group.issues.length > 0) as IssueGroup[];
}

/**
 * The inbox row an evidence quote came from, or null.
 *
 * Returns a link ONLY when that row is actually loaded in the inbox. The evidence carries a
 * `reviewId` from the review store and the inbox carries its own rows; when the two do not overlap
 * a link would land on "항목을 찾을 수 없습니다". A link that reliably fails is worse than no link,
 * so the check is membership, not optimism.
 */
export function evidenceInboxRef(
  reviewId: string,
  loadedInboxIds: ReadonlySet<string>,
): string | null {
  return loadedInboxIds.has(reviewId) ? `/inbox/${reviewId}` : null;
}

/** "마지막 확인 2026-08-02", or null when nothing has been seen. */
export function lastSeenLabel(issue: ReviewIssueView): string | null {
  return issue.lastEvidenceOn ? `마지막 확인 ${issue.lastEvidenceOn}` : null;
}

/** Evidence-count line. Always a real count — the server sends it. */
export function evidenceCountLabel(issue: ReviewIssueView): string {
  return `근거 ${issue.evidenceCount}건`;
}
