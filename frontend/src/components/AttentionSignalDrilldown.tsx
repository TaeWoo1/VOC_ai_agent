import type { AttentionSignal } from "../lib/types";
import { OperatorVocItemList } from "./OperatorVocItemList";

// Inline panel under the signal list: shows the metadata-only rows behind the
// selected signal, scoped to the same window the list is already showing.

export function AttentionSignalDrilldown({
  signal,
  accountId,
  from,
  to,
  refreshKey = 0,
  onOutcomeRecorded,
  onClose,
}: {
  signal: AttentionSignal;
  accountId: string;
  from: string;
  to: string;
  refreshKey?: number | string;
  onOutcomeRecorded?: () => void;
  onClose: () => void;
}) {
  return (
    <div className="mt-4 rounded-xl border border-line bg-canvas/40 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-base font-bold text-ink">
          {signal.label} · {signal.count.toLocaleString("ko-KR")}건
        </h3>
        <button type="button" onClick={onClose} className="btn-ghost px-3 py-1.5 text-sm">
          닫기
        </button>
      </div>
      {/* The two low/mid-rating cards (1~2점·3점) share one signal type and drill to
          the combined 1~3점 set, so the list total can exceed this card's count.

          States the list's SCOPE, not its contents. It used to say "전체를 보여줍니다" — true
          then, false the moment the list gained a classification facet, since a filtered list
          is a subset of that scope. The sentence exists to explain why the total can exceed the
          card's count, and it still does that without claiming nothing is filtered. */}
      {signal.type === "LOW_RATING_REVIEW" ? (
        <p className="mb-3 text-sm text-muted">
          낮은 평점(1~3점) 리뷰가 이 목록의 대상입니다. 답변함으로 기록한 리뷰는 위 건수에서 빠지지만
          목록 아래쪽에 계속 표시돼요.
        </p>
      ) : null}
      <OperatorVocItemList
        accountId={accountId}
        type={signal.type}
        from={from}
        to={to}
        refreshKey={refreshKey}
        onOutcomeRecorded={onOutcomeRecorded}
      />
    </div>
  );
}
