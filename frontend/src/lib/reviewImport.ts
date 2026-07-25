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
  ScopeEvidence,
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

/* ─────────────────── The guided flow (과거 리뷰 전체 연동하기) ─────────────────── */

export interface ImportProgress {
  done: number;
  total: number;
  /** `13개 구간 중 5개 완료` — the one progress line the seller reads. */
  text: string;
}

/**
 * Progress over the plan's LIVE segments (split parents are excluded — they were replaced, and counting
 * them would inflate both numbers and make a finished import look unfinished).
 *
 * A concluded-MISSING segment counts as done: it needs no further work, and leaving it "remaining" forever
 * would mean a plan whose unreachable months can never be finished.
 */
export function importProgress(segments: ReviewImportSegmentView[]): ImportProgress {
  const live = segments.filter((s) => !s.superseded);
  const done = live.filter((s) => s.coverageState === "COVERED" || s.coverageState === "MISSING").length;
  return { done, total: live.length, text: `${live.length}개 구간 중 ${done}개 완료` };
}

/** The next segment the seller will be guided through, or null when nothing remains. */
export function nextRemainingSegment(segments: ReviewImportSegmentView[]): ReviewImportSegmentView | null {
  return (
    segments
      .filter((s) => !s.superseded)
      .filter((s) => s.coverageState === "UNVERIFIED")
      .filter((s) => s.executionState !== "ACTIVE")
      .sort((a, b) => a.segmentStart.localeCompare(b.segmentStart))[0] ?? null
  );
}

/** The primary action's label — first run versus resuming an interrupted one. */
export function primaryActionLabel(hasActivePlan: boolean): string {
  return hasActivePlan ? "계속 가져오기" : "과거 리뷰 전체 연동하기";
}

/** A segment's required window, as the guided run will state it. */
export function segmentRangeText(segment: ReviewImportSegmentView): string {
  return `${segment.segmentStart} ~ ${segment.segmentEnd}`;
}

/**
 * Whether the local agent can host a guided run right now, and what to say when it cannot.
 *
 * The honest states matter more than the happy one: the seller must never press a button that silently does
 * nothing, and "the agent isn't running" and "you haven't connected it" need different fixes.
 */
export type AgentAvailability = "ready" | "not_running" | "unpaired" | "wrong_carrier" | "incompatible";

/**
 * Map the Local Agent Bridge's connection phase to whether a guided import can start.
 *
 * `connecting` is grouped with "not running" on purpose: while we do not yet know, the honest thing is to
 * withhold the guided CTA rather than let the seller press a button whose outcome we cannot predict. It
 * resolves within a poll, so the cost is a brief wait, not a dead end.
 */
export function agentAvailabilityFromBridgePhase(phase: string): AgentAvailability {
  switch (phase) {
    case "paired":
      return "ready";
    case "unpaired":
    case "pairing_pending":
    case "pairing_denied":
    case "revoked":
      return "unpaired";
    case "incompatible_version":
      return "incompatible";
    default:
      // connecting / connecting_ws / unreachable / disconnected — the agent is not usable right now.
      return "not_running";
  }
}

export interface AgentAvailabilityCopy {
  /** Whether the guided CTA can be pressed. */
  canGuide: boolean;
  message: string;
  /** Whether to offer the manual file fallback instead. */
  offerFallback: boolean;
}

export function agentAvailabilityCopy(state: AgentAvailability): AgentAvailabilityCopy {
  switch (state) {
    case "ready":
      return { canGuide: true, message: "", offerFallback: false };
    case "not_running":
      return {
        canGuide: false,
        message: "SellerOps 로컬 도우미가 실행되지 않았어요. 실행한 뒤 다시 시도해 주세요.",
        offerFallback: true,
      };
    case "unpaired":
      return {
        canGuide: false,
        message: "로컬 도우미 연결이 필요해요. 연결을 먼저 완료해 주세요.",
        offerFallback: true,
      };
    case "wrong_carrier":
      return {
        canGuide: false,
        message: "로컬 도우미가 다른 작업을 실행하고 있어요. 그 작업을 끝낸 뒤 다시 시도해 주세요.",
        offerFallback: true,
      };
    case "incompatible":
      return {
        canGuide: false,
        message: "로컬 도우미 버전이 맞지 않아요. 최신 버전으로 업데이트한 뒤 다시 시도해 주세요.",
        offerFallback: true,
      };
  }
}

