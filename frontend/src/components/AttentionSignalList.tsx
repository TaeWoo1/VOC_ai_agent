import { useCallback, useEffect, useMemo, useState } from "react";
import { Section } from "./Section";
import { AttentionSignalCard } from "./AttentionSignalCard";
import { AttentionSignalDrilldown } from "./AttentionSignalDrilldown";
import { useApiData } from "../lib/useApiData";
import { api } from "../lib/apiClient";
import { attentionUncertaintyCopy, reviewsNeedingAttention, sortBySeverity } from "../lib/attention";
import { toIsoDate } from "../lib/backfillPresets";
import type { AttentionSignal } from "../lib/types";

// "오늘 확인할 일" — a channel-generic, severity-ranked list of action items derived
// from collected review/inquiry data over a selectable window. Self-fetching and
// fail-closed; the items are metadata-only signals (counts), never raw VOC text.
// "보기" opens an inline drill-down of the metadata-only rows behind a signal.

type Period = "today" | "d7" | "d30";

const PERIODS: ReadonlyArray<{ key: Period; label: string; days: number }> = [
  { key: "today", label: "오늘", days: 0 },
  { key: "d7", label: "최근 7일", days: 6 },
  { key: "d30", label: "최근 30일", days: 29 },
];

function rangeFor(period: Period): { from: string; to: string } {
  const days = PERIODS.find((p) => p.key === period)?.days ?? 6;
  const today = new Date();
  const from = new Date(today);
  from.setDate(from.getDate() - days);
  return { from: toIsoDate(from), to: toIsoDate(today) };
}

// A signal carries no id; LOW_RATING_REVIEW appears twice (HIGH 1–2★, MEDIUM 3★),
// so the selection key must include severity to distinguish the two cards.
function signalKey(s: AttentionSignal, index: number): string {
  return `${s.type}-${s.severity}-${index}`;
}

export function AttentionSignalList({
  accountId,
  refreshKey = 0,
}: {
  accountId: string;
  refreshKey?: number;
}) {
  const [period, setPeriod] = useState<Period>("d7");
  const range = useMemo(() => rangeFor(period), [period]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // Bumped when an operator records a reply as posted. The COUNT lives in this component's read, so
  // refetching the drill-down alone would leave the headline stating a number the list contradicts —
  // and the seller would watch it sit still while they worked. Composite rather than additive: the
  // page-level refreshKey is a hash and may be any value, so summing the two could collide.
  const [reloadKey, setReloadKey] = useState(0);
  const noteOutcomeRecorded = useCallback(() => setReloadKey((k) => k + 1), []);
  const readKey = `${refreshKey}:${reloadKey}`;

  const { data, loading, error } = useApiData(
    () => api.getAccountAttention(accountId, range),
    [accountId, range.from, range.to, readKey],
  );

  // The drill-down is window-scoped; a window/account change invalidates it.
  useEffect(() => {
    setSelectedKey(null);
  }, [accountId, range.from, range.to, readKey]);

  const items = data ? sortBySeverity(data.items) : [];
  // A scope SellerOps cannot safely attribute (multi-account channel, or a channel with no source)
  // must NEVER render as "확인할 일이 없습니다." — that is the false calm this guard exists to prevent.
  const uncertainty = data ? attentionUncertaintyCopy(data.coverage) : null;
  // The review-ops headline: the one number an operator wants right after an acquisition run.
  // Rendered only when the read succeeded AND it is non-zero — a "0건" line on a dead or empty
  // read would read as reassurance the data does not support.
  const reviewCount = data ? reviewsNeedingAttention(data.items) : 0;

  return (
    <Section title="오늘 확인할 일">
      <div className="mb-4 flex flex-wrap gap-2">
        {PERIODS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => setPeriod(p.key)}
            className={`rounded-xl px-3 py-1.5 text-sm font-semibold ${
              period === p.key ? "bg-brand/10 text-brand-700" : "bg-canvas text-muted"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-base text-muted">불러오는 중…</p>
      ) : error || !data ? (
        <p className="rounded-xl bg-bad/5 px-4 py-3 text-base text-bad">
          확인할 일을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
        </p>
      ) : uncertainty ? (
        <div
          className="rounded-xl bg-warn/5 px-4 py-3"
          role="status"
          data-testid="attention-coverage-uncertain"
        >
          <p className="text-base font-semibold text-ink">{uncertainty.headline}</p>
          <p className="mt-1 text-sm text-muted">{uncertainty.detail}</p>
        </div>
      ) : items.length === 0 ? (
        <p className="text-base text-muted">지금 확인할 일이 없습니다.</p>
      ) : (
        <>
          {reviewCount > 0 ? (
            <p className="mb-3 text-base font-semibold text-ink" data-testid="reviews-needing-attention">
              현재 확인이 필요한 리뷰 {reviewCount}건
            </p>
          ) : null}
          <ul className="divide-y divide-line">
            {items.map((s, i) => {
              const key = signalKey(s, i);
              return (
                <AttentionSignalCard
                  key={key}
                  signal={s}
                  selected={selectedKey === key}
                  onSelect={() => setSelectedKey((prev) => (prev === key ? null : key))}
                />
              );
            })}
          </ul>
          {items.map((s, i) => {
            const key = signalKey(s, i);
            return selectedKey === key ? (
              <AttentionSignalDrilldown
                key={`drill-${key}`}
                signal={s}
                accountId={accountId}
                from={range.from}
                to={range.to}
                refreshKey={readKey}
                onOutcomeRecorded={noteOutcomeRecorded}
                onClose={() => setSelectedKey(null)}
              />
            ) : null;
          })}
        </>
      )}
    </Section>
  );
}
