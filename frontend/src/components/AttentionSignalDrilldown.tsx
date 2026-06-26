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
  onClose,
}: {
  signal: AttentionSignal;
  accountId: string;
  from: string;
  to: string;
  refreshKey?: number;
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
          the combined 1~3점 set, so the list total can exceed this card's count. */}
      {signal.type === "LOW_RATING_REVIEW" ? (
        <p className="mb-3 text-sm text-muted">낮은 평점(1~3점) 리뷰 전체를 보여줍니다.</p>
      ) : null}
      <OperatorVocItemList
        accountId={accountId}
        type={signal.type}
        from={from}
        to={to}
        refreshKey={refreshKey}
      />
    </div>
  );
}