/**
 * The guided-run stage copy. The runtime sends only dotted semantic keys; every word the seller reads is
 * decided here (Action Window contract §6 — the FE owns all copy).
 *
 * `confirmRange` is deliberately phrased as the seller confirming, because that is what it is: it appears
 * only when SellerOps could NOT read the selected range back.
 */
export const IMPORT_STAGE_COPY: Readonly<Record<string, string>> = {
  "actionWindow.import.openReviewSurface": "판매자센터의 리뷰 관리 화면을 열어 주세요.",
  "actionWindow.import.showRequiredRange": "이번에 가져올 기간이에요.",
  "actionWindow.import.setStartDate": "표시된 시작일을 선택해 주세요.",
  "actionWindow.import.setEndDate": "표시된 종료일을 선택해 주세요.",
  "actionWindow.import.applyRange": "조회 버튼을 눌러 기간을 적용해 주세요.",
  "actionWindow.import.confirmRange": "선택한 기간이 위 기간과 같은지 확인해 주세요.",
  "actionWindow.import.export": "엑셀 다운로드 버튼을 눌러 주세요.",
  "actionWindow.import.consent": "네이버 확인 창의 버튼을 눌러 주세요.",
  "actionWindow.import.ingest": "받은 파일을 SellerOps가 정리하고 있어요.",

  // The range-discovery run: the step BEFORE any plan exists. It asks what the marketplace actually allows
  // instead of asking the seller to guess a period, and its two barriers appear only when SellerOps could not
  // read the limits itself — so the copy describes the seller establishing the range, never verifying it.
  "actionWindow.importDiscovery.openReviewSurface": "판매자센터의 리뷰 관리 화면을 열어 주세요.",
  "actionWindow.importDiscovery.readBounds": "가져올 수 있는 기간을 확인하고 있어요.",
  "actionWindow.importDiscovery.setEarliest": "달력에서 선택할 수 있는 가장 이전 날짜를 시작일로 골라 주세요.",
  "actionWindow.importDiscovery.setLatest": "종료일에는 가장 최근 날짜를 골라 주세요.",
  "actionWindow.importDiscovery.report": "가져올 기간을 정리하고 있어요.",
};

/** Copy for a runtime stage key. An unknown key degrades to a neutral line, never to a raw dotted key. */
export function importStageText(copyKey: string): string {
  return IMPORT_STAGE_COPY[copyKey] ?? "다음 안내를 따라 주세요.";
}

/**
 * How the export scope was established, in the seller's words.
 *
 * The two never collapse into one phrase: an operator confirmation is described AS a confirmation. Calling
 * it verification would claim SellerOps checked something it could not read.
 */
export function scopeEvidenceLabel(evidence: ScopeEvidence | null): string {
  switch (evidence) {
    case "MACHINE_MATCHED":
      return "SellerOps가 선택된 기간을 확인했어요";
    case "OPERATOR_CONFIRMED":
      return "직접 확인한 기간이에요";
    default:
      return "확인 방법 기록 없음";
  }
}

/**
 * The completion line. Says what was actually done — the periods the marketplace let the seller select were
 * exported and ingested — and never that every review NAVER holds is now present, which nothing here has
 * measured.
 */
export function completionSummaryText(progress: ImportProgress): string {
  if (progress.total === 0) {
    return "가져올 구간이 없어요.";
  }
  if (progress.done < progress.total) {
    return `${progress.text} · 남은 구간을 이어서 가져올 수 있어요.`;
  }
  return "NAVER에서 현재 선택 가능한 기간의 리뷰 파일을 가져왔습니다.";
}

function rangesText(ranges: { start: string; end: string }[]): string {
  if (!ranges || ranges.length === 0) {
    return "없음";
  }
  return ranges.map((r) => (r.start === r.end ? r.start : `${r.start} ~ ${r.end}`)).join(", ");
}
