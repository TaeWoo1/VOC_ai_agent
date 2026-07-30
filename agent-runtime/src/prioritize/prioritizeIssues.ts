/**
 * Issue prioritization — deterministic, pure, no clock, no LLM.
 *
 * This does NOT re-judge anything: severity, the change judgements, the surge counts, and the
 * dominant product are all computed by the backend and arrive on each {@link ReviewIssueSummary}.
 * Prioritization here is only a total ORDER over those already-computed signals, so "먼저 확인할
 * 운영 이슈" is reproducible.
 *
 * The primary order MIRRORS the backend's own worst-first list (a product decision, not ours):
 * severity first, then whether a change judgement fired, then recency — so a HIGH issue that is
 * quiet still outranks a LOW one that is surging. On top of that base we add finer, fully
 * deterministic tie-breakers so the order is a stable total order the tests can pin:
 *   severity rank → fired-vs-quiet → high-surge → surge-window count → last-evidence recency →
 *   evidence volume → issue id.
 *
 * Every signal used (severity, trend/surge, period via last-evidence + surge window, concentration
 * via the CONCENTRATED change kind, volume) is read from the row; no wall clock is read.
 */
import type { ReviewIssueSummary } from "../spring/types";

export type IssuePriorityBucket = "top" | "high" | "normal";

export interface RankedIssue {
  readonly item: ReviewIssueSummary;
  readonly rank: number; // 1-based; 1 = highest priority
  readonly priorityBucket: IssuePriorityBucket;
}

/** HIGH worst; unknown severities sort last so a mapping gap never jumps the queue. */
function severityRank(severity: string): number {
  switch (severity) {
    case "HIGH":
      return 0;
    case "NORMAL":
      return 1;
    case "LOW":
      return 2;
    default:
      return 3;
  }
}

function compare(a: ReviewIssueSummary, b: ReviewIssueSummary): number {
  const sev = severityRank(a.severity) - severityRank(b.severity);
  if (sev !== 0) return sev;

  // A fired change judgement outranks a quiet issue of the same severity.
  const aFired = a.change.kinds.length > 0 ? 0 : 1;
  const bFired = b.change.kinds.length > 0 ? 0 : 1;
  if (aFired !== bFired) return aFired - bFired;

  // Worsening (증가 중) first.
  const aSurge = a.change.highSurge ? 0 : 1;
  const bSurge = b.change.highSurge ? 0 : 1;
  if (aSurge !== bSurge) return aSurge - bSurge;

  // More recent-window evidence is worse.
  if (a.change.surgeWindowCount !== b.change.surgeWindowCount) {
    return b.change.surgeWindowCount - a.change.surgeWindowCount;
  }

  // More recent last-evidence is worse; undated (null) sorts last.
  const ad = a.lastEvidenceOn;
  const bd = b.lastEvidenceOn;
  if (ad !== bd) {
    if (ad == null) return 1;
    if (bd == null) return -1;
    return ad < bd ? 1 : -1; // ISO date strings; later date first
  }

  // Larger body of evidence is worse.
  if (a.evidenceCount !== b.evidenceCount) return b.evidenceCount - a.evidenceCount;

  // Final stable tie-break.
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

function bucketFor(rank: number): IssuePriorityBucket {
  if (rank === 1) return "top";
  if (rank <= 3) return "high";
  return "normal";
}

/** Rank the issue set worst-first. Input is not mutated (a copy is sorted). */
export function prioritizeIssues(items: readonly ReviewIssueSummary[]): RankedIssue[] {
  const sorted = [...items].sort(compare);
  return sorted.map((item, i) => ({ item, rank: i + 1, priorityBucket: bucketFor(i + 1) }));
}

/** The top N issues (worst-first), or fewer when the set is smaller. n<=0 selects none. */
export function selectTopIssues(ranked: readonly RankedIssue[], n: number): RankedIssue[] {
  if (n <= 0) return [];
  return ranked.slice(0, n);
}
