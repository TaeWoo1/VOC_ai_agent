import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHead } from "../components/ui/PageHead";
import { Section, ListBox } from "../components/ui/Section";
import { AgentLaunch } from "../components/ui/AgentLaunch";
import { TrendChart } from "../components/ui/TrendChart";
import { useApiData } from "../lib/useApiData";
import { api } from "../lib/apiClient";
import { count, won, wonShort } from "../lib/format";
import { useAgentSurface } from "../lib/agentPanel";
import type { MetricSeries, SalesTrendPoint } from "../lib/types";

const PRESETS = [7, 14, 30] as const;
type Preset = (typeof PRESETS)[number];

/** Local (not UTC) YYYY-MM-DD so the window matches the server's LocalDate.now() in KST. */
function localISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parsePreset(raw: string | null): Preset {
  const n = Number(raw);
  return (PRESETS as readonly number[]).includes(n) ? (n as Preset) : 7;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function fmtDay(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${Number(m)}월 ${Number(d)}일`;
}

/** The trend, as the two series the chart draws. Same rows, two units — the chart says so. */
export function orderSeries(trend: SalesTrendPoint[]): { sales: MetricSeries; orders: MetricSeries } {
  return {
    sales: { key: "sales", label: "매출", unit: "원", points: trend.map((p) => ({ date: p.date, value: p.salesAmount })) },
    orders: { key: "orders", label: "주문", unit: "건", points: trend.map((p) => ({ date: p.date, value: p.orderCount })) },
  };
}

/**
 * 주문 — a data workspace (docs/reviewnary_design.md §7, §8-B).
 *
 * <b>The URL is the filter</b>: `?days=7|14|30`, `?channel=<id>`, `?date=YYYY-MM-DD`. The home's chart
 * links here with a day; a bar press here writes one; the channel table writes `channel`. Every number
 * on the screen is read from ONE response for the current filter, so the KPI, the chart and the table
 * cannot disagree — and when a single day is drilled into, the day's figures are labelled with the day
 * and the chart keeps the window with that day highlighted, because a one-point line is not a trend.
 *
 * <b>Only what the API can honour.</b> `/api/orders/summary` takes `from`, `to`, `channelId` and
 * nothing else; a click that the backend could not answer is not offered.
 */
export function Orders() {
  const [searchParams, setSearchParams] = useSearchParams();
  const range = parsePreset(searchParams.get("days"));
  const channelId = searchParams.get("channel") ?? "";
  const rawDate = searchParams.get("date");
  const date = rawDate && ISO_DAY.test(rawDate) ? rawDate : null;

  useAgentSurface({ surface: "orders", label: date ? `주문 · ${fmtDay(date)}` : `주문 · 최근 ${range}일`, goal: "최근 주문과 매출 변화를 채널별로 설명해 줘" });

  const write = (patch: { days?: number; channel?: string | null; date?: string | null }) => {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (patch.days !== undefined) params.set("days", String(patch.days));
        if (patch.channel !== undefined) {
          if (patch.channel) params.set("channel", patch.channel);
          else params.delete("channel");
        }
        if (patch.date !== undefined) {
          if (patch.date) params.set("date", patch.date);
          else params.delete("date");
        }
        return params;
      },
      { replace: true },
    );
  };

  const { data: channels, error: channelsError } = useApiData(() => api.getChannelsStrict());

  const { fromStr, toStr } = useMemo(() => {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - (range - 1));
    return { fromStr: localISODate(from), toStr: localISODate(to) };
  }, [range]);

  // The window: the chart always shows it, and the KPI/table show it unless a day is chosen.
  const window = useApiData(
    () => api.getOrdersSummaryStrict({ from: fromStr, to: toStr, channelId: channelId || undefined }),
    [fromStr, toStr, channelId],
  );
  // The chosen day, when there is one. Same endpoint, same channel, from = to.
  const day = useApiData(
    () => (date ? api.getOrdersSummaryStrict({ from: date, to: date, channelId: channelId || undefined }) : Promise.resolve(null)),
    [date, channelId],
  );

  const figures = date ? day.data : window.data;
  const loading = window.loading || (date ? day.loading : false);
  const error = window.error || (date ? day.error : false);
  const days = date ? 1 : range;
  const perDay = figures ? Math.round(figures.totalOrders7d / days) : 0;
  const top = figures?.channelShare[0] ?? null;
  const series = window.data ? orderSeries(window.data.trend) : null;
  const channelName = channelId ? (channels ?? []).find((c) => c.id === channelId)?.nameKo ?? null : null;
  const scopeLabel = [date ? fmtDay(date) : `최근 ${range}일`, channelName].filter(Boolean).join(" · ");

  return (
    <div className="space-y-6">
      <PageHead
        title="주문"
        meta={<span className="text-sm text-muted">주문 처리는 각 판매자센터에서 합니다</span>}
        action={<AgentLaunch context={{ surface: "orders", goal: "최근 주문과 매출 변화를 채널별로 설명해 줘" }} label="매출 변화 설명 듣기" />}
      />

      <div className="flex flex-wrap items-center gap-3" role="group" aria-label="기간과 채널">
        <div className="flex gap-0.5 rounded-lg bg-canvas p-0.5" role="group" aria-label="기간">
          {PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => write({ days: p, date: null })}
              aria-pressed={range === p && !date}
              className={`min-h-[36px] rounded-md px-3 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 ${
                range === p && !date ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"
              }`}
            >
              최근 {p}일
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-muted">
          <span>채널</span>
          <select
            value={channelId}
            onChange={(e) => write({ channel: e.target.value || null })}
            disabled={!!channelsError}
            className="min-h-[36px] rounded-lg border border-line bg-surface px-3 text-sm text-ink focus:border-brand-700 focus:outline-none disabled:opacity-50"
          >
            <option value="">전체 채널</option>
            {(channels ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.nameKo}
              </option>
            ))}
          </select>
        </label>
        {date ? (
          <button
            type="button"
            onClick={() => write({ date: null })}
            className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-brand/40 bg-brand-50 px-3 text-sm font-semibold text-brand-800 transition hover:bg-brand-50/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700"
            aria-label={`${fmtDay(date)} 선택 해제`}
            data-testid="orders-day-chip"
          >
            {fmtDay(date)}
            <span aria-hidden="true">×</span>
          </button>
        ) : (
          <span className="text-sm tabular-nums text-muted">
            {fromStr} ~ {toStr}
          </span>
        )}
      </div>
      {channelsError ? <p className="text-sm text-warn">채널 목록을 불러오지 못했습니다. 전체 채널 기준으로 표시합니다.</p> : null}

      {loading ? (
        <p className="text-sm text-muted">불러오는 중…</p>
      ) : error || !figures ? (
        <div className="rounded-xl bg-bad/10 px-4 py-3 text-sm text-bad">주문·매출 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label={`요약 · ${scopeLabel}`} data-testid="orders-figures">
            <Figure label={`주문 · ${scopeLabel}`} value={count(figures.totalOrders7d)} unit="건" />
            <Figure label="매출" value={wonShort(figures.totalSales7d)} unit="원" />
            {date ? null : <Figure label="하루 평균 주문" value={count(perDay)} unit="건" />}
            <Figure label="최다 채널" value={top ? top.channelNameKo : "—"} unit={top ? `${top.percent}%` : ""} small />
          </div>

          <Section title="추이" hint={date ? `최근 ${range}일 · ${fmtDay(date)} 선택됨 · 다시 누르면 해제` : `최근 ${range}일, 하루 단위 · 점을 누르면 그 날만 봅니다`}>
            <div className="rounded-2xl border border-line bg-surface p-4">
              {series ? (
                <TrendChart
                  primary={series.sales}
                  secondary={series.orders}
                  height={180}
                  label="매출과 주문"
                  selectedDate={date}
                  onSelectDate={(d) => write({ date: d === date ? null : d })}
                />
              ) : null}
            </div>
          </Section>

          <Section title="채널별 매출" hint={channelId ? "채널을 하나 골라 보는 중 · 전체로 돌아가려면 채널을 다시 누르세요" : "채널을 누르면 그 채널만 봅니다"}>
            <ListBox>
              {figures.channelShare.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-muted">이 기간에 집계된 매출이 없습니다.</p>
              ) : (
                <table className="w-full border-collapse text-left">
                  <caption className="sr-only">채널별 매출과 비중 · {scopeLabel}</caption>
                  <thead>
                    <tr className="border-b border-line text-sm text-muted">
                      <th scope="col" className="px-4 py-2 font-medium">채널</th>
                      <th scope="col" className="px-4 py-2 text-right font-medium">매출</th>
                      <th scope="col" className="px-4 py-2 font-medium">비중</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line/70">
                    {figures.channelShare.map((it) => {
                      const id = (channels ?? []).find((c) => c.nameKo === it.channelNameKo)?.id ?? null;
                      const selected = !!id && id === channelId;
                      return (
                        <tr key={it.channelNameKo} className={selected ? "bg-brand-50/60" : ""}>
                          <td className="px-4 py-2 font-medium text-ink">
                            {id ? (
                              <button
                                type="button"
                                onClick={() => write({ channel: selected ? null : id })}
                                aria-pressed={selected}
                                className="inline-flex min-h-[32px] items-center gap-1.5 rounded-md px-1.5 -ml-1.5 text-left transition hover:bg-canvas focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700"
                              >
                                {it.channelNameKo}
                                <svg viewBox="0 0 20 20" aria-hidden="true" className="h-3.5 w-3.5 text-muted">
                                  <path d="M7.5 4.5 13 10l-5.5 5.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                              </button>
                            ) : (
                              it.channelNameKo
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-ink">{won(it.salesAmount)}</td>
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-3">
                              <div className="h-2 w-full max-w-[240px] rounded-full bg-canvas">
                                <div className="h-2 rounded-full bg-brand-700" style={{ width: `${it.percent}%` }} />
                              </div>
                              <span className="w-12 shrink-0 text-right text-sm tabular-nums text-muted">{it.percent}%</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </ListBox>
          </Section>
        </>
      )}
    </div>
  );
}

function Figure({ label, value, unit, small = false }: { label: string; value: string; unit?: string; small?: boolean }) {
  return (
    <div className="rounded-2xl border border-line bg-surface px-4 py-3">
      <p className="break-keep text-sm font-medium text-muted">{label}</p>
      <p className={`mt-1 break-keep font-bold tabular-nums text-ink ${small ? "text-lg" : "text-2xl"}`}>
        {value}
        {unit ? <span className="ml-1 text-sm font-semibold text-muted">{unit}</span> : null}
      </p>
    </div>
  );
}
