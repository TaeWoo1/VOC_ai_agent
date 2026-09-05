import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Section } from "../../components/ui/Section";
import { Metric, MetricGrid, MetricLine } from "../../components/ui/Metric";
import { TrendChart } from "../../components/ui/TrendChart";
import { DataTable, Td, Th } from "../../components/ui/DataTable";
import { DataStateBadge } from "../../components/ui/DataState";
import { Disclosure } from "../../components/ui/Disclosure";
import { Empty } from "../../components/ui/Empty";
import { hasAnyConnectedChannel } from "../../lib/homeFirstUse";
import { useAgentSurface } from "../../lib/agentPanel";
import { PageHead } from "../../components/ui/PageHead";
import { BtnLink } from "../../components/ui/Btn";
import { useApiData } from "../../lib/useApiData";
import { api } from "../../lib/apiClient";
import { count, wonShort } from "../../lib/format";
import { analytics } from "../../lib/analytics";
import type { ChannelMetricRow, MetricKpi, MetricSeries, OverviewResponse } from "../../lib/types";

/**
 * 운영 숫자 (`/overview`) — the dashboard the home links to as 「자세한 숫자 보기」 (Agentic Operating
 * Workspace v2 §3-C). The home itself is the conversation now; nothing about these numbers moved.
 *
 * <b>Order: 브리핑 → 물어보기 → 먼저 볼 일 → 숫자 → 추이 → 채널별 → 이 숫자에 대하여.</b> The sentence and
 * the command box are the first screen; the work rows are the second; the numbers are context under
 * a heading that says what they are. Nothing about the numbers moved server-side: every figure still
 * comes from `/api/dashboard/overview`, which ships its own definition of 매출, excludes channels that
 * could not report, and names them.
 *
 * <b>No page title paragraph.</b> 「오늘의 운영」 is an `h1` for the outline; the briefing sentence is
 * what a seller reads. The window control belongs to the numbers it changes.
 *
 * <b>One shared freshness line.</b> Three cards each printing 「최신 수집 확인 안 됨」 was three orange
 * sentences for one fact; the row says it once, and the per-card line remains only for the
 * channel-missing caveat, which differs per number.
 */
const RANGES = [7, 14, 30] as const;

export function Overview() {
  const [days, setDays] = useState<number>(7);
  const { data, loading, error } = useApiData<OverviewResponse>(() => api.getOverviewStrict(days), [days]);
  const navigate = useNavigate();
  useAgentSurface({ surface: "overview", label: "운영 숫자" });

  useMemo(() => analytics.track("today_inbox_viewed"), []);

  const series = useMemo(() => {
    const byKey = new Map<string, MetricSeries>();
    for (const s of data?.metrics.series ?? []) byKey.set(s.key, s);
    return byKey;
  }, [data]);

  const periodDays = data?.metrics.period.days ?? 0;
  const kpis = (data?.metrics.kpis ?? []).map((kpi) => withPeriodLabel(kpi, periodDays));
  const waiting = WAITING_KEYS.map((key) => kpis.find((kpi) => kpi.key === key)).filter(
    (kpi): kpi is (typeof kpis)[number] => !!kpi,
  );
  const context = kpis.filter((kpi) => !WAITING_KEYS.includes(kpi.key));
  const anyFreshnessUnproven = waiting.some((kpi) => kpi.freshnessUnproven);
  const beforeFirstConnection = data ? !hasAnyConnectedChannel(data.metrics.channels) : false;

  return (
    <div className="space-y-6">
      <PageHead title="운영 숫자" meta={<span className="text-sm text-muted">홈의 숫자를 기간·추이·채널별로 자세히 봅니다</span>} />

      {loading ? <p className="text-sm text-muted">불러오는 중…</p> : null}

      {!loading && (error || !data) ? (
        <Empty
          title="운영 현황을 불러오지 못했습니다"
          body="집계를 읽는 중 문제가 생겼습니다. 잠시 후 다시 시도해 주세요."
          action={<BtnLink to="/connect">채널 연결 열기</BtnLink>}
        />
      ) : null}

      {data ? (
        <>
          <Section
            title="숫자"
            ariaLabel="오늘 상태"
            hint={
              <>
                {`최근 ${data.metrics.period.days}일 기준`}
                {data.metrics.exampleDataIncluded ? " · 이 기간에는 실제 데이터가 없어 예시 데이터를 보여드립니다" : ""}
                {anyFreshnessUnproven && !beforeFirstConnection ? (
                  <span className="text-warn"> · 일부 채널 최신 수집 확인 필요</span>
                ) : null}
              </>
            }
            action={
              <div className="flex gap-0.5 rounded-lg bg-canvas p-0.5" role="group" aria-label="기간 선택">
                {RANGES.map((range) => (
                  <button
                    key={range}
                    type="button"
                    onClick={() => setDays(range)}
                    aria-pressed={days === range}
                    className={`min-h-[32px] rounded-md px-2.5 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 ${
                      days === range ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"
                    }`}
                  >
                    {range}일
                  </button>
                ))}
              </div>
            }
          >
            <MetricGrid>
              {waiting.map((kpi) => (
                <Metric
                  key={kpi.key}
                  kpi={kpi}
                  emphasis={kpi.key === "unansweredInquiries"}
                  onClick={KPI_ROUTE[kpi.key] ? () => navigate(KPI_ROUTE[kpi.key]!) : undefined}
                  beforeFirstConnection={beforeFirstConnection}
                  showFreshness={false}
                />
              ))}
              {context.find((kpi) => kpi.key === "revenue") ? (
                <Metric
                  kpi={context.find((kpi) => kpi.key === "revenue")!}
                  onClick={() => navigate("/orders")}
                  beforeFirstConnection={beforeFirstConnection}
                  showFreshness={false}
                />
              ) : null}
            </MetricGrid>
            <MetricLine kpis={context.filter((kpi) => kpi.key !== "revenue")} />
          </Section>

          <Section title="추이" hint={`최근 ${data.metrics.period.days}일, 하루 단위 · 점을 누르면 그 날의 주문을 봅니다`}>
            <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              {/* A day on the sales chart is a day the orders screen can show (`?date=`); the inquiry and
                  review lists have no day filter, so those cards link to their screen and their points
                  offer no click (§8-B: no affordance the backend cannot honour). */}
              <ChartCard title="매출 · 주문" to={`/orders?days=${days}`} linkLabel="주문 화면">
                <TrendChart
                  primary={series.get("revenue") ?? EMPTY_SERIES}
                  secondary={series.get("orders")}
                  label="매출과 주문"
                  onSelectDate={(date) => navigate(`/orders?days=${days}&date=${date}`)}
                />
              </ChartCard>
              <div className="grid gap-3">
                <ChartCard title="문의" to="/inquiries" linkLabel="문의 화면" compact>
                  <TrendChart primary={series.get("inquiries") ?? EMPTY_SERIES} secondary={series.get("unansweredInquiries")} label="문의" height={120} />
                </ChartCard>
                <ChartCard title="리뷰" to="/reviews" linkLabel="리뷰 화면" compact>
                  <TrendChart primary={series.get("reviews") ?? EMPTY_SERIES} secondary={series.get("negativeReviews")} label="리뷰" height={120} />
                </ChartCard>
              </div>
            </div>
          </Section>

          <Section title="채널별" hint="「현재 미답변」은 기간과 무관한 지금 수치">
            <ChannelBreakdown rows={data.metrics.channels} days={data.metrics.period.days} />
          </Section>

          <Disclosure label="이 숫자에 대하여">
            <dl className="mt-2 space-y-1.5 text-sm text-muted">
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
          </Disclosure>
        </>
      ) : null}
    </div>
  );
}

