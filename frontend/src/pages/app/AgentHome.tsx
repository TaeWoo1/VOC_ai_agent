import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { BtnLink } from "../../components/ui/Btn";
import { Dot } from "../../components/ui/ObjectRow";
import { ConversationWorkspace } from "../../components/conversation/ConversationWorkspace";
import { FIRST_USE_PROMPTS, HOME_PROMPTS } from "../../components/conversation/surfacePrompts";
import { useConversation, type DisplayTurn } from "../../lib/conversation/ConversationProvider";
import { useAgentSurface } from "../../lib/agentPanel";
import { useApiData } from "../../lib/useApiData";
import { api } from "../../lib/apiClient";
import { analytics } from "../../lib/analytics";
import { DISCONNECTED_HEADLINE } from "../../lib/briefing";
import { delegableSentence, firstUseSteps, homeFirstUseState, noDataSentence } from "../../lib/homeFirstUse";
import { caseTarget, preparedBadge } from "../../lib/proactive";
import { previewText } from "../../lib/plainText";
import { matchCommandIntent, INTENT_HEADING } from "../../lib/commandIntents";
import { INQUIRY_NEEDS_REPLY_PATH } from "../../lib/todayInbox";
import { OperationsAreas } from "../../components/home/OperationsAreas";
import { CustomerOpsHome, TodayWorkspace, coHomeApplies } from "../../components/customerOperations/CustomerOpsHome";
import { COPY } from "../../lib/copy/customerOps";
import type { CustomerOperationsHome } from "../../lib/customerOperationsTypes";
import { hasAnythingToShow } from "../../lib/operationsHome";
import type { InquiryListArtifact, InquiryListArtifact as InquiryList, ListArtifact } from "../../lib/conversation/types";
import type { InquiryQueueResponse, MetricKpi, OperationsHome, OverviewResponse, ProactiveCaseListResponse, ReviewIssueView } from "../../lib/types";

/**
 * 홈 — the Agent operating workspace (Agentic Operating Workspace v2 §3-C).
 *
 * <b>Work-first, chat as a command bar (Home v3, 2026-09-23).</b> This docblock used to say 「the thread
 * is the page」 and had been wrong for some time: for an org with 고객 운영 관리 open, Home is
 * {@link TodayWorkspace} — the 확인할 일 list with the selected item beside it — and the conversation is a
 * one-line dock under the list. The design contract said the same stale thing and was corrected with this
 * (`docs/reviewnary_design.md` §8-A v3.2).
 *
 * <p>What the screen answers is unchanged — 「오늘 무엇을 해야 하지?」 — and the answer is the LIST. The top
 * carries only obligations (확인할 일 · 실행 대기); 반복 문제 keeps its own section below the work because it
 * is a pattern, not a customer waiting; KPI, trend and per-channel numbers stay at `/overview` and are not
 * copied here. Nothing is chosen until the seller chooses it, and what they chose can be closed.
 *
 * <p>For an org WITHOUT that job, this page is still the thread: an EMPTY thread opens with a greeting that
 * is arithmetic (hour + the count of prepared cases — no model writes it), ONE muted context line with the
 * three numbers, the first agent turn client-composed from 「AI가 먼저 확인한 일」 — a truthful zero when
 * there is nothing — and example prompts under the box.
 *
 * <b>The palette is a shortcut, not a planner.</b> A typed sentence that is exactly one of three
 * labels answers locally with an object the page already has; every other sentence goes to the
 * runtime, where the planner plans it or the turn fails.
 */
