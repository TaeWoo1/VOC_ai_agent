import { Link } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import { DashboardGrid } from "../components/DashboardGrid";
import { StatCard } from "../components/StatCard";
import { Section } from "../components/Section";
import { ShareBars, TrendBars } from "../components/Charts";
import { HomeReviewOpsCard } from "../components/actionWindow/HomeReviewOpsCard";
import { useOperationsStore } from "../hooks/useOperationsStore";
import { isFixturePreviewEnabled } from "../lib/actionWindow/devMode";
import { useApiData } from "../lib/useApiData";
import { api } from "../lib/apiClient";
import { count, wonShort } from "../lib/format";
import { buildHomeOperatingItems, todayOrders, todaySales } from "../lib/homeActions";

/** Home is the online-seller operating cockpit. It shows ONLY real order/sales
 *  data (strict read, fail-closed) plus order-derived operating items, and an
 *  honest review-operations activity strip. Inquiry/review/product COUNTS are
 *  intentionally absent — they have no live source in the current MVP, so seeded
 *  values must not be presented here as live. */
export function Home() {
  const { data, loading, error } = useApiData(() => api.getOrdersSummaryStrict());
  const ordersReady = !loading && !error && !!data;

  // Honesty gate for the agent-activity strip: the operations store seeds a demo
  // run even in production, so we surface it on this real-data cockpit ONLY when a
  // live agent is driving it (sourceMode === "bridge") or in the DEV fixture
  // preview. Otherwise the strip degrades to its calm empty state — a seeded/mock
  // run is never shown as a live review job.
  const ops = useOperationsStore();
  const liveRun =
    ops.sourceMode === "bridge" || isFixturePreviewEnabled() ? ops.run : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="오늘의 운영 현황"
        description={ordersReady ? "네이버 주문·매출이 연결되어 있습니다." : undefined}
      />

      <HomeReviewOpsCard run={liveRun} />

      {loading ? (
        <p className="text-muted">불러오는 중…</p>
      ) : error || !data ? (
        <div className="rounded-xl bg-bad/10 px-4 py-3 text-bad">
          운영 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
        </div>
      ) : (
        <>
          <DashboardGrid columns={2}>
            <StatCard label="오늘 주문" value={count(todayOrders(data))} unit="건" />
            <StatCard label="오늘 매출" value={wonShort(todaySales(data))} unit="원" />
          </DashboardGrid>

          <Section title="확인 필요한 운영 항목">
            <ul className="space-y-3">
              {buildHomeOperatingItems(data).map((item) => (
                <li
                  key={item.id}
                  className="flex items-center justify-between gap-3 rounded-xl bg-canvas px-4 py-3"
                >
                  <span className="text-lg">{item.text}</span>
                  {item.to && item.actionLabel ? (
                    <Link to={item.to} className="btn-ghost shrink-0">
                      {item.actionLabel} →
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
          </Section>

          <Section title="최근 7일 주문·매출 추이">
            <TrendBars points={data.trend} />
          </Section>

          <Section title="최근 7일 매출 발생 채널">
            <ShareBars items={data.channelShare} />
          </Section>

          <div className="flex flex-wrap gap-3">
            <Link to="/orders" className="btn-primary">
              주문·매출 자세히 보기 →
            </Link>
            <Link to="/settings/channels" className="btn-ghost">
              다른 판매 채널 연결/관리 →
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
