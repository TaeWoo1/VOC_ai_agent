import { useMemo, useState } from "react";
import { Section } from "./Section";
import { AttentionSignalCard } from "./AttentionSignalCard";
import { useApiData } from "../lib/useApiData";
import { api } from "../lib/apiClient";
import { sortBySeverity } from "../lib/attention";
import { toIsoDate } from "../lib/backfillPresets";

// "오늘 확인할 일" — a channel-generic, severity-ranked list of action items derived
// from collected review/inquiry data over a selectable window. Self-fetching and
// fail-closed; the items are metadata-only signals (counts), never raw VOC text.

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

export function AttentionSignalList({
  accountId,
  refreshKey = 0,
}: {
  accountId: string;
  refreshKey?: number;
}) {
  const [period, setPeriod] = useState<Period>("d7");
  const range = useMemo(() => rangeFor(period), [period]);

  const { data, loading, error } = useApiData(
    () => api.getAccountAttention(accountId, range),
    [accountId, range.from, range.to, refreshKey],
  );

  const items = data ? sortBySeverity(data.items) : [];

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
          확인할 일을 불러오지 못했습니다. 백엔드가 실행 중인지 확인해 주세요.
        </p>
      ) : items.length === 0 ? (
        <p className="text-base text-muted">지금 확인할 일이 없습니다.</p>
      ) : (
        <ul className="divide-y divide-line">
          {items.map((s, i) => (
            <AttentionSignalCard key={`${s.type}-${s.severity}-${i}`} signal={s} />
          ))}
        </ul>
      )}
    </Section>
  );
}
