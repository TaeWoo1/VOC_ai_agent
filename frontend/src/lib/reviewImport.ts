// The seller-visible language for a historical review import. The backend keeps two orthogonal state
// axes — execution and coverage — and every word a seller reads about them is decided HERE, in one
// testable place, so a component never re-derives a claim from raw enums.
//
// Two honesty rules the operator set (2026-07-25) live in this file:
//   * COVERED means the scope was successfully exported and ingested — NOT that every expected review was
//     reconciled. A valid EMPTY export is a successful covered segment with zero rows. Nothing here ever
//     says "100% of all reviews".
//   * MISSING is a coverage conclusion ("가져올 수 없는 기간"), never a failed attempt.

import type { AwGuidancePack } from "../../../contracts/action-window/v2/transport";
import { blockerView, commandLabel } from "./actionWindow/copy";
import type {
  ReviewImportCoverageView,
  ReviewImportHealthView,
  ReviewImportSegmentView,
  ReviewOpsLoopSummary,
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

/**
 * The next segment the seller will be guided through, or null when nothing remains.
 *
 * **Most recent month first** (product-owner decision, 2026-07-26). A plan can be 37 exports the seller performs
 * by hand, and they may stop part-way: the recent months hold the reviews that still need answering, so the
 * value has to arrive in the first segment rather than the last. Mirrors the backend's own `nextRemainingSegment`
 * — the two must agree, or the card names one month and the ticket authorizes another.
 */
export function remainingSegments(segments: ReviewImportSegmentView[]): ReviewImportSegmentView[] {
  // The SAME predicate the backend's `selectNextRemaining` uses — a still-remaining segment (execution PENDING
  // or FAILED, never ACTIVE or COMPLETED) whose coverage is not a concluded MISSING. Expressed on the execution
  // axis like the backend, rather than the coverage axis, so the panel's follow-up segment and remaining count
  // are computed by the identical rule and cannot drift from the segment the backend would authorize next.
  return segments
    .filter((s) => !s.superseded)
    .filter((s) => s.executionState === "PENDING" || s.executionState === "FAILED")
    .filter((s) => s.coverageState !== "MISSING")
    .sort((a, b) => b.segmentStart.localeCompare(a.segmentStart));
}

export function nextRemainingSegment(segments: ReviewImportSegmentView[]): ReviewImportSegmentView | null {
  return remainingSegments(segments)[0] ?? null;
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

  // The `actionWindow.importDiscovery.*` keys are GONE, and that is the fix for finding 16 rather than a
  // rewording of it. They described a run that asked the seller to find the earliest date NAVER's calendar
  // allowed — a limit the 2026-07-25 live run established does not exist. What the seller is really deciding is
  // how far back to import, which is now a choice they make in SellerOps before any marketplace window opens
  // (see RANGE_CHOICE_COPY), so there is no run and no step copy to soften.
};

/** Copy for a runtime stage key. An unknown key degrades to a neutral line, never to a raw dotted key. */
export function importStageText(copyKey: string): string {
  return IMPORT_STAGE_COPY[copyKey] ?? "다음 안내를 따라 주세요.";
}

/* ─────────────────── "다시 확인" is not one sentence ─────────────────── */

/**
 * What `REQUEST_STEP_RECHECK` should SAY, here, now.
 *
 * One fixed label cannot be right everywhere, and the cost of pretending otherwise was measured: on the
 * 2026-07-25 live run the operator was told to press a button labelled 확인 완료 and could not match it to
 * anything they had just done. The command means "I did the thing — look again", so the label has to name the
 * thing.
 *
 * Blocker first, then step: what a run is STOPPED on describes the repair better than the step it is nominally
 * sitting at. A stop at the scope gate is nominally still "the end date step", but what the seller has to do is
 * fix the dates.
 */
const RECHECK_BY_BLOCKER: Readonly<Record<string, string>> = {
  SCOPE_MISMATCH: "날짜 다시 확인",
};

const RECHECK_BY_STEP: Readonly<Record<string, string>> = {
  "actionWindow.import.setStartDate": "시작일 입력했어요",
  "actionWindow.import.setEndDate": "종료일 입력했어요",
  "actionWindow.import.applyRange": "조회 눌렀어요",
  "actionWindow.import.confirmRange": "기간이 같아요",
  "actionWindow.import.export": "엑셀 다운로드 눌렀어요",
  "actionWindow.import.consent": "확인 눌렀어요",
};

/** Neutral and still true of every barrier: the runtime is being asked to look, not told the step is done. */
export const RECHECK_FALLBACK_LABEL = "다시 확인";

export function recheckLabel(context: { copyKey?: string | null; blockerCode?: string | null }): string {
  const byBlocker = context.blockerCode ? RECHECK_BY_BLOCKER[context.blockerCode] : undefined;
  if (byBlocker) return byBlocker;
  const byStep = context.copyKey ? RECHECK_BY_STEP[context.copyKey] : undefined;
  return byStep ?? RECHECK_FALLBACK_LABEL;
}

/* ─────────────────── The words the marketplace-side panel renders ─────────────────── */

/**
 * Every sentence the seller reads INSIDE their SmartStore window, handed to the runtime as a pack.
 *
 * Guidance moved into the marketplace page (product-owner decision, 2026-07-26): the seller works there, so a
 * sentence that only exists in the SellerOps tab is a sentence they never see. Copy ownership did not move with
 * it — this function is where the words live, the runtime does lookup and `{param}` substitution, and a key
 * missing here renders NO sentence rather than a runtime-authored one.
 *
 * Blocker wording is reused from `blockerView` rather than restated, so the two windows cannot disagree about
 * why a run stopped.
 *
 * @param continuation What the panel says once the run FINISHES — the next segment and how many are left, or the
 *   whole-plan completion. Omitted ⇒ a finished run takes its panel down, the 2026-07-26 behaviour. Composed
 *   here as final sentences because the runtime holds no plan: it is handed one segment at a time and cannot see
 *   what comes after it (see `continuationCopy`).
 */
export function buildImportGuidancePack(continuation?: ImportContinuation | null): AwGuidancePack {
  const blockerCodes = [
    "SCOPE_MISMATCH",
    "LOGIN_REQUIRED",
    "SESSION_EXPIRED",
    "UNSUPPORTED_STATE",
    "TARGET_NOT_FOUND",
    "TARGET_AMBIGUOUS",
    "DOWNLOAD_TIMEOUT",
    "ARTIFACT_INVALID",
    "INGEST_FAILED",
  ];
  const blockers: Record<string, { title: string; fix: string }> = {};
  for (const code of blockerCodes) {
    const view = blockerView(code);
    blockers[code] = { title: view.title, fix: view.body };
  }
  return {
    chrome: {
      // Named, because this panel appears on someone else's site and the seller has to know whose it is.
      product: "SellerOps 안내",
      stepCounter: "{total}단계 중 {step}",
      requiredRange: "가져올 기간: {start} ~ {end}",
      blockedLabel: "잠깐 멈췄어요",
    },
    steps: { ...IMPORT_STAGE_COPY },
    blockers,
    commands: {
      REQUEST_STEP_RECHECK: RECHECK_FALLBACK_LABEL,
      CANCEL_RUN: commandLabel("CANCEL_RUN"),
    },
    recheck: {
      byBlocker: { ...RECHECK_BY_BLOCKER },
      byStep: { ...RECHECK_BY_STEP },
      fallback: RECHECK_FALLBACK_LABEL,
    },
    ...(continuation ? { continuation: continuationCopy(continuation) } : {}),
  };
}

/* ─────────────────── One segment ends, the next begins — without leaving SmartStore ─────────────────── */

/**
 * What follows the run that is about to start: the segment after it, and how many are still left after that.
 *
 * Both are plan facts, and the plan is something only SellerOps can see — the Action Window wire carries no plan
 * or segment identity by design, so the runtime cannot work either of them out. That is why the sentences below
 * are composed here and shipped as finished text.
 */
export interface ImportContinuation {
  /** The segment the seller would do next, or null when this run finishes the plan. */
  next: { segmentStart: string; segmentEnd: string } | null;
  /** How many segments still need a run AFTER the one that is about to start. */
  remaining: number;
}

/**
 * The panel's closing words, and the button that starts the next segment.
 *
 * The product owner's decision (2026-07-26): a seller who has just finished one of thirteen monthly exports
 * should not have to go and find the SellerOps tab to start the fourteenth. So the panel that says "this part is
 * done" is also the panel that starts the next part, and the SellerOps window is somewhere they may return when
 * everything is finished rather than between every export.
 *
 * `nextLine` is empty exactly when nothing remains — that emptiness is how the runtime chooses between "here is
 * the next one" and "you are finished", so it is a decision made here rather than there.
 */
export function continuationCopy(continuation: ImportContinuation): NonNullable<AwGuidancePack["continuation"]> {
  const next = continuation.next;
  return {
    doneLabel: "이 구간 완료",
    nextLine: next
      ? `다음 구간은 ${next.segmentStart} ~ ${next.segmentEnd}이고, ${continuation.remaining}개 남았어요.`
      : "",
    // The same honesty rule as `completionSummaryText`: what was done is that the selected periods were exported
    // and ingested. Never that every review NAVER holds is now present, which nothing has measured.
    allDoneLine: "과거 리뷰 가져오기를 모두 마쳤어요. 이 창은 닫으셔도 괜찮아요.",
    continueLabel: "다음 구간 계속하기",
  };
}

/**
 * Read the continuation out of a plan's segments, from the point of view of the run about to start.
 *
 * The segment being launched is the backend's authoritative choice (`nextSegmentId`), so it is dropped: what
 * the panel needs is what comes AFTER it. Anchoring on the backend id — rather than re-deciding which segment
 * is "first" here — is what keeps the panel and the minted ticket naming the same months, even if this client's
 * own ordering ever drifted.
 */
export function continuationAfterNext(
  segments: ReviewImportSegmentView[],
  currentSegmentId: string | null,
): ImportContinuation {
  // Drop the segment the ticket authorizes now (the backend's next); the rest, newest first, is what follows.
  const rest = remainingSegments(segments).filter((s) => s.id !== currentSegmentId);
  const next = rest[0];
  return {
    next: next ? { segmentStart: next.segmentStart, segmentEnd: next.segmentEnd } : null,
    remaining: rest.length,
  };
}

/* ─────────────────── "얼마나 가져올까요" — the seller's own range choice ─────────────────── */

/**
 * The screen that replaced range discovery.
 *
 * The wording is about DEPTH, not about limits: nothing here suggests the marketplace restricts anything,
 * because the live run established that it does not. And the confirmation states the consequence in the unit the
 * seller pays it in — one export per month, performed by hand — since that is what turns a date into a decision.
 */
export const RANGE_CHOICE_COPY = {
  title: "언제부터 가져올까요?",
  body: "고른 달부터 오늘까지의 리뷰를 가져와요. 한 달에 한 번씩 판매자센터에서 파일을 내려받게 안내해 드려요.",
  monthLabel: "시작 월",
  confirm: "이 기간으로 시작하기",
  confirming: "준비하는 중…",
  previewFailed: "기간을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.",
  createFailed: "가져오기를 준비하지 못했어요. 잠시 후 다시 시도해 주세요.",
} as const;

/**
 * The period and its cost, in one line.
 *
 * The segment count comes from the SERVER's preview, never from a count done here: "today" is the server's, and
 * a browser clock an hour off would show a seller one number and create a plan with another.
 */
export function rangeChoiceSummary(preview: { start: string; end: string; segmentCount: number }): string {
  return `${preview.start} ~ ${preview.end} · ${preview.segmentCount}개 구간`;
}

/**
 * Month options for the chooser, newest first, back to `monthsBack` months before `today`.
 *
 * `today` is passed in rather than read from the clock so this is pure and testable; the component supplies the
 * server's own end date once the first preview lands, and falls back to the browser's month before that (only
 * ever to populate a list — the period that gets created is always the server's).
 */
export function monthOptions(today: string, monthsBack = 72): { value: string; label: string }[] {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return [];
  const out: { value: string; label: string }[] = [];
  for (let back = 0; back <= monthsBack; back += 1) {
    const total = year * 12 + (month - 1) - back;
    const y = Math.floor(total / 12);
    const m = (total % 12) + 1;
    if (y < 2010) break;
    const value = `${y}-${String(m).padStart(2, "0")}`;
    out.push({ value, label: `${y}년 ${m}월` });
  }
  return out;
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

/* ─────────────────── The repeated loop's 완료 결과 + 변화 요약 ─────────────────── */

/**
 * The collection result of the loop, as glanceable lines. New vs already-present carry over the same
 * honesty as everywhere else — "가져온" reviews, never "all NAVER holds". Failures are shown only when
 * there were any, so a clean run reads clean.
 */
export function loopCollectedLines(summary: ReviewOpsLoopSummary): CoverageSummaryLine[] {
  const lines: CoverageSummaryLine[] = [
    { label: "새로 추가", value: `${summary.newCount.toLocaleString()}건` },
    { label: "이미 있던 리뷰", value: `${summary.duplicateCount.toLocaleString()}건` },
  ];
  if (summary.failedCount > 0) {
    lines.push({ label: "실패", value: `${summary.failedCount.toLocaleString()}건` });
  }
  return lines;
}

/**
 * The change summary, phrased as UNVALIDATED candidate signals — never a diagnosis, never "문제 N개".
 * The issue thresholds are DRAFT and the extractor's accuracy is unmeasured, so this only ever points
 * the seller AT the issue surface; the judgement itself lives there, framed the same way.
 *
 * Priority: things that ask for a look first (확인 필요), then newly-seen / surging as the notable
 * changes; a quiet run says so rather than inventing a signal.
 */
export function loopChangeSummaryText(summary: ReviewOpsLoopSummary): string {
  const c = summary.issueChange;
  if (c.needsReview > 0) {
    return `확인이 필요한 변화 ${c.needsReview}건이 있어요. 리뷰 이슈에서 확인해 보세요.`;
  }
  const notable = c.newlyRaised + c.surging;
  if (notable > 0) {
    const parts: string[] = [];
    if (c.newlyRaised > 0) parts.push(`새로 눈에 띈 이슈 후보 ${c.newlyRaised}건`);
    if (c.surging > 0) parts.push(`늘고 있는 이슈 후보 ${c.surging}건`);
    return `${parts.join(" · ")} — 리뷰 이슈에서 확인해 보세요.`;
  }
  return "새로 확인할 변화는 없어요.";
}

/** Whether there is a newer period to carry the plan forward to (coverage is behind the reference date). */
export function hasNewPeriodToImport(summary: ReviewOpsLoopSummary): boolean {
  return !summary.upToDate;
}

/** One line on how current the collection is — up to date, or a new period is available to pull. */
export function loopFreshnessText(summary: ReviewOpsLoopSummary): string {
  return summary.upToDate
    ? "지금 기준으로 최신이에요."
    : "그 뒤로 새로 들어온 기간이 있어요. 이어서 가져올 수 있어요.";
}

function rangesText(ranges: { start: string; end: string }[]): string {
  if (!ranges || ranges.length === 0) {
    return "없음";
  }
  return ranges.map((r) => (r.start === r.end ? r.start : `${r.start} ~ ${r.end}`)).join(", ");
}
