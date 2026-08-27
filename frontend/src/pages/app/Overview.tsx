import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PageHead } from "../../components/ui/PageHead";
import { SectionHeader } from "../../components/ui/SectionHeader";
import { Metric, MetricLine, MetricRowOfThree } from "../../components/ui/Metric";
import { TrendChart } from "../../components/ui/TrendChart";
import { DataTable, Td, Th } from "../../components/ui/DataTable";
import { DataStateBadge } from "../../components/ui/DataState";
import { AgentLaunch } from "../../components/ui/AgentLaunch";
import { Empty } from "../../components/ui/Empty";
import { AgentBriefing } from "../../components/home/AgentBriefing";
import { hasAnyConnectedChannel } from "../../lib/firstConnectionState";
import { CommandInput } from "../../components/home/CommandInput";
import { BtnLink } from "../../components/ui/Btn";
import { useApiData } from "../../lib/useApiData";
import { api } from "../../lib/apiClient";
import { count, wonShort } from "../../lib/format";
import { analytics } from "../../lib/analytics";
import type { ChannelMetricRow, MetricKpi, MetricSeries, OverviewResponse } from "../../lib/types";

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
 * <b>Briefing first, numbers second</b> (Agent Command Center v1 §3). The screen used to open with
 * the numbers — three large, three quiet — and leave the seller to work out which of them was a
 * problem. It opens with a sentence now, and with the actual work under it: prepared drafts, what the
 * loop checked ahead of time, and the findings. The numbers did not move or change; they moved DOWN,
 * under a heading that says what they are.
 *
 * <b>The order is 브리핑 → 물어보기 → 준비된 일 → 숫자 → 참고</b> (Chat-first Agent Shell Completion
 * v1 §1). It shipped as 브리핑 → 숫자 → 물어보기, and that order said something the product does not
 * mean: the one control this product is named for sat under a six-figure grid, 900px down, and at
 * 125% a seller never saw it without scrolling. The greeting and the input are now the first screen,
 * together, and the numbers are context underneath the work rather than the way in.
 *
 * <b>The input is small on purpose.</b> A chat-first product is not a product whose home page is a
 * chat window: the briefing above it and the work below it are what the seller came for, and an empty
 * text box the size of the viewport would be a worse version of both.
 *
 * <b>「답변이 필요한 문의」 is back on this screen, on purpose.</b> A previous package dropped it
 * because the same 26 appeared three times at the same weight and read as three problems. It appears
 * twice now and the two are not the same statement: the briefing row is a task with somewhere to go,
 * and the 숫자 card is the size of it. A command center that never mentions the largest thing waiting
 * is not one.
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

  /**
   * Split by what the number is, not by what it measures.
   *
   * WAITING_KEYS is an ORDER as much as a filter — 주문 · 미답변 문의 · 부정 리뷰, the sequence a
   * seller triages in. Anything the backend sends that is not named there falls into the quiet line,
   * so a new KPI appears as context rather than silently claiming the largest type on the screen.
   */
  // The window the SERVER reported, not the button that was pressed — they are the same today and
  // the label must follow the data if that ever stops being true.
  const periodDays = data?.metrics.period.days ?? 0;
  const kpis = (data?.metrics.kpis ?? []).map((kpi) => withPeriodLabel(kpi, periodDays));
  const waiting = WAITING_KEYS.map((key) => kpis.find((kpi) => kpi.key === key)).filter(
    (kpi): kpi is (typeof kpis)[number] => !!kpi,
  );
  const context = kpis.filter((kpi) => !WAITING_KEYS.includes(kpi.key));
  /**
   * The backlog insight is the 현재 미답변 문의 card, in a sentence, two sections lower — same
   * source (`unansweredNow`), same number, and its 「카페24 자사몰 26건이 가장 많습니다」 is the
   * 채널별 table's 현재 미답변 column. A reader who meets 26 three times on one screen counts three
   * problems. It is dropped from THIS screen only; 문의 still carries it as its own header count.
   */
  const insights = data?.insights ?? [];

  /**
   * The one number the command box may state, taken from the KPI the seller is looking at.
   *
   * A second read of "how much is waiting" is a second chance to contradict the card six inches
   * above it, so there is only one — {@code unansweredInquiries}, which since this package counts
   * REAL rows only.
   */
  const unansweredNow =
    kpis.find((kpi) => kpi.key === "unansweredInquiries")?.value ?? null;

  return (
    <div className="space-y-8">
      <PageHead
        title="오늘의 운영"
        description="지금 확인할 일을 먼저 정리해 두었습니다. 숫자와 추이는 그 아래에 있습니다."
        action={<AgentLaunch context={{ surface: "overview" }} />}
      />

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
          {/* ① 브리핑 — the sentence, the one input, then the work the sentence counts. This is the
              first hierarchy (Agent Command Center v1 §3, Chat-first Agent Shell Completion v1 §1):
              a seller who reads one thing on this page reads this, and a seller who does one thing
              on this page can do it without scrolling. */}
          <AgentBriefing
            insights={insights}
            commandSlot={<CommandInput unansweredCount={unansweredNow} />}
          />

          {/* ② 숫자 — context for the briefing, not the entry point. The three waiting numbers keep
              their size because they are still the only ones that mean work, but they no longer open
              the screen: a grid of six is a thing to interpret, and the briefing above already did. */}
          <section className="space-y-3" aria-label="오늘 상태">
            {/* The window control belongs to the numbers it changes. It used to sit in the page
                header — above the briefing — where it was the first filled button on the screen and
                the seller's eye landed on a filter for a section 900px below it. */}
            <SectionHeader
              title="숫자"
              /* WHOSE numbers, when it is not obvious (Chat-first Agent Shell Completion v1 §3).
                 The backend counts the seller's own rows and nothing else; the single case where it
                 cannot — a seeded deployment with no real data at all in the window — arrives with
                 `exampleDataIncluded` and has to say so here. Silence would be the seller reading a
                 revenue figure their shop did not earn. */
              hint={`매출·주문·문의·리뷰는 최근 ${data.metrics.period.days}일 기준입니다.${
                data.metrics.exampleDataIncluded
                  ? " 이 기간에는 실제 데이터가 없어 예시 데이터를 함께 보여드립니다."
                  : ""
              }`}
              action={
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
            <MetricRowOfThree>
              {waiting.map((kpi) => (
                <Metric
                  key={kpi.key}
                  kpi={kpi}
                  size="lg"
                  emphasis={kpi.key === "unansweredInquiries"}
                  onClick={KPI_ROUTE[kpi.key] ? () => navigate(KPI_ROUTE[kpi.key]!) : undefined}
                  beforeFirstConnection={!hasAnyConnectedChannel(data.metrics.channels)}
                />
              ))}
            </MetricRowOfThree>
            <MetricLine kpis={context} />
          </section>

          {/* SUPPORTING — the shape behind each number. */}
          <section className="space-y-4">
            <SectionHeader title="추이" hint={`최근 ${data.metrics.period.days}일, 하루 단위`} />
            <div className="grid gap-4 lg:grid-cols-3">
              <ChartCard title="매출·주문">
                <TrendChart
                  primary={series.get("revenue") ?? EMPTY_SERIES}
                  secondary={series.get("orders")}
                />
              </ChartCard>
              <ChartCard title="문의">
                <TrendChart
                  primary={series.get("inquiries") ?? EMPTY_SERIES}
                  secondary={series.get("unansweredInquiries")}
                />
              </ChartCard>
              <ChartCard title="리뷰">
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
              hint={`매출·주문·문의·리뷰는 최근 ${data.metrics.period.days}일, 「현재 미답변」은 기간과 무관한 지금 수치입니다.`}
            />
            <ChannelBreakdown rows={data.metrics.channels} days={data.metrics.period.days} />
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

/** The three numbers that are work waiting, in the order a seller triages them. */
const WAITING_KEYS: readonly string[] = ["orders", "unansweredInquiries", "negativeReviews"];

/**
 * Say WHICH numbers each number is (Executive Readiness Fix v1).
 *
 * <b>The screen was arithmetically right and read as a contradiction.</b> A reader shown these
 * screens with no explanation said 「미답변 문의 26건 옆에 문의 2건이 있다. 답을 해야 할 게 26개인데
 * 들어온 건 2개라는 게 말이 안 된다」 and 「부정 리뷰 0건이라고 크게 써 놓고 아래에서 3건을 세고 있다」.
 * Both numbers were correct. What the screen never said is that they count different things:
 * `OperationsMetricsService` computes 매출·주문·문의·리뷰·부정 리뷰 over the selected window, and
 * 미답변 문의 through `unansweredNow(...)` — everything still open, with no window at all.
 *
 * <b>The distinction is derived, not listed.</b> The backend already marks it: a point-in-time
 * number has no previous period to compare against, so it arrives with `comparable: false` and
 * `previousValue: null`. Reading the prefix off that means a KPI added later is labelled correctly
 * without anyone remembering to edit a list here.
 *
 * Only the noun is overridden by key, and only where the backend's own word is ambiguous once it
 * sits beside another: 「문의」 next to 「미답변 문의」 reads as the same quantity twice.
 */
const NOUN_OVERRIDE: Record<string, string> = { inquiries: "신규 문의" };

export function withPeriodLabel(kpi: MetricKpi, days: number): MetricKpi {
  const noun = NOUN_OVERRIDE[kpi.key] ?? kpi.label;
  // `days` is 0 only before the first response, when no KPI is rendered anyway.
  const label = kpi.comparable && days > 0 ? `최근 ${days}일 ${noun}` : `현재 ${noun}`;
  return { ...kpi, label };
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
    <DataTable
      caption={`채널별 매출·주문·문의·리뷰(최근 ${days}일)와 현재 미답변 건수, 각 항목의 수집 상태`}
      head={
        <>
          <Th>채널</Th>
          <Th numeric>매출</Th>
          <Th numeric>주문</Th>
          {/* TWO COLUMNS, NOT ONE CELL (Executive Readiness Fix v1). 「문의 / 미답변」 put a window
              count and a point-in-time count on either side of one slash, so 카페24 rendered
              「2 / 26」 — a subset larger than its own set. They are different questions and now
              they are different columns. */}
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
          <Td numeric muted={!row.countedInOrders}>
            {row.countedInOrders ? `${wonShort(row.revenue)}원` : "—"}
          </Td>
          <Td numeric muted={!row.countedInOrders}>
            {row.countedInOrders ? count(row.orders) : "—"}
          </Td>
          <Td numeric muted={!row.countedInInquiries}>
            {row.countedInInquiries ? count(row.inquiries) : "—"}
          </Td>
          <Td numeric muted={!row.countedInInquiries}>
            {row.countedInInquiries ? count(row.unansweredInquiries) : "—"}
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
