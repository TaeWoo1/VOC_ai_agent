import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PageHead } from "../../components/ui/PageHead";
import { SectionHeader } from "../../components/ui/SectionHeader";
import { Metric, MetricGrid, MetricNote } from "../../components/ui/Metric";
import { TrendChart } from "../../components/ui/TrendChart";
import { InsightList } from "../../components/ui/InsightList";
import { DataTable, Td, Th } from "../../components/ui/DataTable";
import { DataStateBadge } from "../../components/ui/DataState";
import { AgentLaunch } from "../../components/ui/AgentLaunch";
import { Empty } from "../../components/ui/Empty";
import { ProactiveSummaryBanner } from "../../components/proactive/ProactiveSummaryBanner";
import { BtnLink } from "../../components/ui/Btn";
import { useApiData } from "../../lib/useApiData";
import { api } from "../../lib/apiClient";
import { count, wonShort } from "../../lib/format";
import { analytics } from "../../lib/analytics";
import type { ChannelMetricRow, MetricSeries, OverviewResponse } from "../../lib/types";

/**
 * 홈 — the operations dashboard.
 *
 * <b>What changed, and why it is allowed to change.</b> The previous home was a text list of today's
 * work, and its own comment defended that: "no metric nobody has verified is derivable". The
 * objection was correct and the answer is not to drop the standard — it is to make the numbers
 * derivable and say what each one is. Every figure here comes from `/api/dashboard/overview`, which
 * ships its own definition of 매출, excludes channels that could not report, and names them.
 *
 * <b>The screen decides nothing about coverage.</b> Which channels are in a total, whether a zero is
 * real, and what to call each state are all settled server-side. A component that re-derived any of
 * that would be a second implementation of the rule that keeps "네이버 문의 0건" off this page.
 *
 * <b>One PRIMARY, then SUPPORTING, then REFERENCE</b> (`docs/frontend_ux_audit_v1.md` R1): the six
 * KPIs answer the screen, the three charts and the channel table explain them, and the definitions
 * sit at the bottom where they can be read once.
 */
const RANGES = [7, 14, 30] as const;

export function Overview() {
  const [days, setDays] = useState<number>(7);
  const { data, loading, error } = useApiData<OverviewResponse>(
    () => api.getOverviewStrict(days),
    [days],
  );
  const navigate = useNavigate();

  useMemo(() => analytics.track("today_inbox_viewed"), []);

  const series = useMemo(() => {
    const byKey = new Map<string, MetricSeries>();
    for (const s of data?.metrics.series ?? []) {
      byKey.set(s.key, s);
    }
    return byKey;
  }, [data]);

  return (
    <div className="space-y-8">
      <PageHead
        title="운영 현황"
        description="연결된 채널의 매출·주문·문의·리뷰를 한 화면에서 봅니다."
        action={<AgentLaunch context={{ surface: "overview" }} />}
        meta={
          <div className="flex gap-1" role="group" aria-label="기간 선택">
            {RANGES.map((range) => (
              <button
                key={range}
                type="button"
                onClick={() => setDays(range)}
                aria-pressed={days === range}
                className={`min-h-[36px] rounded-lg px-3 py-1.5 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2 ${
                  days === range ? "bg-brand-700 text-white" : "bg-canvas text-muted hover:text-ink"
                }`}
              >
                최근 {range}일
              </button>
            ))}
          </div>
        }
      />

      {/* Above the KPIs: the numbers say what the shop DID, this line says what is waiting. It is
          an entry point, not a second list — the cards themselves live on 문의. */}
      <ProactiveSummaryBanner />

      {loading ? <p className="text-muted">불러오는 중…</p> : null}

      {!loading && (error || !data) ? (
        <Empty
          title="운영 현황을 불러오지 못했습니다"
          body="집계를 읽는 중 문제가 생겼습니다. 잠시 후 다시 시도해 주세요. 채널 연결 상태는 연결 화면에서 확인할 수 있습니다."
          action={<BtnLink to="/connect">채널 연결 열기</BtnLink>}
        />
      ) : null}

      {data ? (
        <>
          {/* PRIMARY — the six numbers the screen exists to answer. */}
          <MetricGrid>
            {data.metrics.kpis.map((kpi) => (
              <Metric
                key={kpi.key}
                kpi={kpi}
                emphasis={kpi.key === "unansweredInquiries"}
                onClick={KPI_ROUTE[kpi.key] ? () => navigate(KPI_ROUTE[kpi.key]!) : undefined}
              />
            ))}
          </MetricGrid>

          {/* The qualification, once, where the numbers are — not at the foot of the page. */}
          <MetricNote
            revenueBasis={data.metrics.revenueBasis}
            freshness={data.metrics.kpis.some((kpi) => kpi.freshnessUnproven)}
          />

          {data.insights.length > 0 ? (
            <section className="space-y-2">
              <SectionHeader title="지금 눈여겨볼 것" hint="운영 데이터에서 바로 확인된 것만 보여줍니다." />
              <InsightList insights={data.insights} />
            </section>
          ) : null}

          {/* SUPPORTING — the shape behind each number. */}
          <section className="space-y-4">
            <SectionHeader title="추이" hint={`최근 ${data.metrics.period.days}일, 하루 단위`} />
            <div className="grid gap-4 lg:grid-cols-3">
              <ChartCard title="매출 / 주문">
                <TrendChart
                  primary={series.get("revenue") ?? EMPTY_SERIES}
                  secondary={series.get("orders")}
                />
              </ChartCard>
              <ChartCard title="문의 / 미답변">
                <TrendChart
                  primary={series.get("inquiries") ?? EMPTY_SERIES}
                  secondary={series.get("unansweredInquiries")}
                />
              </ChartCard>
              <ChartCard title="리뷰 / 부정 리뷰">
                <TrendChart
                  primary={series.get("reviews") ?? EMPTY_SERIES}
                  secondary={series.get("negativeReviews")}
                />
              </ChartCard>
            </div>
          </section>

          <section className="space-y-3">
            <SectionHeader
              title="채널별"
              hint="각 채널이 지금 무엇을 말할 수 있는지도 함께 표시합니다."
            />
            <ChannelBreakdown rows={data.metrics.channels} />
          </section>

          {/* REFERENCE — read once, then ignored. Not a card, and last. */}
          <section className="space-y-2">
            <SectionHeader title="이 숫자에 대하여" />
            <dl className="space-y-2 text-sm text-muted">
              <div>
                <dt className="inline font-medium text-ink">매출 · </dt>
                <dd className="inline break-keep">{data.metrics.revenueBasis}</dd>
              </div>
              <div>
                <dt className="inline font-medium text-ink">주문 건수 · </dt>
                <dd className="inline break-keep">{data.metrics.orderCountBasis}</dd>
              </div>
              {data.metrics.exclusions.length > 0 ? (
                <div>
                  <dt className="inline font-medium text-ink">합계에서 빠진 것 · </dt>
                  <dd className="inline break-keep">
                    {data.metrics.exclusions
                      .map((e) => `${e.channelNameKo} ${DATA_TYPE_KO[e.dataType] ?? e.dataType}(${e.reasonKo})`)
                      .join(" · ")}
                  </dd>
                </div>
              ) : null}
              <div>
                <dt className="inline font-medium text-ink">기간 · </dt>
                <dd className="inline tabular-nums">
                  {data.metrics.period.from} ~ {data.metrics.period.to} (비교: {data.metrics.period.previousFrom} ~{" "}
                  {data.metrics.period.previousTo})
                </dd>
              </div>
            </dl>
          </section>
        </>
      ) : null}
    </div>
  );
}

