import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { BtnLink } from "../../components/ui/Btn";
import { ConversationWorkspace } from "../../components/conversation/ConversationWorkspace";
import { HOME_PROMPTS } from "../../components/conversation/surfacePrompts";
import { useConversation, type DisplayTurn } from "../../lib/conversation/ConversationProvider";
import { useAgentSurface } from "../../lib/agentPanel";
import { useApiData } from "../../lib/useApiData";
import { api } from "../../lib/apiClient";
import { analytics } from "../../lib/analytics";
import { hasAnyConnectedChannel } from "../../lib/firstConnectionState";
import { DISCONNECTED_HEADLINE, DISCONNECTED_SUBLINE } from "../../lib/briefing";
import { caseTarget, preparedBadge } from "../../lib/proactive";
import { previewText } from "../../lib/plainText";
import { matchCommandIntent, INTENT_HEADING } from "../../lib/commandIntents";
import type { InquiryListArtifact, ListArtifact } from "../../lib/conversation/types";
import type { MetricKpi, OverviewResponse, ProactiveCaseListResponse } from "../../lib/types";

/**
 * 홈 — the Agent operating workspace (Agentic Operating Workspace v2 §3-C).
 *
 * <b>Conversation-first (Chat UI v1).</b> The thread is the page: it owns the scroll, the composer is
 * docked at the bottom of the viewport, threads live in the sidebar. An EMPTY thread opens with a
 * greeting that is arithmetic (hour + the count of prepared cases — no model writes it), ONE muted
 * context line with the three numbers (secondary, never a strip of cards), the first agent turn
 * client-composed from 「AI가 먼저 확인한 일」 — a truthful zero when there is nothing — and example
 * prompts under the box. After the first message the thread speaks for itself. The old dashboard is
 * one link away at `/overview`; none of its numbers moved.
 *
 * <b>The palette is a shortcut, not a planner.</b> A typed sentence that is exactly one of three
 * labels answers locally with an object the page already has; every other sentence goes to the
 * runtime, where the planner plans it or the turn fails.
 */
export function AgentHome({ now = new Date() }: { now?: Date }) {
  useAgentSurface({ surface: "home", label: "오늘의 운영" });
  const conversation = useConversation();
  const overview = useApiData<OverviewResponse>(() => api.getOverviewStrict(7), []);
  const [cases, setCases] = useState<ProactiveCaseListResponse | null | undefined>(undefined);

  useMemo(() => analytics.track("today_inbox_viewed"), []);

  useEffect(() => {
    let live = true;
    api
      .getProactiveCases(5)
      .then((r) => {
        if (live) setCases(r);
      })
      .catch(() => {
        if (live) setCases(null);
      });
    return () => {
      live = false;
    };
  }, []);

  const data = overview.data;
  const beforeFirstConnection = data ? !hasAnyConnectedChannel(data.metrics.channels) : false;
  const strip = data ? contextStrip(data, now) : [];
  const anyUnproven = strip.some((kpi) => kpi.freshnessUnproven);
  const count = cases ? cases.items.length : null;

  const leadingTurns = useMemo<DisplayTurn[]>(() => (cases ? [proactiveTurn(cases)] : []), [cases]);

  const onBeforeSend = useCallback(
    (text: string): boolean => {
      if (!conversation) return false;
      const key = matchCommandIntent(text);
      if (!key) return false;
      if (key === "TODAY") {
        conversation.addLocalTurn(text, { message: "오늘 확인할 일은 이 대화 맨 위에 정리해 두었습니다.", artifacts: [] });
        return true;
      }
      if (key === "UNANSWERED_INQUIRIES") {
        const total = data?.metrics.kpis.find((k) => k.key === "unansweredInquiries")?.value ?? null;
        void api
          .getInquiryQueueStrict({ phase: "OPEN", page: 0, size: 5 })
          .then((page) => {
            const artifact: InquiryListArtifact = {
              artifactId: "local-inquiries",
              type: "INQUIRY_LIST",
              title: total != null ? `${INTENT_HEADING.UNANSWERED_INQUIRIES} ${total}건` : INTENT_HEADING.UNANSWERED_INQUIRIES,
              totalCount: total ?? page.totalElements,
              groups: [
                {
                  key: "UNANSWERED",
                  label: "답변 필요",
                  items: page.content.map((item) => ({
                    workItemId: item.workItemId,
                    inquiryId: item.inquiryId,
                    channelCode: item.channelCode,
                    channelNameKo: item.channelNameKo,
                    receivedAt: item.receivedAt,
                    phase: item.phase,
                    status: item.status,
                    title: item.title,
                    productId: item.productId,
                    productName: item.productName,
                    answerBasis: null,
                    to: `/inquiries/${item.inquiryId}`,
                  })),
                },
              ],
              more: { label: "문의 화면에서 전체 보기", to: "/inquiries" },
            };
            conversation.addLocalTurn(text, { message: "바로 보여드립니다.", artifacts: [artifact] });
          })
          .catch(() => conversation.addLocalTurn(text, { message: "문의를 읽지 못했습니다. 문의 화면에서 확인해 주세요.", artifacts: [] }));
        return true;
      }
      return false;
    },
    [conversation, data],
  );

  // What an EMPTY thread opens with: the greeting (arithmetic, never a model) and — as a secondary,
  // single muted line — the three numbers the old strip carried. The transcript is the surface; the
  // numbers are context, one press from `/overview` where nothing moved.
  const lead = (
    <div className="space-y-2">
      <h1 className="sr-only">오늘의 운영</h1>
      <section className="space-y-1" aria-label="오늘의 브리핑">
        <p className="break-keep text-xl font-bold leading-tight text-ink" aria-live="polite">
          {beforeFirstConnection ? DISCONNECTED_HEADLINE : greetingLine(now.getHours(), count)}
        </p>
        {beforeFirstConnection ? (
          <>
            <p className="break-keep text-base text-muted">{DISCONNECTED_SUBLINE}</p>
            <div className="pt-3">
              <BtnLink to="/connect">채널 연결하기</BtnLink>
            </div>
          </>
        ) : null}
      </section>
      {data && !beforeFirstConnection ? (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-muted" aria-label="오늘 상태">
          {strip.map((kpi, i) => (
            <span key={kpi.key} className="flex items-center gap-x-2">
              {i > 0 ? <span aria-hidden="true" className="text-line">·</span> : null}
              <Link to={STRIP_ROUTE[kpi.key] ?? "/overview"} className="hover:text-ink hover:underline">
                {kpi.label} <span className="font-semibold tabular-nums text-ink">{kpi.value.toLocaleString("ko-KR")}</span>{kpi.unit ?? "건"}
              </Link>
            </span>
          ))}
          {anyUnproven ? <span className="text-warn">· 일부 채널 최신 수집 확인 필요</span> : null}
          <Link to="/overview" className="font-semibold text-brand-700 hover:underline">자세한 숫자 보기</Link>
        </p>
      ) : overview.error ? (
        <p className="text-sm text-muted">
          운영 숫자를 읽지 못했습니다. <Link to="/overview" className="font-semibold text-brand-700 hover:underline">자세한 숫자 보기</Link>
        </p>
      ) : null}
    </div>
  );

  return (
    <ConversationWorkspace
      surface="home"
      leadingTurns={leadingTurns}
      lead={lead}
      chips={HOME_PROMPTS}
      placeholder="무엇이든 물어보세요"
      onBeforeSend={onBeforeSend}
    />
  );
}

