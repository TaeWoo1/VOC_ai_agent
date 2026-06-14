import { StatCard } from "../components/StatCard";
import { Section } from "../components/Section";
import { ShareBars, TrendBars } from "../components/Charts";
import { useApiData } from "../lib/useApiData";
import { api } from "../lib/apiClient";
import { count, wonShort } from "../lib/format";

export function Orders() {
  const { data, loading, error } = useApiData(() => api.getOrdersSummaryStrict());
  if (loading) {
    return <p className="text-muted">불러오는 중…</p>;
  }
  if (error || !data) {
    return (
      <div className="rounded-xl bg-bad/10 px-4 py-3 text-bad">
        주문·매출 데이터를 불러오지 못했습니다. 백엔드가 실행 중인지 확인해 주세요.
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">주문 · 매출</h1>

      <div className="grid grid-cols-2 gap-4">
        <StatCard label="최근 7일 주문" value={count(data.totalOrders7d)} unit="건" />
        <StatCard label="최근 7일 매출" value={wonShort(data.totalSales7d)} unit="원" />
      </div>

      <Section title="최근 7일 주문 / 매출 추이">
        <TrendBars points={data.trend} />
      </Section>

      <Section title="채널별 매출 비중">
        <ShareBars items={data.channelShare} />
      </Section>
    </div>
  );
}
