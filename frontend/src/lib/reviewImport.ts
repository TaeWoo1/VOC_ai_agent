// The seller-visible language for a historical review import. The backend keeps two orthogonal state
// axes — execution and coverage — and every word a seller reads about them is decided HERE, in one
// testable place, so a component never re-derives a claim from raw enums.
//
// Two honesty rules the operator set (2026-07-25) live in this file:
//   * COVERED means the scope was successfully exported and ingested — NOT that every expected review was
//     reconciled. A valid EMPTY export is a successful covered segment with zero rows. Nothing here ever
//     says "100% of all reviews".
//   * MISSING is a coverage conclusion ("가져올 수 없는 기간"), never a failed attempt.

import type {
  ReviewImportCoverageView,
  ReviewImportHealthView,
  ReviewImportSegmentView,
} from "./types";

/** Visual weight — mapped to classes by the component, never to a claim. */
export type SegmentTone = "idle" | "active" | "done" | "retry" | "blocked";

export interface SegmentUiState {
  /** The one chip a seller reads for this segment. */
  label: string;
  tone: SegmentTone;
  /** Still-to-do work: coverage UNVERIFIED (PENDING / mid-ACTIVE / retryable FAILED). Drives the highlight. */
  remaining: boolean;
}

/**
 * The five operator-defined states, keyed so every (execution, coverage) pair resolves:
 *   PENDING + UNVERIFIED   → 가져오기 전
 *   ACTIVE                 → 가져오는 중
 *   COMPLETED + COVERED    → 가져오기 완료
 *   FAILED + UNVERIFIED    → 다시 시도 필요
 *   COMPLETED + MISSING    → 가져올 수 없는 기간
 * Coverage is checked first because MISSING/COVERED are terminal conclusions regardless of execution.
 */
export function segmentUiState(executionState: string, coverageState: string): SegmentUiState {
  if (coverageState === "MISSING") {
    return { label: "가져올 수 없는 기간", tone: "blocked", remaining: false };
  }
  if (coverageState === "COVERED") {
    return { label: "가져오기 완료", tone: "done", remaining: false };
  }
  // coverage is UNVERIFIED from here — still to do.
  if (executionState === "ACTIVE") {
    return { label: "가져오는 중", tone: "active", remaining: true };
  }
  if (executionState === "FAILED") {
    return { label: "다시 시도 필요", tone: "retry", remaining: true };
  }
  return { label: "가져오기 전", tone: "idle", remaining: true };
}

/** Plan-level status chip. */
export function planStatusLabel(status: string): string {
  switch (status) {
    case "DRAFT":
      return "가져오기 준비됨";
    case "ACTIVE":
      return "가져오는 중";
    case "COMPLETED":
      return "가져오기 완료";
    case "ABANDONED":
      return "중단됨";
    default:
      return status;
  }
}

/** Whether this segment can still be reshaped/run (not a split-parent). */
export function isReshapable(segment: ReviewImportSegmentView): boolean {
  return !segment.superseded;
}

/** A segment may be split/merged/started only before it has been run — protects attempt history. */
export function isUnattempted(segment: ReviewImportSegmentView): boolean {
  return (
    !segment.superseded &&
    segment.executionState === "PENDING" &&
    segment.coverageState === "UNVERIFIED"
  );
}

/** Whether a per-segment import can be launched (not superseded, not currently active). */
export function canImport(segment: ReviewImportSegmentView): boolean {
  return !segment.superseded && segment.executionState !== "ACTIVE";
}

/**
 * Split is allowed on a REMAINING segment (unattempted PENDING or retryable FAILED). It supersedes —
 * never deletes — the parent, so attempt history is preserved. Not offered on ACTIVE / COVERED / MISSING.
 */
export function canSplit(segment: ReviewImportSegmentView): boolean {
  return (
    !segment.superseded &&
    (segment.executionState === "PENDING" || segment.executionState === "FAILED")
  );
}

/** Concluding a range unreachable (MISSING) is allowed on a remaining segment. */
export function canMarkMissing(segment: ReviewImportSegmentView): boolean {
  return (
    !segment.superseded &&
    (segment.executionState === "PENDING" || segment.executionState === "FAILED")
  );
}

export interface CoverageSummaryLine {
  label: string;
  value: string;
}

/** Honest one-glance coverage lines — ranges and counts, never a completeness percentage. */
export function coverageSummary(coverage: ReviewImportCoverageView): CoverageSummaryLine[] {
  return [
    { label: "커버된 기간", value: rangesText(coverage.covered) },
    { label: "남은 기간", value: rangesText(coverage.remaining) },
    { label: "가져올 수 없는 기간", value: rangesText(coverage.missing) },
    {
      label: "마지막 커버 날짜",
      value: coverage.lastCoveredDate ? coverage.lastCoveredDate : "아직 없음",
    },
    { label: "가져온 리뷰 수", value: `${coverage.coveredRows.toLocaleString()}건` },
  ];
}

/** Honest health lines for a seller account. */
export function healthSummary(health: ReviewImportHealthView): CoverageSummaryLine[] {
  return [
    {
      label: "마지막 커버 날짜",
      value: health.lastCoveredDate ? health.lastCoveredDate : "아직 없음",
    },
    { label: "가져올 수 없는 기간", value: rangesText(health.missingRanges) },
    { label: "새로 추가", value: `${health.newCount.toLocaleString()}건` },
    { label: "이미 있던 리뷰", value: `${health.duplicateCount.toLocaleString()}건` },
    { label: "실패", value: `${health.failedCount.toLocaleString()}건` },
    {
      label: "다음 권장 가져오기",
      value: health.nextRecommendedImport ? `${health.nextRecommendedImport}부터` : "없음",
    },
  ];
}

/** A segment's covered-row line, honest about a valid empty and about un-reconciled completeness. */
export function coveredRowsText(segment: ReviewImportSegmentView): string {
  if (segment.coverageState !== "COVERED") {
    return "";
  }
  if ((segment.coveredRows ?? 0) === 0) {
    return "리뷰 없음 (정상적으로 커버됨)";
  }
  const suffix = segment.rowsReconciled ? "" : " · 전체 건수 대사 전";
  return `${(segment.coveredRows ?? 0).toLocaleString()}건 커버됨${suffix}`;
}

function rangesText(ranges: { start: string; end: string }[]): string {
  if (!ranges || ranges.length === 0) {
    return "없음";
  }
  return ranges.map((r) => (r.start === r.end ? r.start : `${r.start} ~ ${r.end}`)).join(", ");
}