/** The three numbers that are work waiting, in the order a seller triages them. */
const WAITING_KEYS: readonly string[] = ["orders", "unansweredInquiries", "negativeReviews"];

/**
 * Say WHICH numbers each number is (Executive Readiness Fix v1). A point-in-time number arrives with
 * `comparable: false`, so the prefix is derived, never listed.
 */
const NOUN_OVERRIDE: Record<string, string> = { inquiries: "신규 문의" };

export function withPeriodLabel(kpi: MetricKpi, days: number): MetricKpi {
  const noun = NOUN_OVERRIDE[kpi.key] ?? kpi.label;
  const label = kpi.comparable && days > 0 ? `최근 ${days}일 ${noun}` : `현재 ${noun}`;
  return { ...kpi, label };
}

const KPI_ROUTE: Record<string, string | undefined> = {
  revenue: "/orders",
  orders: "/orders",
  inquiries: "/inquiries",
  unansweredInquiries: "/inquiries",
  reviews: "/reviews",
  negativeReviews: "/reviews",
};

const DATA_TYPE_KO: Record<string, string> = { ORDER_SUMMARY: "주문", INQUIRY: "문의", REVIEW: "리뷰" };

const EMPTY_SERIES: MetricSeries = { key: "none", label: "", unit: "건", points: [] };

function ChartCard({ title, to, linkLabel, children, compact = false }: { title: string; to: string; linkLabel: string; children: React.ReactNode; compact?: boolean }) {
  return (
    <div className={`rounded-2xl border border-line bg-surface ${compact ? "p-3" : "p-4"}`}>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        <Link to={to} className="text-xs font-semibold text-brand-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700">
          {linkLabel}
        </Link>
      </div>
      {children}
    </div>
  );
}

/** One row per channel, three verdicts per row. A channel that cannot report shows a dash, never a zero. */
function ChannelBreakdown({ rows, days }: { rows: ChannelMetricRow[]; days: number }) {
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
    <div className="rounded-2xl border border-line bg-surface px-4 py-1">
      <DataTable
        caption={`채널별 매출·주문·문의·리뷰(최근 ${days}일)와 현재 미답변 건수, 각 항목의 수집 상태`}
        head={
          <>
            <Th>채널</Th>
            <Th numeric>매출</Th>
            <Th numeric>주문</Th>
            <Th numeric>문의</Th>
            <Th numeric>현재 미답변</Th>
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
            <Td numeric muted={!row.countedInOrders}>{row.countedInOrders ? `${wonShort(row.revenue)}원` : "—"}</Td>
            <Td numeric muted={!row.countedInOrders}>{row.countedInOrders ? count(row.orders) : "—"}</Td>
            <Td numeric muted={!row.countedInInquiries}>{row.countedInInquiries ? count(row.inquiries) : "—"}</Td>
            {/* Its own verdict, because it is the one column on this row that is not a window figure
                (the section hint above says so). Reading the window's verdict here printed 「—」 for a
                channel whose standing backlog this response was carrying. */}
            <Td numeric muted={!row.countedInUnansweredNow}>{row.countedInUnansweredNow ? count(row.unansweredInquiries) : "—"}</Td>
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
    </div>
  );
}
