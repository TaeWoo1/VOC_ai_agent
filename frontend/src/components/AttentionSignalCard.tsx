import type { AttentionSignal } from "../lib/types";
import { severityStyle } from "../lib/attention";

// One operator attention signal row: severity badge, label, count, and a fixed
// guidance line. Metadata only — the signal carries no raw article text or PII.
// When `onSelect` is given, a "보기" action toggles the drill-down for this signal.

export function AttentionSignalCard({
  signal,
  onSelect,
  selected = false,
}: {
  signal: AttentionSignal;
  onSelect?: (signal: AttentionSignal) => void;
  selected?: boolean;
}) {
  const style = severityStyle(signal.severity);
  return (
    <li className="flex flex-col gap-2 py-3 md:flex-row md:items-center md:justify-between">
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={`inline-flex items-center rounded-lg px-2.5 py-1 text-sm font-semibold ${style.badge}`}
        >
          {style.label}
        </span>
        <span className="text-base font-semibold text-ink">{signal.label}</span>
        <span className="text-base font-semibold text-ink">
          {signal.count.toLocaleString("ko-KR")}건
        </span>
      </div>
      <div className="flex items-center gap-3">
        <p className="text-sm text-muted">{signal.description}</p>
        {onSelect ? (
          <button
            type="button"
            onClick={() => onSelect(signal)}
            aria-pressed={selected}
            className={`btn-ghost shrink-0 px-3 py-1.5 text-sm ${selected ? "text-brand-700" : ""}`}
          >
            {selected ? "닫기" : "보기"}
          </button>
        ) : null}
      </div>
    </li>
  );
}
