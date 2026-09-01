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
import type { InquiryListArtifact, InquiryListArtifact as InquiryList, ListArtifact } from "../../lib/conversation/types";
import type { InquiryRowItem, MetricKpi, OverviewResponse, ProactiveCaseListResponse } from "../../lib/types";

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

  // Working Context v1 §2: the brief NAMES the work. One bounded READ of the seller's own oldest
  // waiting inquiries — the same `/api/inquiries/rows` the conversation's 「최근 문의」 makes, ordered
  // by the one urgency signal this product has. `undefined` = not read yet (say nothing about it),
  // `null` = the read failed (the brief falls back to the count it already has).
  const [oldest, setOldest] = useState<InquiryRowItem[] | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    api
      .getInquiryRowsStrict({ status: "UNANSWERED", order: "OLDEST", limit: BRIEF_ROWS })
      .then((r) => {
        if (live) setOldest(r.items);
      })
      .catch(() => {
        if (live) setOldest(null);
      });
    return () => {
      live = false;
    };
  }, []);

  const data = overview.data;
  const beforeFirstConnection = data ? !hasAnyConnectedChannel(data.metrics.channels) : false;
  // §5: when the brief names the waiting inquiries it also says how many — so the strip stops saying
  // it. Before this the seller read 「현재 미답변 문의 12건」 and 「…문의가 12건 있습니다」 one line apart.
  const strip = data ? contextStrip(data, now, (oldest?.length ?? 0) > 0) : [];
  const anyUnproven = strip.some((kpi) => kpi.freshnessUnproven);
  const count = cases ? cases.items.length : null;

  // §11 (Agent Interaction Model v2): the opener speaks the authenticated org's REAL operational truth
  // — prepared cases when there are any, and the waiting workload (from the same strict overview the
  // numbers line reads) when there are none. 「없습니다」 only when the same reads came back empty.
  const workload = useMemo(() => (data ? workloadPriorities(data) : null), [data]);
  const leadingTurns = useMemo<DisplayTurn[]>(
    () => (cases && !beforeFirstConnection && oldest !== undefined ? [proactiveTurn(cases, workload, oldest)] : []),
    [cases, workload, oldest, beforeFirstConnection],
  );

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
  //
  // <b>The greeting is not the briefing</b> (Agentic Experience v2 §4). 「안녕하세요.」 was the largest
  // text on the page and said the least, with the agent turn under it saying the same thing WITH the
  // work attached — a hello, a numbers line and a brief, three layers before anything actionable. Once
  // there is a brief, the greeting joins the numbers as one quiet line and the brief is the headline.
  // Before the first connection there is no brief and nothing else to say, so the headline stays.
  const briefed = leadingTurns.length > 0 && !beforeFirstConnection;
  const lead = (
    <div className="space-y-2">
      <h1 className="sr-only">오늘의 운영</h1>
      {beforeFirstConnection ? (
        <section className="space-y-1" aria-label="오늘의 브리핑">
          <p className="break-keep text-xl font-bold leading-tight text-ink" aria-live="polite">{DISCONNECTED_HEADLINE}</p>
          <p className="break-keep text-base text-muted">{DISCONNECTED_SUBLINE}</p>
          <div className="pt-3">
            <BtnLink to="/connect">채널 연결하기</BtnLink>
          </div>
        </section>
      ) : !briefed ? (
        <section aria-label="오늘의 브리핑">
          <p className="break-keep text-xl font-bold leading-tight text-ink" aria-live="polite">{greetingLine(now.getHours(), count)}</p>
        </section>
      ) : null}
      {data && !beforeFirstConnection ? (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-muted" aria-label="오늘 상태">
          {briefed ? <span className="font-medium text-ink">{greetingLine(now.getHours(), null)}</span> : null}
          {strip.map((kpi, i) => (
            <span key={kpi.key} className="flex items-center gap-x-2">
              {briefed || i > 0 ? <span aria-hidden="true" className="text-line">·</span> : null}
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

/**
 * Deterministic. `count` null = not yet read (say nothing about it). Zero says only hello — whether
 * anything is WAITING is the opener turn's sentence (§11), computed from the real workload, so the
 * greeting never contradicts it.
 */
export function greetingLine(hour: number, count: number | null): string {
  const hello = hour < 12 ? "좋은 아침입니다." : "안녕하세요.";
  if (count === null || count === 0) return hello;
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
 *
 * `briefNamesInquiries` = the opener turn below is naming the waiting inquiries and their count, so
 * this line drops that one number rather than printing it a second time six inches above (§5). The
 * other two are not in the brief and stay.
 */
export function contextStrip(data: OverviewResponse, now: Date, briefNamesInquiries = false): MetricKpi[] {
  const kpis = data.metrics.kpis;
  const find = (key: string) => kpis.find((k) => k.key === key);
  const out: MetricKpi[] = [];
  const unanswered = find("unansweredInquiries");
  if (unanswered && !briefNamesInquiries) out.push({ ...unanswered, label: "현재 미답변 문의" });
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

/** One waiting-work line for the opener — a real number the strict overview answered, never invented. */
export interface WorkloadPriority {
  label: string;
  count: number;
  to: string;
}

/**
 * The org's waiting work, from the SAME strict overview read as the numbers line (§11): current
 * unanswered inquiries (windowless), then the window's negative reviews. At most three lines; only
 * counts the backend actually answered.
 */
export function workloadPriorities(data: OverviewResponse): WorkloadPriority[] {
  const kpis = data.metrics.kpis;
  const out: WorkloadPriority[] = [];
  const unanswered = kpis.find((k) => k.key === "unansweredInquiries");
  if (unanswered && unanswered.value > 0) out.push({ label: "답변을 기다리는 문의", count: unanswered.value, to: "/inquiries?state=NEEDS_REPLY" });
  const negative = kpis.find((k) => k.key === "negativeReviews");
  if (negative && negative.value > 0) out.push({ label: `최근 ${data.metrics.period.days}일 부정 리뷰`, count: negative.value, to: "/reviews" });
  return out.slice(0, 3);
}

/** How many waiting inquiries the brief names. Three is a brief; ten is the queue with a sentence on top. */
export const BRIEF_ROWS = 3;

/** Whole days a row has been waiting, from dates alone. `null` when the date cannot be read. */
export function waitingDays(receivedAt: string | null | undefined, today = new Date()): number | null {
  if (!receivedAt) return null;
  const from = Date.parse(`${receivedAt.slice(0, 10)}T00:00:00Z`);
  const to = Date.parse(`${today.toISOString().slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return Math.max(0, Math.round((to - from) / 86_400_000));
}

/**
 * The first agent turn: what reviewnary prepared before the seller asked — and, when it prepared
 * nothing, what is genuinely waiting (§11). 「없습니다」 is said only when both reads came back empty.
 * Client-composed, never persisted.
 *
 * <b>Working Context v1 §2 — a brief names things.</b> This turn used to end in a link that said
 * 「답변을 기다리는 문의 12건」 — the third printing of a number the greeting and the context line above
 * it had already given, and the seller still did not know what any of the twelve WERE. A brief that
 * ends in a count is a dashboard row wearing a chat bubble. It now ends in the actual rows, oldest
 * first, each clickable into the conversation: the decision point, not the total.
 *
 * `oldest` is `null` when that read failed — the count line stands in, because a brief that can only
 * say the number is still better than one that invents rows.
 */
export function proactiveTurn(
  cases: ProactiveCaseListResponse,
  workload: WorkloadPriority[] | null,
  oldest: InquiryRowItem[] | null,
): DisplayTurn {
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
  const waiting = workload ?? [];
  const unanswered = waiting.find((w) => w.to.startsWith("/inquiries"))?.count ?? 0;
  const rows = oldest ?? [];
  // The rows the brief names, as the same object every other inquiry list in this product is — so a
  // click here anchors the conversation exactly as a click on an answered list does.
  const waitingRows: InquiryList = {
    artifactId: "home-waiting-rows",
    type: "INQUIRY_LIST",
    title: "가장 오래 기다린 문의",
    totalCount: unanswered,
    groups: [
      {
        key: "UNANSWERED",
        label: "답변 필요",
        items: rows.map((row) => ({
          workItemId: row.workItemId,
          inquiryId: row.inquiryId,
          channelCode: row.channelCode,
          channelNameKo: row.channelNameKo,
          receivedAt: row.receivedAt,
          phase: row.phase ?? "OPEN",
          status: row.status,
          title: row.title,
          snippet: row.snippet,
          productId: row.productId,
          productName: row.productName,
          answerBasis: null,
          // Why this row is above the others. The brief is ordered OLDEST and says so; without the
          // number beside each row 「1개월 전」 is a receipt date, not a reason — the same wait the
          // ranked answer states, computed the same way (whole days, dates, never clock time).
          waitingDays: waitingDays(row.receivedAt),
          to: `/inquiries/${row.inquiryId}`,
        })),
      },
    ],
    ...(unanswered > rows.length ? { more: { label: `문의 ${unanswered.toLocaleString("ko-KR")}건 전체 보기`, to: "/inquiries?state=NEEDS_REPLY" } } : {}),
  };
  // The count read failed or the rows are empty while the count is not — then the brief still has one
  // honest thing to say, and it says it as a line rather than a card.
  const waitingList: ListArtifact = {
    artifactId: "home-waiting",
    type: "LIST",
    title: "지금 기다리는 일",
    items: waiting.map((w) => ({ id: w.to, primary: `${w.label} ${w.count.toLocaleString("ko-KR")}건`, to: w.to })),
  };
  const namedRows = rows.length > 0;
  const message = items.length > 0
    ? "제가 먼저 확인해 둔 일입니다. 확인하고 보내시면 됩니다 — 아직 아무 곳에도 보내지 않았습니다."
    : namedRows
      // The number is said ONCE, and it is said as the reason these particular rows are on top.
      ? `답변을 기다리는 문의가 ${unanswered.toLocaleString("ko-KR")}건 있습니다. 가장 오래 기다린 것부터 보여드릴게요 — 눌러서 바로 이어가시면 됩니다.`
      : waiting.length > 0
        ? "오늘 미리 준비해 둔 일은 없지만, 지금 확인이 필요한 일이 있습니다."
        : "지금 먼저 확인할 일은 없습니다. 새로 들어온 문의나 리뷰가 생기면 여기에 먼저 정리해 두겠습니다.";
  return {
    turnId: "home-proactive",
    conversationId: "local",
    role: "AGENT",
    message,
    artifacts: [
      ...(items.length > 0 ? [list] : []),
      ...(namedRows ? [waitingRows] : waiting.length > 0 ? [waitingList] : []),
    ],
    // A named row IS the next action — a chip re-asking for the same list under it is the same move
    // twice (Conversation UX v2 §D). The chip stands in only when nothing could be named.
    suggestedActions: !namedRows && waiting.some((w) => w.to.startsWith("/inquiries"))
      ? [{ label: "답변 안 한 문의 보여줘", kind: "PROMPT", prompt: "답변 안 한 문의만 보여줘" }]
      : [],
    continuation: { workingSet: null, pendingHumanAction: null, pendingPrepared: null },
    status: "DONE",
    createdAt: new Date(0).toISOString(),
    local: true,
  };
}
