import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Metric, MetricRowOfThree } from "../../components/ui/Metric";
import { Btn, BtnLink } from "../../components/ui/Btn";
import { ListBox } from "../../components/ui/Section";
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
import { relativeTime } from "../../lib/format";
import { matchCommandIntent, INTENT_HEADING } from "../../lib/commandIntents";
import type { ConversationSummary, InquiryListArtifact, ListArtifact } from "../../lib/conversation/types";
import type { MetricKpi, OverviewResponse, ProactiveCaseListResponse } from "../../lib/types";

/**
 * 홈 — the Agent operating workspace (Agentic Operating Workspace v2 §3-C).
 *
 * <b>Top to bottom:</b> a greeting that is arithmetic (hour + the count of prepared cases — no model
 * writes it), three compact numbers with one shared freshness line, then the conversation whose FIRST
 * agent turn is client-composed from 「AI가 먼저 확인한 일」 — a truthful zero when there is nothing —
 * and the composer, sticky at the bottom, with example prompts as chips. The old dashboard is one
 * link away at `/overview`; none of its numbers moved.
 *
 * <b>The palette is a shortcut, not a planner.</b> A typed sentence that is exactly one of three
 * labels answers locally with an object the page already has; every other sentence goes to the
 * runtime, where the planner plans it or the turn fails.
 */
export function AgentHome({ now = new Date() }: { now?: Date }) {
  useAgentSurface({ surface: "home", label: "오늘의 운영" });
  const navigate = useNavigate();
  const conversation = useConversation();
  const overview = useApiData<OverviewResponse>(() => api.getOverviewStrict(7), []);
  const [cases, setCases] = useState<ProactiveCaseListResponse | null | undefined>(undefined);
  const [history, setHistory] = useState<ConversationSummary[] | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

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
        window.scrollTo?.({ top: 0, behavior: "smooth" });
        conversation.addLocalTurn(text, { message: "오늘 확인할 일은 이 화면 맨 위에 정리해 두었습니다.", artifacts: [] });
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

  async function toggleHistory() {
    if (historyOpen) {
      setHistoryOpen(false);
      return;
    }
    setHistoryOpen(true);
    if (!conversation) return;
    try {
      setHistory(await conversation.loadHistory(10));
    } catch {
      setHistory([]);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="sr-only">오늘의 운영</h1>

      <section className="space-y-1" aria-label="오늘의 브리핑">
        <p className="break-keep text-2xl font-bold leading-tight text-ink" aria-live="polite">
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
        <section className="space-y-2" aria-label="오늘 상태">
          <MetricRowOfThree>
            {strip.map((kpi) => (
              <Metric key={kpi.key} kpi={kpi} onClick={() => navigate(STRIP_ROUTE[kpi.key] ?? "/overview")} showFreshness={false} />
            ))}
          </MetricRowOfThree>
          <p className="flex flex-wrap items-center gap-x-3 text-sm text-muted">
            {anyUnproven ? <span className="text-warn">일부 채널 최신 수집 확인 필요</span> : null}
            <Link to="/overview" className="font-semibold text-brand-700 hover:underline">자세한 숫자 보기</Link>
          </p>
        </section>
      ) : overview.error ? (
        <p className="text-sm text-muted">
          운영 숫자를 읽지 못했습니다. <Link to="/overview" className="font-semibold text-brand-700 hover:underline">자세한 숫자 보기</Link>
        </p>
      ) : null}

      <ConversationWorkspace
        surface="home"
        leadingTurns={leadingTurns}
        chips={HOME_PROMPTS}
        placeholder="무엇이든 물어보세요"
        onBeforeSend={onBeforeSend}
        composerClassName="sticky bottom-[64px] z-10 -mx-4 bg-canvas/95 px-4 py-3 backdrop-blur md:bottom-0 md:mx-0 md:px-0"
        footer={
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Btn type="button" variant="ghost" size="sm" onClick={() => conversation?.newConversation()}>새 대화</Btn>
              <Btn type="button" variant="ghost" size="sm" onClick={() => void toggleHistory()} aria-expanded={historyOpen}>지난 대화</Btn>
            </div>
            {historyOpen ? (
              <ListBox ariaLabel="지난 대화">
                {history === null ? (
                  <p className="px-4 py-3 text-sm text-muted">불러오는 중…</p>
                ) : history.length === 0 ? (
                  <p className="px-4 py-3 text-sm text-muted">지난 대화가 없습니다.</p>
                ) : (
                  <ul className="divide-y divide-line/70">
                    {history.map((h) => (
                      <li key={h.conversationId}>
                        <button
                          type="button"
                          onClick={() => {
                            void conversation?.openConversation(h.conversationId);
                            setHistoryOpen(false);
                          }}
                          className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-canvas focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-700"
                        >
                          <span className="min-w-0 flex-1 truncate text-base text-ink">{h.headline ?? "제목 없는 대화"}</span>
                          <span className="shrink-0 text-sm tabular-nums text-muted">{h.turnCount}턴 · {relativeTime(h.updatedAt)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </ListBox>
            ) : null}
          </div>
        }
      />
    </div>
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
