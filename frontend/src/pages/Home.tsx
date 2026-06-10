import { StatCard } from "../components/StatCard";
import { Section } from "../components/Section";
import { StatusBadge } from "../components/StatusBadge";
import { EmptyState } from "../components/EmptyState";
import { ShareBars, TrendBars } from "../components/Charts";
import { useApiData } from "../lib/useApiData";
import { api } from "../lib/apiClient";
import { count, relativeTime, wonShort } from "../lib/format";
import type { ChannelResponse, FeedItem, TopProductIssue } from "../lib/types";

export function Home() {
  const { data: summary } = useApiData(() => api.getDashboardSummary());
  const { data: channels } = useApiData(() => api.getChannelStatus());

  if (!summary) {
    return <p className="text-muted">불러오는 중…</p>;
  }

  const c = summary.cards;
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">오늘의 운영 현황</h1>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="오늘 주문" value={count(c.todayOrders)} unit="건" />
        <StatCard label="오늘 매출" value={wonShort(c.todaySales)} unit="원" />
        <StatCard label="신규 문의" value={count(c.newInquiries)} unit="건" />
        <StatCard label="미답변 문의" value={count(c.unansweredInquiries)} unit="건" tone="warn" />
        <StatCard label="신규 리뷰" value={count(c.newReviews)} unit="건" />
        <StatCard label="부정 리뷰" value={count(c.negativeReviews)} unit="건" tone="bad" />
        <StatCard label="긴급 확인" value={count(c.urgentCount)} unit="건" tone="bad" />
        <StatCard label="미처리 건" value={count(c.unhandledCount)} unit="건" tone="warn" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Section title="오늘 확인할 일">
          <ul className="space-y-3">
            {summary.todoItems.map((t, i) => (
              <li key={i} className="flex items-center gap-3 rounded-xl bg-canvas px-4 py-3 text-lg">
                <span className="text-brand">✓</span>
                {t}
              </li>
            ))}
          </ul>
        </Section>

        <Section title="채널별 현황">
          <ChannelStatusGrid channels={channels ?? []} />
        </Section>
      </div>

      <Section title="최근 문의 / 리뷰">
        <FeedList items={summary.recentFeed} />
      </Section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Section title="상품별 이슈 TOP">
          <TopIssues items={summary.topProductIssues} />
        </Section>
        <Section title="채널별 매출 비중">
          <ShareBars items={summary.channelSalesShare} />
        </Section>
      </div>

      <Section title="최근 7일 주문 / 매출 추이">
        <TrendBars points={summary.salesTrend} />
      </Section>
    </div>
  );
}

function ChannelStatusGrid({ channels }: { channels: ChannelResponse[] }) {
  if (channels.length === 0) {
    return <EmptyState message="연결된 채널이 없습니다." />;
  }
  return (
    <div className="grid grid-cols-2 gap-3">
      {channels.slice(0, 6).map((ch) => (
        <div key={ch.id} className="flex items-center justify-between rounded-xl bg-canvas px-4 py-3">
          <span className="font-semibold">{ch.nameKo}</span>
          <StatusBadge status={ch.status} />
        </div>
      ))}
    </div>
  );
}

export function FeedList({ items }: { items: FeedItem[] }) {
  if (items.length === 0) {
    return <EmptyState message="표시할 문의나 리뷰가 없습니다." />;
  }
  return (
    <ul className="divide-y divide-line">
      {items.map((it, i) => (
        <li key={i} className="flex items-start gap-3 py-3">
          <span
            className={`mt-1 rounded-lg px-2 py-0.5 text-sm font-semibold ${
              it.type === "INQUIRY" ? "bg-brand/10 text-brand-700" : "bg-ink/5 text-ink"
            }`}
          >
            {it.type === "INQUIRY" ? "문의" : "리뷰"}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-sm text-muted">
              <span>{it.channelNameKo}</span>
              <span>·</span>
              <span className="truncate">{it.productName}</span>
              {it.status === "NEGATIVE" ? (
                <span className="rounded bg-bad/10 px-1.5 text-bad">부정</span>
              ) : null}
              {it.status === "UNANSWERED" ? (
                <span className="rounded bg-warn/10 px-1.5 text-warn">미답변</span>
              ) : null}
            </div>
            <p className="truncate text-lg">{it.snippet}</p>
          </div>
          <span className="shrink-0 text-sm text-muted">{relativeTime(it.receivedAt)}</span>
        </li>
      ))}
    </ul>
  );
}

function TopIssues({ items }: { items: TopProductIssue[] }) {
  if (items.length === 0) {
    return <EmptyState message="반복 이슈가 아직 없습니다." />;
  }
  return (
    <ul className="space-y-3">
      {items.map((it, i) => (
        <li key={i} className="flex items-center justify-between rounded-xl bg-canvas px-4 py-3">
          <span className="truncate font-semibold">{it.productName}</span>
          <span className="shrink-0 text-base text-muted">
            {it.issueLabel} <span className="font-bold text-bad">{it.count}</span>건
          </span>
        </li>
      ))}
    </ul>
  );
}