export function AgentHome({ now = new Date() }: { now?: Date }) {
  useAgentSurface({ surface: "home", label: "오늘의 운영" });
  const conversation = useConversation();
  const overview = useApiData<OverviewResponse>(() => api.getOverviewStrict(7), []);
  /**
   * Operations Home's own read — the four areas above the thread.
   *
   * <b>Fail-soft, and that is the whole failure design.</b> When this read does not land the areas are
   * simply not drawn and the conversation below is untouched: a Home that rendered 「확인 필요 0건」
   * because a query timed out would be telling a seller their morning is clear on the strength of a
   * failure. The overview strip and the proactive turn are separate reads and keep working.
   */
  const [home, setHome] = useState<OperationsHome | null | undefined>(undefined);
  const [cases, setCases] = useState<ProactiveCaseListResponse | null | undefined>(undefined);

  useMemo(() => analytics.track("today_inbox_viewed"), []);

  /**
   * The pilot's one return-visit signal (Pilot Launch Readiness §2) — 「이 조직이 오늘 홈을 열었다」.
   *
   * Deliberately NOT routed through `analytics` above: that module is for vendor sinks, is a no-op
   * without vendor env, and is gated on 분석 consent. This one leaves no deployment, names no person,
   * and is recorded once per organisation per Asia/Seoul day by the server. Fire and forget — nothing
   * awaits it, nothing renders from it, and a failure is silence.
   */
  useEffect(() => {
    void api.recordHomeOpened().catch(() => {});
  }, []);

  useEffect(() => {
    let live = true;
    api
      .getOperationsHomeStrict()
      .then((r) => {
        if (live) setHome(r);
      })
      .catch(() => {
        if (live) setHome(null);
      });
    return () => {
      live = false;
    };
  }, []);

  /**
   * A repeated problem changed state in the 오늘 pane (UI/UX v2 Phase 2). The server's answer is the new truth, so
   * the row in the list is replaced with it at once — no stale lifecycle word beside a pane that says otherwise —
   * and the Home read runs again for the counts only it can recompute. A failed re-read keeps what is on screen.
   */
  const onProblemChanged = useCallback((next: ReviewIssueView) => {
    setHome((current) =>
      current
        ? {
            ...current,
            problems: {
              ...current.problems,
              rows: current.problems.rows.map((row) => (row.issue.id === next.id ? { ...row, issue: next } : row)),
            },
          }
        : current,
    );
    void api
      .getOperationsHomeStrict()
      .then((r) => setHome(r))
      .catch(() => undefined);
  }, []);

  /**
   * 고객 운영 관리's own read (Customer Operations v3.1). When the job is open for this org the Home IS its
   * 「자동 확인 → 내 확인 필요」 and one 「확인 필요」 list; otherwise the Home stays what it was. `undefined` = not
   * read yet — nothing is drawn in its place, so the page does not flash the other Home first.
   */
  const [co, setCo] = useState<CustomerOperationsHome | null | undefined>(undefined);
  const loadCo = useCallback(() => {
    // Through a resolved promise so a client without this call (an older test double) is a failed read, not a crash.
    return Promise.resolve()
      .then(() => api.getCustomerOperationsHome())
      .then((r) => setCo(r))
      .catch(() => setCo(null));
  }, []);
  useEffect(() => {
    void loadCo();
  }, [loadCo]);

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

  /**
   * **What is waiting is the WORK QUEUE, not the inquiry feed** (Chat-first Outcome & Visual Closure v1
   * §1). The brief read `/api/inquiries/rows?status=UNANSWERED` — the customer's inquiries as records —
   * while its number came from a freshness-qualified KPI, and the two are different questions with
   * different answers: measured on the real org, 10 actionable work items against 21 unanswered records.
   * Neither number is wrong; they were being shown as one. The home brief is about what the seller has to
   * DO, so it now asks the queue that owns that — one read, and its own total.
   *
   * `undefined` = not read yet (say nothing about it), `null` = the read failed.
   */
  const [queue, setQueue] = useState<InquiryQueueResponse | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    api
      .getInquiryQueueStrict({ size: BRIEF_ROWS })
      .then((r) => {
        if (live) setQueue(r);
      })
      .catch(() => {
        if (live) setQueue(null);
      });
    return () => {
      live = false;
    };
  }, []);

  const data = overview.data;
  // §2: three first-use states, one derivation, from the numbers already on the page. A failed read is
  // `null` and claims nothing — telling a connected seller they have no channels is the one error this
  // screen can make that they cannot check.
  const firstUse = data ? homeFirstUseState(data.metrics.channels) : null;
  const beforeFirstConnection = firstUse?.kind === "NO_CHANNEL";
  // §5: when the brief names the waiting inquiries it also says how many — so the strip stops saying
  // it. Before this the seller read 「현재 미답변 문의 12건」 and 「…문의가 12건 있습니다」 one line apart.
  const strip = data ? contextStrip(data, now, (queue?.content.length ?? 0) > 0, queue?.totalElements ?? null) : [];
  const anyUnproven = strip.some((kpi) => kpi.freshnessUnproven);
  const count = cases ? cases.items.length : null;

  // §11 (Agent Interaction Model v2): the opener speaks the authenticated org's REAL operational truth
  // — prepared cases when there are any, and the waiting workload (from the same strict overview the
  // numbers line reads) when there are none. 「없습니다」 only when the same reads came back empty.
  const workload = useMemo(() => (data ? workloadPriorities(data) : null), [data]);
  // Customer Operations v3.1: the job's Home replaces the numbers line, the opener turn and the four areas —
  // its 「확인 필요」 list already names what the opener used to, and drawing both would list the same inquiry twice.
  const coHome = !beforeFirstConnection && coHomeApplies(co) ? co : null;
  const leadingTurns = useMemo<DisplayTurn[]>(
    // §2: the opener speaks only when there is something to speak about. Before the first connection,
    // and on the morning after one when nothing has arrived, the lead sentence above IS the briefing —
    // an opener saying 「지금 먼저 확인할 일은 없습니다」 under it would be the same morning explained twice,
    // and the weaker explanation would be the one that sounds like a verdict on the store.
    () =>
      co !== undefined && !coHome && cases && firstUse?.kind === "WORKING" && queue !== undefined
        ? [proactiveTurn(cases, workload, queue, storedInquiries(data))]
        : [],
    [co, coHome, cases, workload, queue, firstUse, data],
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
        // 「답변이 필요한 문의」 is ONE question, so the heading, the count, the rows and the destination
        // all come from ONE read. It used to title the answer with the freshness-qualified KPI and fill
        // it with the OPEN work queue — two different sets under one sentence, so the number never
        // described the rows beneath it and neither described the screen the 전체 보기 opened.
        void api
          .getInquiryRowsStrict({ status: "UNANSWERED", order: "OLDEST", limit: 5 })
          .then((page) => {
            const artifact: InquiryListArtifact = {
              artifactId: "local-inquiries",
              type: "INQUIRY_LIST",
              title: `${INTENT_HEADING.UNANSWERED_INQUIRIES} ${page.totalCount}건`,
              totalCount: page.totalCount,
              groups: [
                {
                  key: "UNANSWERED",
                  label: "답변 필요",
                  items: page.items.map((item) => ({
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
              more: { label: "문의 화면에서 전체 보기", to: INQUIRY_NEEDS_REPLY_PATH },
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
  const legacyLead = (
    <div className="space-y-2">
      <h1 className="sr-only">오늘의 운영</h1>
      {beforeFirstConnection && firstUse ? (
        // §2 — nothing is connected. What is missing is not a briefing: it is the one thing that can be
        // done, plus what doing it hands over. The sentence names the data types the channels on this
        // seller's own table actually offer, and there is exactly one next action.
        <section className="space-y-1" aria-label="오늘의 브리핑" data-testid="first-use-no-channel">
          <p className="break-keep text-xl font-bold leading-tight text-ink" aria-live="polite">{DISCONNECTED_HEADLINE}</p>
          <p className="break-keep text-base text-muted">{delegableSentence(firstUse)}</p>
          {/* First-use v2 — a headline, one sentence and a button told a seller who had just signed up
              nothing about what they were handing over. Three steps, in the order they happen; the
              middle one is the only promise and it is derived from this seller's own channel table. */}
          <ol className="space-y-2 pt-3">
            {firstUseSteps(firstUse).map((step) => (
              <li key={step.title} className="break-keep">
                <span className="text-sm font-semibold text-ink">{step.title}</span>
                <span className="text-sm text-muted"> — {step.detail}</span>
              </li>
            ))}
          </ol>
          <div className="pt-3">
            <BtnLink to="/connect">채널 연결하기</BtnLink>
          </div>
        </section>
      ) : firstUse?.kind === "NO_DATA" ? (
        // §2 — connected, and nothing has arrived yet. 「먼저 확인할 일은 없습니다」 would be arithmetic
        // truth and operational nonsense on the morning a seller connected: it reads as "the product
        // looked and your store is quiet", which is a claim about their business that no read supports.
        <section className="space-y-1" aria-label="오늘의 브리핑" data-testid="first-use-no-data">
          <p className="break-keep text-xl font-bold leading-tight text-ink" aria-live="polite">{noDataSentence(firstUse)}</p>
          <div className="pt-3">
            <BtnLink to="/connect" variant="outline">채널 연결 상태 보기</BtnLink>
          </div>
        </section>
      ) : !briefed ? (
        <section aria-label="오늘의 브리핑">
          <p className="break-keep text-xl font-bold leading-tight text-ink" aria-live="polite">{greetingLine(now.getHours(), count)}</p>
        </section>
      ) : null}
      {data && !beforeFirstConnection ? (
        // Reviewnary Visual System v1 §2 — the numbers are the smallest thing on the morning screen.
        // They qualify the briefing under them; a seller who wants them presses 「자세한 숫자 보기」.
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted" aria-label="오늘 상태">
          {briefed ? <span className="font-medium text-ink">{greetingLine(now.getHours(), null)}</span> : null}
          {strip.map((kpi, i) => (
            <span key={kpi.key} className="flex items-center gap-x-2">
              {/* A drawn dot, not a glyph: 「·」 in `line` colour is a text node and it measured 1.12:1
                  — the last two AA violations on this page were both this separator. */}
              {briefed || i > 0 ? <Dot /> : null}
              <Link to={STRIP_ROUTE[kpi.key] ?? "/overview"} className="hover:text-ink hover:underline">
                {kpi.label} <span className="font-semibold tabular-nums text-ink">{kpi.value.toLocaleString("ko-KR")}</span>{kpi.unit ?? "건"}
              </Link>
            </span>
          ))}
          {/* Collection state is context, not an alarm: it qualifies the numbers beside it and it is
              read in the same breath as them (secondary disclosure). The warn colour was spending the
              page's strongest signal on machinery. */}
          {anyUnproven ? (
            <span className="flex items-center gap-x-2"><Dot /><span>일부 채널 최신 수집 확인 필요</span></span>
          ) : null}
          <Link to="/overview" className="font-semibold text-brand-700 hover:underline">자세한 숫자 보기</Link>
        </p>
      ) : overview.error ? (
        <p className="text-sm text-muted">
          운영 숫자를 읽지 못했습니다. <Link to="/overview" className="font-semibold text-brand-700 hover:underline">자세한 숫자 보기</Link>
        </p>
      ) : null}

      {/*
        Operations Home v1 — 지금 확인할 것, as objects rather than as a sentence to ask for.

        Drawn under the greeting and the numbers and ABOVE the thread: the Home is chat-first and it is
        not chat-only, so what needs looking at is on screen before anyone types. The conversation is
        unchanged below it.

        Not drawn at all when the read failed (`null`), when it has not landed (`undefined`), or when
        the seller has nothing yet — four empty headings on a fresh account would be describing a
        product they have not started using, and an area rendering 0 from a failed read would be
        reporting a clear morning on the strength of an error.
      */}
      {home && !beforeFirstConnection
        && hasAnythingToShow(home.reviews, home.problems, home.prepared, home.collection) ? (
        <div className="pt-2">
          <OperationsAreas home={home} />
        </div>
      ) : null}
    </div>
  );

  const lead = coHome ? (
    <CustomerOpsHome co={coHome} ops={home} now={now} onChanged={() => void loadCo()} />
  ) : co === undefined && firstUse?.kind === "WORKING" ? (
    // The job's read has not landed: draw nothing in its place rather than the other Home for a moment.
    <h1 className="sr-only">{COPY.homeTitle}</h1>
  ) : (
    legacyLead
  );

  return (
    <ConversationWorkspace
      surface="home"
      leadingTurns={leadingTurns}
      lead={lead}
      chips={beforeFirstConnection ? FIRST_USE_PROMPTS : coHome ? [] : HOME_PROMPTS}
      placeholder={coHome ? COPY.composer : "무엇이든 물어보세요"}
      onBeforeSend={onBeforeSend}
      // 오늘 (UI/UX v2 Phase 1): the job's Home is a work list with the selected item beside it, and the box sits
      // under the list. The first sentence turns it back into the transcript. Example prompts are left out here —
      // four chips under the box every morning were the same four sentences, and the box already says what it takes.
      emptyLayout={
        coHome
          ? (dock) => (
              <TodayWorkspace
                co={coHome}
                ops={home}
                now={now}
                onChanged={() => void loadCo()}
                onProblemChanged={onProblemChanged}
                dock={dock}
              />
            )
          : undefined
      }
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
export function contextStrip(
  data: OverviewResponse, now: Date, briefNamesInquiries = false, actionable: number | null = null,
): MetricKpi[] {
  const kpis = data.metrics.kpis;
  const find = (key: string) => kpis.find((k) => k.key === key);
  const out: MetricKpi[] = [];
  const unanswered = find("unansweredInquiries");
  /**
   * **The strip's inquiry number is the same 「처리할 일」 the brief means** (Chat-first Semantic &
   * Surface Finalization v1 §2).
   *
   * It used to be the freshness-qualified KPI, which excludes channels whose collection is unproven —
   * so a seller read 「현재 미답변 문의 0건」 directly above 「지금까지 들어온 문의 3건」 and had to know an
   * internal definition to see that both were true. The queue's own total is what the whole screen
   * means by work, so the strip says that, and the KPI keeps its place on the numbers screen where its
   * exclusions are shown. When the queue read has not landed the old number stands rather than a
   * fabricated zero.
   */
  if (unanswered && !briefNamesInquiries) {
    out.push(actionable != null
      ? { ...unanswered, label: "지금 처리할 일", value: actionable }
      : { ...unanswered, label: "현재 미답변 문의" });
  }
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
  if (unanswered && unanswered.value > 0) out.push({ label: "답변을 기다리는 문의", count: unanswered.value, to: INQUIRY_NEEDS_REPLY_PATH });
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
/**
 * How many inquiry RECORDS this org holds, as the overview's channel rows report them — the source
 * records the 문의 workspace is built on, never a count of work. `null` when the read is not in yet.
 *
 * It exists for exactly one sentence: when the queue is empty and records are not, the brief has to say
 * which of the two it means, or 「지금 처리할 일은 없습니다」 reads as a claim about the records too.
 */
export function storedInquiries(data: OverviewResponse | null | undefined): number | null {
  if (!data) return null;
  return data.metrics.channels.reduce((n, c) => n + (c.unansweredInquiries ?? 0), 0);
}

export function proactiveTurn(
  cases: ProactiveCaseListResponse,
  workload: WorkloadPriority[] | null,
  queue: InquiryQueueResponse | null,
  storedRecords: number | null = null,
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
  // ONE number for 「지금 처리할 일」, and it is the queue's own total — the same set the rows below come
  // from. The freshness-qualified KPI stays where it belongs, in the numbers line, saying a different
  // thing about a different question (§1).
  const actionable = queue?.totalElements ?? 0;
  const rows = queue?.content ?? [];
  // The rows the brief names, as the same object every other inquiry list in this product is — so a
  // click here anchors the conversation exactly as a click on an answered list does.
  const waitingRows: InquiryList = {
    artifactId: "home-waiting-rows",
    type: "INQUIRY_LIST",
    title: "최근에 들어온 문의",
    // The sentence above this card says 「최근에 들어온 것부터 보여드릴게요」 — the producer of BOTH
    // declares the repeat, because no containment test can see it (Agent Object v1 §3).
    titleSaid: true,
    totalCount: actionable,
    // The read this brief actually made. It is what the card uses to know the seller (or, here, the
    // brief's own sentence) already said these are the waiting ones — so the list does not add
    // 「모두 답변이 필요한 문의입니다」 under a sentence that just said exactly that.
    // NEWEST, because that is what `getInquiryQueueStrict` returns (`Sort.DESC createdAt`). This field
    // tells the card what the read was; declaring OLDEST here described a read nobody made.
    scope: { period: null, channelCode: null, status: "UNANSWERED", order: "NEWEST", limit: BRIEF_ROWS, rank: null },
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
          // The brief names a row by its title, shop and wait — not by the customer's sentence. But a
          // NAVER product inquiry has no title, and 「제목 없는 문의」 as the largest text on the home
          // screen names nothing (Full Pilot Walkthrough v1, 2026-09-05: the oldest waiting row was
          // that string while the inquiries screen, one click away, showed the customer's words). So
          // the masked preview the rows read already carries stands in ONLY when there is no title —
          // the same fallback the inquiries list uses, from the same read.
          snippet: row.title && row.title.trim() ? null : (row.snippet ?? null),
          productId: row.productId,
          productName: row.productName,
          answerBasis: null,
          // How long this customer has waited. The brief is ordered newest-first and says so; without the
          // number beside each row 「1개월 전」 is a receipt date, not a reason — the same wait the
          // ranked answer states, computed the same way (whole days, dates, never clock time).
          waitingDays: waitingDays(row.receivedAt),
          to: `/inquiries/${row.inquiryId}`,
        })),
      },
    ],
    ...(actionable > rows.length ? { more: { label: `처리할 일 ${actionable.toLocaleString("ko-KR")}건 전체 보기`, to: "/inquiries" } } : {}),
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
      // The number is said ONCE, and it is said as the reason these particular rows are on top. It is the
      // queue's own total, so it can never disagree with the rows underneath it.
      // **The order this sentence names has to be the order the read made** (Pilot QA, 2026-09-06).
      // It said 「가장 오래 기다린 것부터」 and the queue is `Sort.DESC createdAt` — newest first — so on
      // the live org it named 2일·2일·4일 while twenty inquiries had waited since 2016. Sorting the
      // read by the customer's wait instead would put three 2016 현금영수증 requests at the top of
      // today's work, which is not what 「지금 처리할 일」 means either; the year-old backlog has its
      // own divider on the 문의 screen. So the sentence says what the read did, and each row still
      // carries its own wait so nothing about how long they waited is hidden.
      ? `지금 처리할 일이 ${actionable.toLocaleString("ko-KR")}건 있습니다. 최근에 들어온 것부터 보여드릴게요 — 눌러서 바로 이어가시면 됩니다.`
      // **An empty queue is not an empty shop** (§1). With records held and nothing actionable in them,
      // 「지금 처리할 일은 없습니다」 alone reads as a claim about the records too — so the sentence names
      // which of the two it is talking about, and where the other one lives.
      : (storedRecords ?? 0) > 0
        ? `지금 처리할 일은 없습니다. 지금까지 들어온 문의 ${storedRecords!.toLocaleString("ko-KR")}건은 문의 화면에서 볼 수 있습니다.`
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
