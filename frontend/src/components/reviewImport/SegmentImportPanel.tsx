import { useRef, useState } from "react";
import { api } from "../../lib/apiClient";
import type { ReviewImportSegmentView } from "../../lib/types";

/**
 * Per-segment import. The operator runs the EXISTING operator-driven NAVER Action Window export for
 * EXACTLY this segment's range — the Runtime never automates a marketplace click — confirms that the
 * actual `readExportScope()` matched this range, and hands the resulting file here. Upload is refused
 * until the scope is confirmed (the per-segment scope-confirmation gate) and a file is chosen; the file
 * goes to the existing segment multipart-import API, which ingests it dedup-safe.
 */
export function SegmentImportPanel({
  segment,
  onImported,
}: {
  segment: ReviewImportSegmentView;
  onImported: () => void;
}) {
  const [scopeConfirmed, setScopeConfirmed] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const rangeText =
    segment.segmentStart === segment.segmentEnd
      ? segment.segmentStart
      : `${segment.segmentStart} ~ ${segment.segmentEnd}`;
  const canSubmit = scopeConfirmed && !!file && !busy;

  async function submit() {
    if (!file || !scopeConfirmed) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.importReviewImportSegment(segment.id, true, file);
      setFile(null);
      setScopeConfirmed(false);
      if (inputRef.current) {
        inputRef.current.value = "";
      }
      onImported();
    } catch {
      setError("가져오기에 실패했어요. 파일과 내보내기 범위를 확인한 뒤 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-line bg-canvas p-4" data-testid="segment-import-panel">
      <p className="text-sm text-ink">
        NAVER에서 <span className="font-semibold">{rangeText}</span> 범위를 직접 내보낸 뒤 파일을 올려 주세요.
      </p>
      <p className="mt-1 text-sm text-muted break-keep">
        내보내기·확인 클릭은 항상 판매자가 직접 합니다(자동 클릭 없음). 내보내기 화면에서 실제 범위가
        이 구간과 같은지 확인하세요.
      </p>
      <p className="mt-1 text-sm text-muted break-keep">
        NAVER에서 받은 파일은 이름에 확장자가 없을 수 있습니다. 그대로 올리시면 됩니다 — 파일 내용을 보고
        엑셀/CSV인지 확인합니다.
      </p>

      <label className="mt-3 flex items-start gap-2 text-sm text-ink">
        <input
          type="checkbox"
          checked={scopeConfirmed}
          onChange={(e) => setScopeConfirmed(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-line text-brand-700 focus-visible:ring-2 focus-visible:ring-brand"
          aria-describedby={`scope-confirm-help-${segment.id}`}
        />
        <span id={`scope-confirm-help-${segment.id}`} className="break-keep">
          내보낸 실제 범위가 이 구간({rangeText})과 정확히 일치함을 확인했습니다.
        </span>
      </label>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          ref={inputRef}
          type="file"
          // No `accept` filter, deliberately. NAVER's review export arrives with no filename at all, so
          // the browser saves it as a bare UUID — and `accept=".xlsx,.csv"` greys that file out in the
          // picker, making the fallback unable to accept the one file it exists for (measured live,
          // 2026-08-23). The server decides format from the bytes (`UploadFormat`), which is a stronger
          // check than an extension ever was, and refuses anything else with a legible failure.
          aria-label="내보낸 리뷰 파일"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="text-sm text-ink file:mr-3 file:rounded-lg file:border-0 file:bg-surface file:px-3 file:py-2 file:text-sm file:text-ink"
        />
        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          className="rounded-xl bg-brand-700 px-4 py-2 font-medium text-white transition hover:bg-brand-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "가져오는 중…" : "이 구간 가져오기"}
        </button>
      </div>

      {error ? (
        <p className="mt-2 text-sm text-bad" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
