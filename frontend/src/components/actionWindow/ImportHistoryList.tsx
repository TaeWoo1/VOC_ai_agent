import { useApiData } from "../../lib/useApiData";
import { api } from "../../lib/apiClient";
import { importOutcome, importTimestamp, provenanceLabel, type ImportTone } from "../../lib/importHistory";
import { importDate } from "../../lib/format";

/**
 * 최근 가져오기 기록 — the seller's own record of what their review imports brought.
 *
 * Self-fetching and **fail-closed**, the same rule the attention reads follow: a dead backend renders
 * an error, never the calm empty state. The two are different facts and must never be confused —
 * "아직 가져온 기록이 없어요" says the seller has never imported, and saying that when the read simply
 * failed would be a reassuring lie.
 *
 * **Recent, and it says so.** The endpoint is bounded (newest N), so the heading claims recency rather
 * than completeness — this is not an archive and must not read as one.
 *
 * **Scoped, and it says that too.** The read selects file uploads and seller-center exports. Reviews
 * that arrive by API collection (a `dataType=REVIEW` sync run) are a different acquisition path and do
 * NOT appear here, so the sub-heading names the two paths it covers rather than claiming to be every
 * review the seller has ever collected.
 *
 * Persistence is the point. Until now the home's activity rail lived in browser memory: it started
 * empty and vanished on reload, so yesterday's import left no trace anywhere the seller looks. This
 * reads the imports the backend has been recording all along.
 *
 * Copy is FE-owned (`lib/importHistory.ts`); the server sends counts, a status and a provenance, and
 * never an error message — a failure is explained here, not quoted from the backend.
 */
const TONE_CLASS: Record<ImportTone, string> = {
  good: "text-good",
  warn: "text-warn",
  bad: "text-bad",
  muted: "text-muted",
};

/** How many rows the rail asks for — "recent", not an archive. */
const RECENT_LIMIT = 10;

export function ImportHistoryList() {
  const { data, loading, error } = useApiData(() => api.getReviewImportsStrict(RECENT_LIMIT), []);

  return (
    <section aria-label="최근 가져오기 기록" className="rounded-2xl bg-surface p-5 shadow-card">
      <h2 className="mb-1 text-lg font-semibold text-ink">최근 가져오기 기록</h2>
      <p className="mb-3 text-sm text-muted">
        파일 업로드와 셀러센터 내보내기로 가져온 리뷰 내역이에요.
      </p>
      {loading ? (
        <p className="text-base text-muted">불러오는 중…</p>
      ) : error || !data ? (
        // Fail closed. An empty list here would tell the seller they have never imported.
        <p className="rounded-xl bg-bad/5 px-4 py-3 text-base text-bad" role="alert">
          가져오기 기록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.
        </p>
      ) : data.length === 0 ? (
        <p className="text-base text-muted">아직 가져온 리뷰가 없어요.</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {data.map((item) => {
            const outcome = importOutcome(item);
            return (
              <li
                key={item.id}
                data-testid="import-history-row"
                className="flex flex-col gap-1 rounded-xl border border-line bg-canvas px-4 py-3 sm:flex-row sm:items-center sm:gap-3"
              >
                <span className="min-w-0 flex-1 break-keep">
                  <span className={`block font-medium ${TONE_CLASS[outcome.tone]}`}>
                    {outcome.headline}
                  </span>
                  <span className="block text-sm text-muted">
                    {provenanceLabel(item.method)}
                    {outcome.detail ? ` · ${outcome.detail}` : ""}
                  </span>
                </span>
                <span className="shrink-0 text-sm text-muted sm:text-right">
                  {importDate(importTimestamp(item))}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
