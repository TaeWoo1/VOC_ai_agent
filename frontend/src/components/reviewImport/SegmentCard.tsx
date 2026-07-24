import { useState } from "react";
import { api } from "../../lib/apiClient";
import {
  canImport,
  canMarkMissing,
  canSplit,
  coveredRowsText,
  type SegmentTone,
  segmentUiState,
} from "../../lib/reviewImport";
import type { ReviewImportSegmentView } from "../../lib/types";
import { SegmentImportPanel } from "./SegmentImportPanel";
import { SegmentAttemptsList } from "./SegmentAttemptsList";

const PILL_CLASS: Record<SegmentTone, string> = {
  idle: "bg-surface text-muted",
  active: "bg-brand/10 text-brand",
  done: "bg-good/10 text-good",
  retry: "bg-bad/10 text-bad",
  blocked: "bg-surface text-muted line-through",
};

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/**
 * One segment. Execution and coverage are surfaced as ONE seller-facing chip (see {@link segmentUiState}),
 * a remaining item is left-highlighted, and covered rows are described honestly (valid-empty, not-yet-
 * reconciled). Actions respect the state/attempt-history rules: import/retry, split (supersedes, never
 * deletes the parent), mark-missing, merge-select — none offered where it would erase history.
 */
export function SegmentCard({
  segment,
  onChanged,
  mergeSelectable,
  mergeSelected,
  onToggleMerge,
}: {
  segment: ReviewImportSegmentView;
  onChanged: () => void;
  mergeSelectable: boolean;
  mergeSelected: boolean;
  onToggleMerge: (id: string) => void;
}) {
  const [showImport, setShowImport] = useState(false);
  const [showSplit, setShowSplit] = useState(false);
  const [showAttempts, setShowAttempts] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ui = segmentUiState(segment.executionState, segment.coverageState);
  const rangeText =
    segment.segmentStart === segment.segmentEnd
      ? segment.segmentStart
      : `${segment.segmentStart} ~ ${segment.segmentEnd}`;
  const coveredText = coveredRowsText(segment);
  const oneDay = segment.segmentStart === segment.segmentEnd;
  const midpoint = addDaysIso(segment.segmentStart, Math.floor(daysBetween(segment.segmentStart, segment.segmentEnd) / 2));
  const [splitAt, setSplitAt] = useState(midpoint);

  async function run(action: () => Promise<unknown>, failCopy: string) {
    setBusy(true);
    setError(null);
    try {
      await action();
      onChanged();
    } catch {
      setError(failCopy);
    } finally {
      setBusy(false);
    }
  }

  if (segment.superseded) {
    return (
      <li
        data-testid="segment-card"
        data-superseded="true"
        className="rounded-xl border border-line bg-canvas/60 px-4 py-3 opacity-70"
      >
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-muted line-through">{rangeText}</span>
          <span className="rounded-full bg-surface px-2 py-0.5 text-xs text-muted">분할됨</span>
        </div>
        <button
          type="button"
          onClick={() => setShowAttempts((v) => !v)}
          className="mt-1 text-xs text-muted underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          시도 기록 {showAttempts ? "접기" : "보기"}
        </button>
        {showAttempts ? <SegmentAttemptsList segmentId={segment.id} /> : null}
      </li>
    );
  }

  return (
    <li
      data-testid="segment-card"
      data-remaining={ui.remaining ? "true" : "false"}
      className={`rounded-xl border bg-canvas px-4 py-3 ${
        ui.remaining ? "border-l-4 border-l-brand border-line" : "border-line"
      }`}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {mergeSelectable ? (
              <input
                type="checkbox"
                checked={mergeSelected}
                onChange={() => onToggleMerge(segment.id)}
                aria-label={`${rangeText} 합치기 선택`}
                className="h-4 w-4 rounded border-line text-brand focus-visible:ring-2 focus-visible:ring-brand"
              />
            ) : null}
            <span className="font-medium text-ink break-keep">{rangeText}</span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${PILL_CLASS[ui.tone]}`}>
              {ui.label}
            </span>
          </div>
          {coveredText ? <p className="mt-0.5 text-sm text-muted break-keep">{coveredText}</p> : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canImport(segment) ? (
            <ActionButton onClick={() => setShowImport((v) => !v)}>
              {segment.executionState === "FAILED" ? "다시 시도" : "가져오기"}
            </ActionButton>
          ) : null}
          {canSplit(segment) && !oneDay ? (
            <ActionButton onClick={() => setShowSplit((v) => !v)}>나누기</ActionButton>
          ) : null}
          {canMarkMissing(segment) ? (
            <ActionButton
              disabled={busy}
              onClick={() =>
                run(
                  () => api.markReviewImportSegmentMissing(segment.id),
                  "구간 상태를 바꾸지 못했어요.",
                )
              }
            >
              가져올 수 없음
            </ActionButton>
          ) : null}
          <ActionButton onClick={() => setShowAttempts((v) => !v)}>시도 기록</ActionButton>
        </div>
      </div>

      {error ? (
        <p className="mt-2 text-sm text-bad" role="alert">
          {error}
        </p>
      ) : null}

      {showSplit && !oneDay ? (
        <div className="mt-3 rounded-xl border border-line bg-surface p-3">
          <label className="text-sm text-ink">
            나눌 기준일 (이 날짜까지 / 다음 날부터)
            <input
              type="date"
              value={splitAt}
              min={segment.segmentStart}
              max={addDaysIso(segment.segmentEnd, -1)}
              onChange={(e) => setSplitAt(e.target.value)}
              className="ml-2 rounded-lg border border-line px-2 py-1 text-sm"
            />
          </label>
          <div className="mt-2">
            <ActionButton
              disabled={busy || splitAt < segment.segmentStart || splitAt >= segment.segmentEnd}
              onClick={() =>
                run(
                  () =>
                    api.splitReviewImportSegment(segment.id, [
                      { start: segment.segmentStart, end: splitAt },
                      { start: addDaysIso(splitAt, 1), end: segment.segmentEnd },
                    ]),
                  "구간을 나누지 못했어요.",
                )
              }
            >
              둘로 나누기
            </ActionButton>
          </div>
        </div>
      ) : null}

      {showImport ? <SegmentImportPanel segment={segment} onImported={onChanged} /> : null}
      {showAttempts ? <SegmentAttemptsList segmentId={segment.id} /> : null}
    </li>
  );
}

function ActionButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-ink transition hover:bg-line/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}
