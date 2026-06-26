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
