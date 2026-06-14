import { useState } from "react";
import { StatCard } from "../components/StatCard";
import { Section } from "../components/Section";
import { ShareBars, TrendBars } from "../components/Charts";
import { useApiData } from "../lib/useApiData";
import { api } from "../lib/apiClient";
import { count, wonShort } from "../lib/format";

const PRESETS = [7, 14, 30] as const;

/** Local (not UTC) YYYY-MM-DD so the window matches the server's LocalDate.now()
 *  in KST — toISOString() would shift the date near midnight. */
function localISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function Orders() {
  const [range, setRange] = useState<number>(7);
  const [channelId, setChannelId] = useState<string>("");

  // Channel options for the filter. Strict read: on failure we say so rather
  // than silently degrade (and never show mock options unless VITE_USE_MOCKS).
  const { data: channels, error: channelsError } = useApiData(() => api.getChannelsStrict());

  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - (range - 1));
  const fromStr = localISODate(from);
  const toStr = localISODate(to);

  const { data, loading, error } = useApiData(
    () => api.getOrdersSummaryStrict({ from: fromStr, to: toStr, channelId: channelId || undefined }),
    [range, channelId],
  );

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">주문 · 매출</h1>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1">
          {PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setRange(p)}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
                range === p ? "bg-brand text-white" : "bg-canvas text-muted"
              }`}
            >
              {p}일
            </button>
          ))}
        </div>
        <select
          value={channelId}
          onChange={(e) => setChannelId(e.target.value)}
          disabled={!!channelsError}
          className="rounded-xl border border-line px-3 py-2 text-base focus:border-brand focus:outline-none disabled:opacity-50"
        >
          <option value="">전체 채널</option>
          {(channels ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.nameKo}
            </option>
          ))}
        </select>
      </div>
      {channelsError ? (
        <p className="text-sm text-warn">
          채널 목록을 불러오지 못했습니다. 전체 채널 기준으로 표시합니다.
        </p>
      ) : null}

      {loading ? (
        <p className="text-muted">불러오는 중…</p>
      ) : error || !data ? (
        <div className="rounded-xl bg-bad/10 px-4 py-3 text-bad">
          주문·매출 데이터를 불러오지 못했습니다. 백엔드가 실행 중인지 확인해 주세요.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4">
            <StatCard label={`최근 ${range}일 주문`} value={count(data.totalOrders7d)} unit="건" />
            <StatCard label={`최근 ${range}일 매출`} value={wonShort(data.totalSales7d)} unit="원" />
          </div>

          <Section title={`최근 ${range}일 주문 / 매출 추이`}>
            <TrendBars points={data.trend} />
          </Section>

          <Section title="채널별 매출 비중">
            <ShareBars items={data.channelShare} />
          </Section>
        </>
      )}
    </div>
  );
}