/** Which screen owns each number, so a metric can be opened rather than merely read. */
const KPI_ROUTE: Record<string, string | undefined> = {
  revenue: "/orders",
  orders: "/orders",
  inquiries: "/inquiries",
  unansweredInquiries: "/inquiries",
  reviews: "/reviews",
  negativeReviews: "/reviews",
};

const DATA_TYPE_KO: Record<string, string> = {
  ORDER_SUMMARY: "주문",
  INQUIRY: "문의",
  REVIEW: "리뷰",
};

const EMPTY_SERIES: MetricSeries = { key: "none", label: "", unit: "건", points: [] };

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-5">
      <h3 className="mb-3 text-base font-semibold text-ink">{title}</h3>
      {children}
    </div>
  );
}

/**
 * One row per channel, three verdicts per row.
 *
 * <b>A channel that cannot report shows a dash, never a zero.</b> That is the whole reason the state
 * travels with the number: `—` reads as "we do not know", and `0` reads as "there were none".
 */
function ChannelBreakdown({ rows }: { rows: ChannelMetricRow[] }) {
  if (rows.length === 0) {
    return (
      <Empty
        title="연결된 채널이 없습니다"
        body="채널을 연결하면 이 자리에 채널별 매출·문의·리뷰가 표시됩니다."
        action={<BtnLink to="/connect">채널 연결하기</BtnLink>}
      />
    );
  }
  return (
    <DataTable
      caption="채널별 매출·주문·문의·리뷰와 각 항목의 수집 상태"
      head={
        <>
          <Th>채널</Th>
          <Th numeric>매출</Th>
          <Th numeric>주문</Th>
          <Th numeric>문의 / 미답변</Th>
          <Th numeric>리뷰 / 부정</Th>
          <Th>수집 상태</Th>
        </>
      }
    >
      {rows.map((row) => (
        <tr key={row.channelCode}>
          <Td>
            <span className="font-medium">{row.channelNameKo}</span>
          </Td>
          <Td numeric muted={!row.countedInOrders}>
            {row.countedInOrders ? `${wonShort(row.revenue)}원` : "—"}
          </Td>
          <Td numeric muted={!row.countedInOrders}>
            {row.countedInOrders ? count(row.orders) : "—"}
          </Td>
          <Td numeric muted={!row.countedInInquiries}>
            {row.countedInInquiries ? `${count(row.inquiries)} / ${count(row.unansweredInquiries)}` : "—"}
          </Td>
          <Td numeric muted={!row.countedInReviews}>
            {row.countedInReviews ? `${count(row.reviews)} / ${count(row.negativeReviews)}` : "—"}
          </Td>
          <Td>
            <span className="flex flex-wrap gap-1">
              <DataStateBadge state={row.orderState} label="주문" />
              <DataStateBadge state={row.inquiryState} label="문의" />
              <DataStateBadge state={row.reviewState} label="리뷰" />
            </span>
          </Td>
        </tr>
      ))}
    </DataTable>
  );
}
