import { useState } from "react";
import { PageHead } from "../components/ui/PageHead";
import { Section, ListBox } from "../components/ui/Section";
import { AgentLaunch } from "../components/ui/AgentLaunch";
import { TrendBars } from "../components/Charts";
import { useApiData } from "../lib/useApiData";
import { api } from "../lib/apiClient";
import { count, won, wonShort } from "../lib/format";

const PRESETS = [7, 14, 30] as const;

/** Local (not UTC) YYYY-MM-DD so the window matches the server's LocalDate.now() in KST. */
function localISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * 주문 — a data workspace, not a dashboard card (docs/reviewnary_design.md §7).
 *
 * Filters first, at full weight; four compact numbers; one trend chart; the channel share as a table
 * with bars. The 「운영 인사이트」 card is gone: 「하루 평균 약 27건」 is a number and now is one, and
 * 「네이버가 매출의 56%로 가장 큽니다」 is the first row of the table. Order handling itself stays in
 * each seller centre — this screen reads.
 */
export function Orders() {
  const [range, setRange] = useState<number>(7);
  const [channelId, setChannelId] = useState<string>("");

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

  const perDay = data ? Math.round(data.totalOrders7d / range) : 0;
  const top = data?.channelShare[0] ?? null;

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
              onClick={() => setRange(p)}
              aria-pressed={range === p}
              className={`min-h-[36px] rounded-md px-3 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 ${
                range === p ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"
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
            onChange={(e) => setChannelId(e.target.value)}
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
        <span className="text-sm tabular-nums text-muted">
          {fromStr} ~ {toStr}
        </span>
      </div>
      {channelsError ? <p className="text-sm text-warn">채널 목록을 불러오지 못했습니다. 전체 채널 기준으로 표시합니다.</p> : null}

      {loading ? (
        <p className="text-sm text-muted">불러오는 중…</p>
      ) : error || !data ? (
        <div className="rounded-xl bg-bad/10 px-4 py-3 text-sm text-bad">주문·매출 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="요약">
            <Figure label="주문" value={count(data.totalOrders7d)} unit="건" />
            <Figure label="매출" value={wonShort(data.totalSales7d)} unit="원" />
            <Figure label="하루 평균 주문" value={count(perDay)} unit="건" />
            <Figure label="최다 채널" value={top ? top.channelNameKo : "—"} unit={top ? `${top.percent}%` : ""} small />
          </div>

          <Section title="추이" hint="하루 단위 매출">
            <div className="rounded-2xl border border-line bg-surface p-4">
              <TrendBars points={data.trend} />
            </div>
          </Section>

          <Section title="채널별 매출">
            <ListBox>
              {data.channelShare.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-muted">이 기간에 집계된 매출이 없습니다.</p>
              ) : (
                <table className="w-full border-collapse text-left">
                  <caption className="sr-only">채널별 매출과 비중</caption>
                  <thead>
                    <tr className="border-b border-line text-sm text-muted">
                      <th scope="col" className="px-4 py-2 font-medium">채널</th>
                      <th scope="col" className="px-4 py-2 text-right font-medium">매출</th>
                      <th scope="col" className="px-4 py-2 font-medium">비중</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line/70">
                    {data.channelShare.map((it) => (
                      <tr key={it.channelNameKo}>
                        <td className="px-4 py-2.5 font-medium text-ink">{it.channelNameKo}</td>
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
                    ))}
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
      <p className="text-sm font-medium text-muted">{label}</p>
      <p className={`mt-1 break-keep font-bold tabular-nums text-ink ${small ? "text-lg" : "text-2xl"}`}>
        {value}
        {unit ? <span className="ml-1 text-sm font-semibold text-muted">{unit}</span> : null}
      </p>
    </div>
  );
}
