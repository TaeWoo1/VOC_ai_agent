import type { AttentionSignal } from "../lib/types";
import { severityStyle } from "../lib/attention";

// One operator attention signal row: severity badge, label, count, and a fixed
// guidance line. Metadata only — the signal carries no raw article text or PII.

export function AttentionSignalCard({ signal }: { signal: AttentionSignal }) {
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
      <p className="text-sm text-muted">{signal.description}</p>
    </li>
  );
}
