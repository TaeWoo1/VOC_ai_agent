import { useMemo, useState } from "react";
import { Section } from "./Section";
import { StatCard } from "./StatCard";
import { useApiData } from "../lib/useApiData";
import { api } from "../lib/apiClient";
import { won, count, relativeTime } from "../lib/format";
import { toIsoDate } from "../lib/backfillPresets";

// Channel-generic operator summary cards over a selectable window: order/sales
// totals, new review/inquiry counts, conservative unanswered count, and last sync
// state. Self-fetching; fails closed so a dead backend never shows demo numbers.

type Period = "today" | "d7" | "d30";

const PERIODS: Array<{ key: Period; label: string; days: number }> = [
  { key: "today", label: "오늘", days: 0 },
  { key: "d7", label: "최근 7일", days: 6 },
  { key: "d30", label: "최근 30일", days: 29 },
];

function rangeFor(period: Period): { from: string; to: string } {
  const days = PERIODS.find((p) => p.key === period)?.days ?? 0;
  const today = new Date();
  const from = new Date(today);
  from.setDate(from.getDate() - days);
  return { from: toIsoDate(from), to: toIsoDate(today) };
}

const SYNC_STATE_LABEL: Record<string, string> = {
  CONNECTED: "정상",
  NOT_COLLECTED: "수집 전",
  DEGRADED: "주의",
  EXPIRED: "재연결 필요",
  NEEDS_REAUTH: "재연결 필요",
  DISCONNECTED: "연결 끊김",
};

export function ChannelSummaryCards({
  accountId,
  refreshKey = 0,
}: {
  accountId: string;
  refreshKey?: number;
}) {
  const [period, setPeriod] = useState<Period>("d7");
  const range = useMemo(() => rangeFor(period), [period]);
  const prefix = PERIODS.find((p) => p.key === period)?.label ?? "";

  const { data, loading, error } = useApiData(
    () => api.getAccountDashboard(accountId, range),
    [accountId, range.from, range.to, refreshKey],
  );

  const syncLabel = data ? SYNC_STATE_LABEL[data.lastSyncState] ?? data.lastSyncState : "-";
  const syncTone = data && (data.lastSyncState === "CONNECTED" || data.lastSyncState === "NOT_COLLECTED")
    ? "default"
    : "warn";

  return (
    <Section title="요약">
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
          요약 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
          <StatCard label={`${prefix} 매출`} value={won(data.salesAmount)} />
          <StatCard label={`${prefix} 주문 수`} value={count(data.orderCount)} unit="건" />
          <StatCard label={`${prefix} 신규 리뷰`} value={count(data.newReviews)} unit="건" />
          <StatCard label={`${prefix} 신규 문의`} value={count(data.newInquiries)} unit="건" />
          <StatCard
            label={`${prefix} 미답변 문의`}
            value={count(data.unansweredInquiries)}
            unit="건"
            tone={data.unansweredInquiries > 0 ? "warn" : "default"}
          />
          <StatCard
            label="마지막 수집 상태"
            value={syncLabel}
            unit={data.lastSuccessAt ? relativeTime(data.lastSuccessAt) : undefined}
            tone={syncTone}
          />
        </div>
      )}
    </Section>
  );
}