/** Deterministic. `count` null = not yet read (say nothing about it); 0 = truthful zero. */
export function greetingLine(hour: number, count: number | null): string {
  const hello = hour < 12 ? "좋은 아침입니다." : "안녕하세요.";
  if (count === null) return hello;
  if (count === 0) return `${hello} 오늘 먼저 확인한 일은 없습니다.`;
  return `${hello} 오늘 제가 먼저 확인한 일이 ${count}개 있습니다.`;
}

const STRIP_ROUTE: Record<string, string> = {
  unansweredInquiries: "/inquiries",
  ordersToday: "/orders",
  orders: "/orders",
  negativeReviews: "/reviews",
};

/**
 * Three numbers from the one overview read. 「오늘 주문」 is the series' last point only when that
 * point IS today; otherwise the 7-day KPI under its own honest label.
 */
export function contextStrip(data: OverviewResponse, now: Date): MetricKpi[] {
  const kpis = data.metrics.kpis;
  const find = (key: string) => kpis.find((k) => k.key === key);
  const out: MetricKpi[] = [];
  const unanswered = find("unansweredInquiries");
  if (unanswered) out.push({ ...unanswered, label: "현재 미답변 문의" });
  const orders = find("orders");
  const series = data.metrics.series.find((s) => s.key === "orders");
  const last = series?.points[series.points.length - 1];
  const today = now.toISOString().slice(0, 10);
  if (last && last.date === today) {
    out.push({
      key: "ordersToday",
      label: "오늘 주문",
      value: last.value,
      unit: "건",
      previousValue: null,
      deltaPercent: null,
      comparable: false,
      excludedChannels: orders?.excludedChannels ?? 0,
      freshnessUnproven: orders?.freshnessUnproven ?? false,
    });
  } else if (orders) {
    out.push({ ...orders, label: `최근 ${data.metrics.period.days}일 주문` });
  }
  const negative = find("negativeReviews");
  if (negative) out.push({ ...negative, label: `최근 ${data.metrics.period.days}일 부정 리뷰` });
  return out;
}

/** The first agent turn: what reviewnary prepared before the seller asked. Client-composed, never persisted. */
export function proactiveTurn(cases: ProactiveCaseListResponse): DisplayTurn {
  const items = cases.items;
  const list: ListArtifact = {
    artifactId: "home-proactive",
    type: "LIST",
    title: "AI가 먼저 확인한 일",
    items: items.map((view) => {
      const badge = preparedBadge(view);
      return {
        id: view.id,
        primary: previewText(view.snippet),
        secondary: [view.channelNameKo, view.subjectKind === "INQUIRY" ? "문의" : "리뷰", view.rating != null ? `${view.rating}점` : null]
          .filter(Boolean)
          .join(" · "),
        status: { label: badge.label, tone: badge.tone === "accent" ? "info" : "warn" },
        to: caseTarget(view),
      };
    }),
    totalCount: cases.total,
    ...(cases.total > items.length ? { more: { label: `전체 ${cases.total}건 보기`, to: "/inquiries" } } : {}),
  };
  return {
    turnId: "home-proactive",
    conversationId: "local",
    role: "AGENT",
    message: items.length > 0 ? "제가 먼저 확인해 둔 일입니다. 확인하고 보내시면 됩니다 — 아직 아무 곳에도 보내지 않았습니다." : "오늘 먼저 확인한 일은 없습니다. 새로 들어온 문의나 리뷰가 생기면 여기에 먼저 정리해 두겠습니다.",
    artifacts: items.length > 0 ? [list] : [],
    suggestedActions: [],
    continuation: { workingSet: null, pendingHumanAction: null, pendingPrepared: null },
    status: "DONE",
    createdAt: new Date(0).toISOString(),
    local: true,
  };
}
