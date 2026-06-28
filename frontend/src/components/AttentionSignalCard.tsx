import type { AttentionSignal } from "../lib/types";
import {
  SPIKE_STYLE,
  isSpikeSignal,
  severityStyle,
  signalActionLabel,
  spikeComparisonText,
} from "../lib/attention";

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
  const spike = isSpikeSignal(signal.type);
  // Spikes show a quantified comparison line when the structured metadata is present;
  // otherwise fall back to the prose description (never parsed for numbers).
  const whatChanged = spike && signal.spike ? spikeComparisonText(signal.spike) : signal.description;
  return (
    <li
      className={`flex flex-col gap-2 py-3 md:flex-row md:items-center md:justify-between ${
        spike ? SPIKE_STYLE.card : ""
      }`}
    >
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={`inline-flex items-center rounded-lg px-2.5 py-1 text-sm font-semibold ${style.badge}`}
        >
          {style.label}
        </span>
        {spike ? (
          <span
            title={SPIKE_STYLE.hint}
            className={`inline-flex items-center rounded-lg px-2 py-1 text-xs font-semibold ${SPIKE_STYLE.chip}`}
          >
            {SPIKE_STYLE.tag}
          </span>
        ) : null}
        <span className="text-base font-semibold text-ink">{signal.label}</span>
        <span className="text-base font-semibold text-ink">
          {signal.count.toLocaleString("ko-KR")}건
        </span>
      </div>
      <div className="flex items-center gap-3">
        {/* Spikes promote the "what changed" line out of muted prose so the volume
            jump reads as the point of the card; routine signals keep the quiet hint. */}
        <p className={spike ? "text-sm font-medium text-ink" : "text-sm text-muted"}>
          {whatChanged}
        </p>
        {onSelect ? (
          <button
            type="button"
            onClick={() => onSelect(signal)}
            aria-pressed={selected}
            className={`btn-ghost shrink-0 px-3 py-1.5 text-sm ${selected ? "text-brand-700" : ""}`}
          >
            {selected ? "닫기" : signalActionLabel(signal.type)}
          </button>
        ) : null}
      </div>
    </li>
  );
}
