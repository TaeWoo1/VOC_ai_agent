import { useApiData } from "../../lib/useApiData";
import { api } from "../../lib/apiClient";
import type { ReviewImportAttemptView } from "../../lib/types";

/** Retry history for one segment — each attempt with its own outcome and row tallies. Fail-closed. */
export function SegmentAttemptsList({ segmentId }: { segmentId: string }) {
  const { data, loading, error } = useApiData<ReviewImportAttemptView[]>(
    () => api.getReviewImportSegmentAttempts(segmentId),
    [segmentId],
  );

  if (loading) {
    return <p className="mt-2 text-sm text-muted">불러오는 중…</p>;
  }
  if (error || !data) {
    return (
      <p className="mt-2 text-sm text-bad" role="alert">
        시도 기록을 불러오지 못했어요.
      </p>
    );
  }
  if (data.length === 0) {
    return <p className="mt-2 text-sm text-muted">아직 시도한 기록이 없어요.</p>;
  }

  return (
    <ol className="mt-2 flex flex-col gap-1" aria-label="시도 기록">
      {data.map((a) => (
        <li
          key={a.attemptNo}
          data-testid="segment-attempt-row"
          className="flex flex-col gap-0.5 rounded-lg border border-line bg-surface px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between"
        >
          <span className="text-ink">
            {a.attemptNo}차 시도 · {resultLabel(a.result)}
          </span>
          <span className="text-muted">
            {a.result === "SUCCEEDED"
              ? `새로 ${nz(a.rowsNew)}건 · 중복 ${nz(a.rowsDuplicate)}건 · 실패 ${nz(a.rowsFailed)}건`
              : a.errorMessage || "—"}
          </span>
        </li>
      ))}
    </ol>
  );
}

function resultLabel(result: string): string {
  switch (result) {
    case "SUCCEEDED":
      return "성공";
    case "FAILED":
      return "실패";
    default:
      return "진행 중";
  }
}

function nz(v: number | null): number {
  return v ?? 0;
}
