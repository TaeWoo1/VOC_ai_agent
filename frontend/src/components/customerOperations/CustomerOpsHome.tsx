import { Fragment, useEffect, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Btn, BtnLink } from "../ui/Btn";
import { RepeatedProblemList } from "../home/RepeatedProblemList";
import { MasterDetail, selectionHref, useWideLayout } from "../workspace/MasterDetail";
import { WorkRows, sharedPhrase } from "../workspace/WorkRows";
import { WorkItemPane, workItemFullScreen } from "../workspace/WorkItemPane";
import { IssueDetailPanel } from "../memory/IssueDetailPanel";
import { ReviewCaseView } from "../../pages/app/ReviewReplyTask";
import { PreparedWorkList } from "../home/PreparedWorkList";
import { api } from "../../lib/apiClient";
import { problemLine } from "../../lib/operationsHome";
import { RESPONSIBILITY_NAME, cadenceLabel, dataTypeKo, kstClock } from "../../lib/customerOperations";
import { COPY, autoCheckWhat, channelShort, failureShort, kstLongDate } from "../../lib/copy/customerOps";
import { mergeHomeWork, reasonCounts, sharedRowFacts, type HomeWork } from "../../lib/homeWork";
import { INFLOW_WORD, RECENT_WORD, recentDay, todayInflow, type InflowFact } from "../../lib/homeSummary";
import type { CustomerOperationsHome } from "../../lib/customerOperationsTypes";
import type {
  HomePreparedItem,
  InquiryQueueResponse,
  OperationsHome,
  OperationsMetrics,
  ReviewIssueView,
  ReviewWorkView,
} from "../../lib/types";

/**
 * How many rows the list shows before 「+N」.
 *
 * <b>Seven is the smallest viewport's capacity, not this viewport's spare room</b> (product-owner decision,
 * 2026-09-26). Eight rows fit 1440 more snugly and push 실행 대기 · 반복 문제 below the fold at the other two,
 * and the emphasis those sections carry IS their being visible.
 *
 * <p><b>Then the Pulse took the room seven depended on</b> (product-owner decision, 2026-09-26). Measured at
 * 1152×720: the list's own scroller ends at y=631 and seven rows used to end at 585 — 46px of slack. The Pulse
 * is 100px where the line it replaced was 21px, so the list now starts at y=227 instead of 145 and a seventh
 * row would end at 668 — <b>37px past the bottom of the scroller that holds it</b>. Seven and the Pulse are not
 * both true there, so the narrow case shows six, ending at 605 with 26px to spare. <b>A row is either whole or
 * absent</b>: the alternative was leaving the seventh clipped, and a row you can read the top of is a row the
 * screen is pretending to show. At 1440×900 nothing changed — seven rows end at 668 with the composer at 838.
 *
 * <p>The constant below still means what it meant — the capacity of the widest case, and the number every
 * other surface reasons about. What is new is that the <i>visible</i> limit is its own named function of the
 * layout, not a second constant and not a measurement: {@link visibleHomeRows}. It reuses the side preview's
 * 1200 breakpoint rather than inventing one, because that is the width at which this column stops being the
 * whole page, and a row count that disagrees with the layout it sits in is the bug this replaces.
 */
export const HOME_ROWS = 7;
/**
 * The visible limit below 1200 — where the Pulse leaves room for six whole rows and not a seventh.
 * It is not a second capacity: `HOME_ROWS` is still what 「+N」 counts against and what the queue screen holds.
 */
export const HOME_ROWS_NARROW = 6;
/**
 * How many rows this width can show whole. `wide` is the side preview's own answer ({@link useWideLayout}),
 * so the two never disagree; an environment that cannot measure says narrow, which is the safe direction —
 * it under-fills a wide screen instead of clipping a narrow one.
 */
export function visibleHomeRows(wide: boolean): number {
  return wide ? HOME_ROWS : HOME_ROWS_NARROW;
}
/**
 * <b>What the docked link says, by what it opens</b> (product-owner decision, 2026-09-26).
 *
 * <p>「처리하기」 had to go for a reason this panel made visible: 「처리 방법 미정」 stands about 150px above the
 * button, so one screen used 처리 as a noun for the disposition and as a verb on the control beside it, and the
 * verb read as «press this and it is handled». The review case is where the seller judges — 이 리뷰의 중요도,
 * 처리 방법 and 조치 기록 are its three controls — so that is what its link says. Everything else gets the plain
 * navigational verb, because 판단하기 would be a promise about a screen whose job is to prepare an answer.
 *
 * <p>No behaviour changed and no destination moved: both strings open exactly what they opened before.
 */
const FULL_SCREEN = { review: "전체 화면에서 판단하기", other: "전체 화면에서 열기" } as const;

/** How many queue rows the Home asks for — enough to fold out, bounded. */
export const HOME_QUEUE_SIZE = 50;

/** Whether the Home is drawn as 고객 운영 관리's (v3.1) — the job is open for this org and has something to say. */
export function coHomeApplies(co: CustomerOperationsHome | null | undefined): co is CustomerOperationsHome {
  return Boolean(co && co.available && (co.status !== null || co.eligible));
}

/**
 * <b>Home (Customer Operations v3.1)</b>: a title line, 「자동 확인 → 내 확인 필요」, the one 「확인 필요」 list,
 * 「실행 대기」 — what the seller already decided and has not finished — and 「반복 문제」, the patterns, stated below
 * the work and never added to it. Nothing here decides, sends or resolves; every row opens the screen that does.
 *
 * <p>The three sections are three different questions in the order a morning asks them: 어떻게 할까 · 아까 정한 걸
 * 끝내자 · 무엇이 반복되나. They are never summed and never merged — a decision and its own unfinished follow-up are
 * the same item at two moments, and 「확인 필요」 deduplicates against exactly that.
 *
 * `ops` is the Operations Home read AgentHome already made — it carries the repeated problems too, which is why this
 * Home can name them without a read of its own. The queue is read here because the list needs more rows than the
 * conversation's brief ever did.
 */
export function CustomerOpsHome({
  co,
  ops,
  now = new Date(),
  onChanged,
  metrics,
  sharedQueue,
  sharedReviewWork,
  selection,
}: {
  co: CustomerOperationsHome;
  ops: OperationsHome | null | undefined;
  now?: Date;
  onChanged: () => void;
  /**
   * The overview read the page around this list already made (`getOverviewStrict(7)`). Only the summary
   * line reads it, and only to answer 「오늘 들어온 것」 — a failed read is `null` and says nothing.
   */
  metrics?: OperationsMetrics | null;
  /** The queue read, when the page around this list already made it (the 오늘 workspace needs the same rows). */
  sharedQueue?: { value: InquiryQueueResponse | null | undefined };
  /** The review half of 확인할 일, when the page around this list already read it. */
  sharedReviewWork?: { value: ReviewWorkView | null | undefined };
  /** Master-detail selection. Absent: every row opens its own screen, as on a narrow page. */
  selection?: HomeSelection;
}) {
  const ownQueue = useHomeQueue(sharedQueue === undefined);
  const queue = sharedQueue ? sharedQueue.value : ownQueue;
  const ownReviewWork = useReviewWork(sharedReviewWork === undefined);
  const reviewWork = sharedReviewWork ? sharedReviewWork.value : ownReviewWork;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const work = mergeHomeWork(co, ops, queue, now, reviewWork);
  // The row limit asks the layout, not the caller: `selection` is absent on pages that do not select in
  // place, and defaulting to narrow there would drop a row on a 1440 screen that has the space.
  const roomy = useWideLayout();
  const shown = work.rows.slice(0, visibleHomeRows(roomy));
  const hidden = work.rows.length - shown.length;
  const running = co.status === "ACTIVE" || co.status === "PAUSED";
  const wide = selection?.wide ?? false;
  const search = selection?.search ?? "";
  const awaiting = awaitingRows(ops, work);
  // What every row in the WHOLE list says identically — over `work.rows`, not the six or seven drawn, because
  // this heading stands under the Pulse's 「확인할 일 11」 and a 「모두 …」 that covered only what is drawn would
  // be a claim about eleven made from six. `WorkRows` is handed the same population and hides exactly this.
  const shared = sharedRowFacts(work.rows);
  const sharedSaid = sharedPhrase(shared);

  async function act(run: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await run();
      onChanged();
    } catch {
      setError("요청 실패 · 다시 시도");
    } finally {
      setBusy(false);
    }
  }

  const pill =
    co.status === "ACTIVE"
      ? { label: COPY.running, cls: "bg-[#E9F4EC] text-good", dot: "bg-[#1F9D55] shadow-[0_0_0_3px_rgba(31,157,85,0.18)]" }
      : co.status === "PAUSED"
        ? { label: COPY.paused, cls: "bg-[#FFF3E4] text-warn", dot: "bg-[#D97706]" }
        : { label: COPY.off, cls: "bg-[#F1F3F5] text-muted", dot: "bg-[#8B95A1]" };

  const warnings = [...lastRunLines(co, now), ...warningLines(co, now), ...failedReads(ops, queue)];

  return (
    <div className="space-y-4 pb-2">
      {/*
        <b>The morning is a list, so the screen opens on one</b> (reference-based hierarchy v1).

        <p>Between the title and the first row there used to be a bordered band with 「확인할 일 11」 and
        「실행 대기 없음」 in two 571px cells at 22px/800. Measured against Linear's Triage list and Intercom's
        Inbox, neither puts a counter card over a work list — the list IS the count, and in our case 실행 대기
        already had its own section four rows down, so the cell was a second pointer to it. Every fact it carried
        is still here; it stands in the one quiet status line under the title, where the automation's own state
        already was. Product-owner decision, 2026-09-25.
      */}
      <header>
        <h1 className="text-[17px] font-bold leading-tight tracking-tight text-ink">{COPY.homeTitle}</h1>
        <p
          data-testid="today-status"
          className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px] leading-relaxed text-muted"
        >
          <span>{kstLongDate(now)}</span>
          <Sep />
          {/* The state is a dot and a word, not a filled pill: on a screen whose subject is what the customers
              wrote, a coloured capsule at the top is the loudest mark for the quietest fact. Same colour, same
              link, same word. */}
          <Link
            to="/customer-operations"
            className="inline-flex items-center gap-1.5 font-medium hover:text-ink hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700"
          >
            <span aria-hidden="true" className={`h-[6px] w-[6px] rounded-full ${pill.dot}`} />
            {pill.label}
          </Link>
          {/* <b>Three facts, and the other four moved to the screen that owns the job</b> (product-owner
              decision, 2026-09-26). Measured, this line was 1,144px of seven facts — and that was its SHORT
              form: on an org that has checked once, 「첫 확인 전」 expands to 「최근 24시간 자동 확인 N건 · 정리 N ·
              관찰 N · 초안 N (미발송) · 처리 확인 중 N」, so the real line is eleven facts, and its strongest
              element (semibold ink) was a caveat about the machine. This line answers 「자동 확인이 돌고 있나」;
              Home needs that question's conclusion, not its parameters. 확인 주기 · 다음 확인 · 마지막 확인 were
              already on `/customer-operations` — nothing was deleted, one thing moved. What stays on THIS line is
              the frame the rest of the screen is read inside: which today it is, and whether the list below can
              be trusted. The operational figures — including 실행 대기 — are the summary's, one line down, where
              each one stands beside the question it answers. */}
        </p>
        <OperationsSummary
          inflow={todayInflow(metrics, now)}
          work={work}
          awaiting={co.status === "ACTIVE" ? awaiting.count : null}
          recent={recentDay(co)}
        />
      </header>

      {running && co.status === "ACTIVE" ? (
        <>
          {warnings.length > 0 ? (
            <ul className="space-y-1.5 rounded-xl bg-[#FFF8EF] px-4 py-3 text-sm text-warn" aria-label="집계에서 빠진 곳">
              {warnings.map((line, i) => (
                <li key={i} className="flex flex-wrap items-center gap-x-2">
                  {line}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : (
        <section
          aria-label={pill.label}
          className="flex flex-wrap items-center gap-3 rounded-[16px] bg-surface px-6 py-5 shadow-[0_0_0_1px_#E4E7EC]"
        >
          {/* <b>Before it is running, the card names what the seller is about to start — not the state again.</b>
              It used to print `COPY.off`, the same string as the badge two lines above, so the whole card was one
              state word and a bare 「시작」: a seller could not tell what would be started, how often it would look,
              or whether it would answer a customer on their behalf. The three lines are the job's own contract —
              the name every surface uses, the cadence the server sent, and the boundary the approval path enforces.
              Nothing about the layout moves: this is the same one-row section with its text in a block. */}
          <div className="min-w-[16rem] flex-1 space-y-1">
            <p className="text-base font-bold text-ink">{RESPONSIBILITY_NAME}</p>
            <p className="break-keep text-sm leading-relaxed text-muted">{autoCheckWhat(cadenceLabel(co.cadenceMinutes))}</p>
            <p className="break-keep text-sm leading-relaxed text-muted">{COPY.autoCheckFence}</p>
          </div>
          {error ? (
            <p role="alert" className="text-sm text-bad">
              {error}
            </p>
          ) : null}
          {co.status === "PAUSED" || co.eligible ? (
            <Btn
              className="ml-auto"
              disabled={busy}
              onClick={() =>
                act(() => (co.status === "PAUSED" ? api.resumeCustomerOperations() : api.activateCustomerOperations()))
              }
            >
              {co.status === "PAUSED" ? COPY.resume : COPY.start}
            </Btn>
          ) : (
            <Link
              to="/connect"
              className="ml-auto inline-flex min-h-[40px] items-center rounded-lg border border-line bg-surface px-4 text-base font-semibold text-ink hover:bg-canvas focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700"
            >
              {COPY.connectChannel}
            </Link>
          )}
        </section>
      )}

      {work.rows.length > 0 ? (
        <section aria-label={COPY.listTitle}>
          {/* Count and order on the heading, the way out on the right, one hairline under it — the list header
              both references draw (Intercom: 「5 Open ⌄」 / 「Newest ⌄」). No box, no pill, no second number: the
              count lives on the heading of the thing it counts. */}
          <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 border-b border-line pb-2">
            {/* The count is the Pulse's, one line up, under this same word (2026-09-26). It is the same
                number from the same `work`, and drawing it in both places put the same fact 12px from
                itself. The heading keeps what is only the list's: its order and its way out. */}
            <h2 className="text-sm font-semibold tracking-tight text-ink">{COPY.listTitle}</h2>
            <span className="break-keep text-[13px] text-muted">
              {COPY.listOrder}
              {/* What every row says identically, said once — instead of twice on each of them. */}
              {sharedSaid ? ` · ${sharedSaid}` : ""}
            </span>
            {/* More than one kind of work waiting: then the mix IS information and the rows keep their badges. */}
            {!shared.tag ? (
              <span className="break-keep text-[13px] text-muted">
                <Items parts={reasonCounts(work.rows)} />
              </span>
            ) : null}
            {hidden > 0 || work.truncated ? (
              <Link
                to="/customer-operations/cases"
                className="ml-auto shrink-0 text-[13px] font-semibold text-brand-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700"
              >
                {/* <b>The link is a destination, not a count</b> (product-owner decision, 2026-09-26). It said
                    「전체 11건 보기」 while the Pulse two lines above said 확인할 일 11 — the same number twice on
                    one screen, and the one down here had to go quiet when the server sent a floor instead of a
                    total, so the same control changed its shape for a reason no seller could see. The total is
                    the Pulse's, in one form, including 「N+」; this says where it goes. */}
                전체 보기 →
              </Link>
            ) : null}
          </div>
          <WorkRows
            rows={shown}
            selectedKey={selection?.selectedKey ?? null}
            wide={wide}
            search={search}
            now={now}
            ariaLabel={COPY.listTitle}
            showBacklogDivider={false}
            dense
            sharedOver={work.rows}
            // The shared facts are on the heading above. What 리뷰 counts here is a rule about the queue, and it
            // now stands on the queue screen that owns the whole list rather than as a paragraph under a
            // five-row brief — neither reference puts an explanatory sentence under a work list.
            captionSaysReason
          />
        </section>
      ) : running && co.status === "ACTIVE" ? (
        // Nothing waiting is a state, and the list's absence does not state it. 「다음 확인」 is on the status
        // line above, where it was before this became one line.
        <p className="break-keep text-sm text-muted">지금 확인할 일이 없습니다.</p>
      ) : null}

      <AwaitingExecution awaiting={awaiting} selection={selection} />
      <RepeatedProblems ops={ops} selection={selection} />
    </div>
  );
}

/** What the 오늘 list can select: a row of 확인할 일, an approved reply waiting to be posted, or a repeated problem. */
export interface HomeSelection {
  wide: boolean;
  selectedKey: string | null;
  search: string;
}

/** The review half of 확인할 일 (UI/UX v2 Phase 3). `null` = the read failed; the list is then what it was. */
export function useReviewWork(enabled = true): ReviewWorkView | null | undefined {
  const [value, setValue] = useState<ReviewWorkView | null | undefined>(undefined);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    Promise.resolve()
      .then(() => api.getReviewWorkStrict())
      .then((r) => live && setValue(r))
      .catch(() => live && setValue(null));
    return () => {
      live = false;
    };
  }, [enabled]);
  return value;
}

/** The queue read the Home's list needs. `enabled` false when the page around it already made the same read. */
export function useHomeQueue(enabled = true): InquiryQueueResponse | null | undefined {
  const [queue, setQueue] = useState<InquiryQueueResponse | null | undefined>(undefined);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    api
      .getInquiryQueueStrict({ size: HOME_QUEUE_SIZE })
      .then((r) => live && setQueue(r))
      .catch(() => live && setQueue(null));
    return () => {
      live = false;
    };
  }, [enabled]);
  return queue;
}

/**
 * <b>오늘 — the Home as a work list with the selected item beside it</b> (UI/UX v2 Phase 1).
 *
 * <p>The same sections, the same reads and the same counts as before; what changed is where an item opens. A row of
 * 확인할 일, an approved reply and a repeated problem each open in the pane on the right, drawn by the screen that owns
 * it, and the conversation box is docked under the list.
 *
 * <p><b>Nothing is chosen until the seller chooses it</b> (Home v3). This screen's question is 「오늘 무엇을 해야
 * 하지?」 and the honest answer to it is the list, not one row of it. Opening the first row on arrival made the
 * loudest thing on the morning a case the seller had not asked for — measured at 1440×900, the pane ran 2,290px
 * against a 1,807px list and carried the only filled buttons on screen — and there was no way back out of it,
 * because the URL had no value for «nothing»: a missing {@code item} meant «the first row», so no control could
 * ask for the closed state.
 *
 * <p>So the URL owns it. No {@code item} is closed, {@code item=<key>} is that row, and <b>a key that matches
 * nothing is closed too</b> — a stale address must not quietly open a different record than the one it names.
 */
export function TodayWorkspace({
  co,
  ops,
  now = new Date(),
  onChanged,
  onProblemChanged,
  metrics,
  dock,
}: {
  co: CustomerOperationsHome;
  ops: OperationsHome | null | undefined;
  now?: Date;
  onChanged: () => void;
  /**
   * The overview read the page around this list already made (`getOverviewStrict(7)`). Only the summary
   * line reads it, and only to answer 「오늘 들어온 것」 — a failed read is `null` and says nothing.
   */
  metrics?: OperationsMetrics | null;
  /** A repeated problem changed state in the pane — the list beside it must say so at once. */
  onProblemChanged?: (next: ReviewIssueView) => void;
  dock: ReactNode;
}) {
  const wide = useWideLayout();
  const location = useLocation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const queue = useHomeQueue();
  const reviewWork = useReviewWork();
  const work = mergeHomeWork(co, ops, queue, now, reviewWork);
  const key = params.get("item");

  let detail: ReactNode = null;
  let selectedKey: string | null = null;
  /**
   * The pane's one action. Set beside the detail it belongs to, so a pane can never dock a control that opens
   * something else.
   *
   * <b>It is never solid</b> (product-owner decision, 2026-09-26). The rule this replaces — «solid exactly when
   * the pane offers nothing else to press» — asked the wrong question. What decides a control's weight is what
   * pressing it DOES, and every one of these navigates: nothing here is spent, approved, sent or recorded. A
   * full-bleed `brand-700` block was measured as the heaviest element in a 440px panel whose subject is the
   * customer's own sentence at 22px/800, and neither reference draws anything like it — Linear's Peek carries no
   * action at all and Intercom's Details rail ends where its rows end. So the field that carried that rule is
   * gone rather than inverted, and `paneCarriesOwnAction` went with it: answering it was its only job.
   */
  let open: { to: string; label: string } | null = null;
  if (wide) {
    const prepared = key?.startsWith(PREPARED) ? ops?.prepared.rows.find((r) => `${PREPARED}${r.id}` === key) : undefined;
    const problem = key?.startsWith(PROBLEM) ? ops?.problems.rows.find((r) => `${PROBLEM}${r.issue.id}` === key) : undefined;
    if (prepared && prepared.kind === "REVIEW_REPLY") {
      selectedKey = key;
      detail = <ReviewCaseView key={key} reviewId={prepared.id} variant="pane" depth="preview" />;
      open = { to: `/reviews/reply/${prepared.id}?from=work`, label: FULL_SCREEN.review };
    } else if (problem) {
      selectedKey = key;
      detail = <IssueDetailPanel key={key} issue={problem.issue} onIssueChanged={onProblemChanged ?? (() => undefined)} />;
      open = { to: `/memory/${problem.issue.id}`, label: "근거 전체 보기" };
    } else if (key) {
      // Only what the address names. 확인할 일 kept a first-row fallback when this was written; it does not
      // any more (Review Decision UX v3.2), so both screens now answer 「선택 없음」 the same way.
      const chosen = work.rows.find((r) => r.key === key) ?? null;
      if (chosen) {
        selectedKey = chosen.key;
        detail = <WorkItemPane row={chosen} now={now} depth="preview" />;
        open = { to: workItemFullScreen(chosen), label: chosen.kind === "REVIEW" ? FULL_SCREEN.review : FULL_SCREEN.other };
      }
    }
  }

  const close = () => navigate({ pathname: location.pathname, search: withoutItem(location.search) }, { replace: true });

  return (
    <MasterDetail
      wide={wide}
      detailLabel="선택한 항목"
      detail={detail}
      onClose={detail ? close : undefined}
      preview
      paneFooter={
        open ? (
          <BtnLink to={open.to} variant="outline" className="w-full text-brand-700">
            {open.label}
          </BtnLink>
        ) : null
      }
      footer={dock}
      list={
        <CustomerOpsHome
          co={co}
          ops={ops}
          now={now}
          onChanged={onChanged}
          metrics={metrics}
          sharedQueue={{ value: queue }}
          sharedReviewWork={{ value: reviewWork }}
          selection={{ wide, selectedKey, search: location.search }}
        />
      }
    />
  );
}

/** The address of the closed state: this page, with the selection dropped and every other parameter kept. */
function withoutItem(search: string): string {
  const params = new URLSearchParams(search);
  params.delete("item");
  const rest = params.toString();
  return rest ? `?${rest}` : "";
}

const PREPARED = "prepared:";
const PROBLEM = "problem:";

/** The dot between two facts on the status line. Drawn, never typed, so a wrapped line never starts on one. */
function Sep() {
  return (
    <span aria-hidden="true" className="text-[#C9CFD8]">
      ·
    </span>
  );
}

/**
 * The name of the surface for a reader who cannot see the three columns. It names the surface, not the
 * work: 확인할 일 is the cell's label and the section's heading below, and this is the band they sit in.
 */
const PULSE_LABEL = "오늘 운영 현황";

/**
 * <b>Operational Pulse — 오늘 들어온 것 · 확인할 일 · 최근 24시간</b>, one surface above the inbox.
 *
 * <p>The data contract is `docs/pilot_usage_loop_v1.md` §8 and it does not move here: <b>no new read</b>
 * (every value comes from the five the Home already makes), no KPI card, no tile, no chart.
 *
 * <p><b>Why it stopped being a line</b> (product-owner decision, 2026-09-26). Measured, the 13px muted
 * line was the status line's second row — same font-size, same colour, same line-height, 4px under it —
 * so a seller read it as more date metadata and the screen answered 「오늘 운영이 어떻게 흐르고 있나」 in
 * the type of a caption. The figures now take 22px/600 ink; the labels stay 13px muted. <b>The emphasis
 * is the number</b> — never the label, never the surface.
 *
 * <p><b>One surface, not three cards.</b> Three cards are three objects, and the screen's subject is the
 * list below them. A neutral fill instead of a border, because on this white page a hairline is the
 * louder of the two per unit of information carried; no shadow, no gradient, no icon, no chart. The
 * columns are separated by whitespace alone — a divider would be a fourth and fifth drawn line to say
 * what three left-aligned blocks already say.
 *
 * <p><b>The three cells are not three counts of the same kind.</b> The first is a measured day, the
 * second is now, the third is a window on cases we opened — which is why each carries its own lead word
 * instead of one heading that would make a single window true of all three. Zendesk's Agent Home rail
 * does exactly this and for the same reason: 「This week」 and 「60 days」 stand under each statistic's own
 * name rather than over the group.
 *
 * <p>The second cell says <b>확인할 일</b> — the same canonical noun as the section heading below it,
 * because it is the same set counted once. A second name (「지금 확인할 것」) would have split one meaning
 * into two words twelve pixels apart, and the total now lives here alone: the list's way out says
 * 「전체 보기」 and names no number.
 *
 * <p>A cell with nothing true to say renders nothing, and when no cell has, neither does the surface.
 * That is not tidiness: an inflow read that failed, a job that is not running, and an org with no window
 * yet are three different silences, and none of them is 「0」.
 */
function OperationsSummary({
  inflow,
  work,
  awaiting,
  recent,
}: {
  inflow: ReturnType<typeof todayInflow>;
  work: HomeWork;
  /** `null` when the job is not running — 실행 대기 is a fact about a job that is looking. */
  awaiting: number | null;
  recent: ReturnType<typeof recentDay>;
}) {
  const cells: ReactNode[] = [];

  if (inflow) {
    cells.push(
      <Cell key="inflow" id="inflow" label={INFLOW_WORD.lead}>
        {/* Neither lane could be vouched for: one sentence, not the same five syllables twice. */}
        {inflow.reviews.kind === "UNQUALIFIED" && inflow.inquiries.kind === "UNQUALIFIED" ? (
          <State>{INFLOW_WORD.bothUnqualified}</State>
        ) : (
          <>
            <Inflow fact={inflow.reviews} word={INFLOW_WORD.reviews} unqualified={INFLOW_WORD.reviewsUnqualified} />
            <Dot />
            <Inflow fact={inflow.inquiries} word={INFLOW_WORD.inquiries} unqualified={INFLOW_WORD.inquiriesUnqualified} />
          </>
        )}
        {/* Real counts of rows the product manufactured about itself. Shown, never unlabelled — and the
            label only where there is a figure to label: with both lanes withheld it would qualify
            nothing and read as a state of its own. */}
        {inflow.exampleData && (inflow.reviews.kind === "COUNT" || inflow.inquiries.kind === "COUNT") ? (
          <>
            <Dot />
            {INFLOW_WORD.exampleData}
          </>
        ) : null}
      </Cell>,
    );
  }

  // The canonical deduped count, and 실행 대기 under it — what the seller already decided and has not
  // finished. With nothing waiting and nothing pending this cell has no fact of its own and is absent;
  // it does not print a 0 assembled from reads that may not have landed.
  if (work.rows.length > 0 || (awaiting ?? 0) > 0) {
    cells.push(
      <Cell key="work" id="work" label={COPY.listTitle} note={awaiting === null ? null : <AwaitingFact count={awaiting} />}>
        {/* The server said there are more than it sent, so this total is a floor. */}
        <Big value={work.rows.length} suffix={work.truncated ? "+" : ""} />
      </Cell>,
    );
  }

  if (recent) {
    cells.push(
      <Cell
        key="recent"
        id="recent"
        label={RECENT_WORD.lead}
        note={
          recent.checked === 0 ? null : (
            <>
              <Figure word={RECENT_WORD.autoResolved} value={recent.autoResolved} small />
              <Dot />
              <Figure word={RECENT_WORD.draftsPrepared} value={recent.draftsPrepared} small />
            </>
          )
        }
      >
        {recent.checked === 0 ? (
          <State>{RECENT_WORD.none}</State>
        ) : (
          <Figure word={RECENT_WORD.checked} value={recent.checked} />
        )}
      </Cell>,
    );
  }

  if (cells.length === 0) return null;
  return (
    <section
      data-testid="today-summary"
      aria-label={PULSE_LABEL}
      className="mt-2 grid grid-cols-3 items-start gap-x-8 rounded-xl bg-canvas px-6 py-3.5"
    >
      {cells}
    </section>
  );
}

/**
 * One column: the question, the figure, and what qualifies the figure.
 *
 * <p><b>One paragraph, three stacked spans</b> — not three paragraphs. The label and its figure are one
 * fact and are read as one; between block children of a paragraph the separating space is a real text
 * node, so a screen reader says 「확인할 일 4」 and not 「확인할 일4」. That is the same rule the dots inside
 * a cell follow, and the reason the old line spelled its separators instead of drawing them.
 *
 * <p>The value line fixes its line box at 28px so a cell whose value is a 15px state sentence sits on the
 * same baseline as a cell whose value is a 22px number — the row of figures has to read as a row.
 * `min-w-0` lets a long value wrap inside its third instead of pushing the grid; it may never clip, which
 * is why the atoms carry `whitespace-nowrap` and the separators between them do not.
 */
function Cell({ id, label, note, children }: { id: string; label: string; note?: ReactNode; children: ReactNode }) {
  return (
    <p data-testid={`pulse-${id}`} className="min-w-0 break-keep text-[13px] text-muted">
      <span className="block leading-[18px]">{label}</span>{" "}
      <span className="mt-0.5 block leading-7">{children}</span>
      {note ? (
        <>
          {" "}
          <span className="mt-0.5 block leading-[19px]">{note}</span>
        </>
      ) : null}
    </p>
  );
}

/** One inflow metric: the number when it is a measured fact, the collection state when it is not. */
function Inflow({ fact, word, unqualified }: { fact: InflowFact; word: string; unqualified: string }) {
  if (fact.kind === "UNQUALIFIED") return <State>{unqualified}</State>;
  return <Figure word={word} value={fact.value} />;
}

/**
 * <b>미관측은 숫자가 아니고, 사고도 아니다.</b> It stands in the value slot so the cell keeps its shape,
 * at 15px — below a figure, above a caption — and in the ordinary muted ink. No warn colour, no icon, no
 * tint: 「아직 확인하지 못했다」 is a smaller claim than the numbers beside it, and a band that turns
 * orange the moment a channel is quiet trains a seller to stop reading the band.
 */
function State({ children }: { children: ReactNode }) {
  return <span className="whitespace-nowrap text-[15px] leading-7 text-muted">{children}</span>;
}

/** The figure itself — the only ink and the only weight this surface spends. */
function Big({ value, suffix = "" }: { value: number; suffix?: string }) {
  return (
    <span className="text-[22px] font-semibold leading-7 tabular-nums text-ink">
      {value.toLocaleString("ko-KR")}
      {suffix}
    </span>
  );
}

/**
 * Label muted, number ink. `small` is the supporting line, where the figure keeps the ink and the weight
 * but not the size — 그중 정리 and 초안 준비 qualify 새로 확인, and a qualifier at the size of the thing it
 * qualifies is a second headline.
 *
 * <p>The word and its number are one unwrappable atom: a line that breaks between 리뷰 and 6 has moved a
 * number away from the noun it counts.
 */
function Figure({ word, value, small = false }: { word: string; value: number; small?: boolean }) {
  return (
    <span className="whitespace-nowrap">
      {word}{" "}
      {small ? (
        <span className="font-semibold tabular-nums text-ink">{value.toLocaleString("ko-KR")}</span>
      ) : (
        <Big value={value} />
      )}
    </span>
  );
}

/**
 * The separator inside one cell. The spaces are text, not layout: the space between two flex children is
 * rendered, never read, and a screen reader would say 「리뷰6」.
 */
function Dot() {
  return (
    <>
      {" "}
      <span aria-hidden="true" className="text-[#C9CFD8]">
        &middot;
      </span>{" "}
    </>
  );
}

/**
 * <b>실행 대기</b> — the count, and nothing built around it.
 *
 * <p>It had a 571px cell and a 22px/800 value beside the work the seller has not decided yet; an obligation they
 * already decided and a number that is usually zero do not earn that. The emphasis for a non-zero count is the
 * 실행 대기 section further down existing at all — this is the pointer to it, and it is a link only when there
 * is something to point at. No pill, no fill, no colour.
 */
function AwaitingFact({ count }: { count: number }) {
  if (count === 0) return <span>실행 대기 없음</span>;
  return (
    <a href="#실행-대기" className="hover:text-ink hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700">
      실행 대기 <span className="font-semibold tabular-nums text-ink">{count.toLocaleString("ko-KR")}</span>
    </a>
  );
}
/** The rows of 실행 대기 after the dedupe against 확인할 일, and how many the section stands for in total. */
function awaitingRows(ops: OperationsHome | null | undefined, work: HomeWork) {
  const prepared = ops?.prepared;
  if (!prepared) return { rows: [] as HomePreparedItem[], moreReplies: 0, count: 0 };
  // Anything 확인할 일 is already offering is not offered again, by the same key that list deduped itself with.
  const claimed = new Set(work.rows.map((row) => row.owner));
  const rows = prepared.rows.filter((row) => !claimed.has(row.to));
  // The server caps its list; only the review-reply kind is compared, because it is the only one this section never
  // expects to lose rows to the dedupe above.
  const drawnReplies = rows.filter((row) => row.kind === "REVIEW_REPLY").length;
  const moreReplies = Math.max(0, prepared.reviewRepliesApproved - drawnReplies);
  return { rows, moreReplies, count: rows.length + moreReplies };
}

/**
 * <b>실행 대기 — 판매자가 이미 결정했고, 아직 끝나지 않은 일.</b>
 *
 * <p>Everything here rests on a record the seller themselves wrote: an approval that stands, a draft that exists,
 * an improvement they accepted. That is what separates this from 「확인 필요」 above it — there the question is
 * 「어떻게 할까」, here it is 「아까 정한 걸 끝냅시다」 — and it is why these rows are worth their own heading rather
 * than being mixed into the decision list.
 *
 * <p><b>Measured, not supposed.</b> On the live org three approved replies had been standing for seventeen days
 * with no submission recorded and a fourth carried four aborted attempts, and this Home drew none of them: it never
 * read {@code ops.prepared} at all. They could not surface through 「확인 필요」 either, because that list is built
 * from cases, UNDECIDED reviews and the inquiry queue — and an approved reply is, by definition, decided.
 *
 * <p><b>Nothing is re-run and nothing is written.</b> Every row is a link to the surface that owns finishing it.
 * This product has no dispatcher: approving freezes the text and marks it copy-ready, and the posting is the
 * seller's own action on the marketplace. A control here that looked like 「보내기」 would promise a send no
 * approval covers.
 *
 * <p><b>Reported-as-sent work is already gone before it reaches this component</b> — the server's standing-approval
 * predicate excludes an approval whose approved fingerprint has an {@code OPERATOR_REPORTED_SUBMITTED} outcome. An
 * aborted attempt is not such an outcome: it is one guided run ending at the submit barrier, which posts nothing
 * and withdraws nothing, so the reply is still waiting and still belongs here.
 */
function AwaitingExecution({
  awaiting,
  selection,
}: {
  awaiting: ReturnType<typeof awaitingRows>;
  selection?: HomeSelection;
}) {
  const { rows, moreReplies } = awaiting;
  if (rows.length === 0 && moreReplies === 0) return null;
  const wide = selection?.wide ?? false;
  const search = selection?.search ?? "";
  const selectedId = selection?.selectedKey?.startsWith(PREPARED) ? selection.selectedKey.slice(PREPARED.length) : null;

  return (
    <section aria-label="실행 대기" id="실행-대기">
      {/* The badge that used to sit here said 「승인함 · 등록 전」 over every row. It is what a standing
          review approval is, and what an inquiry row is not — those arrive with the work item still
          PROPOSED and no approval anywhere. One badge cannot be true of both, so the state moved onto
          the rows, where each one can say its own (see lib/preparedState.ts). */}
      <div className="mb-3 mt-8 flex items-center gap-2">
        <h2 className="text-[17px] font-bold tracking-tight text-ink">실행 대기</h2>
      </div>
      <PreparedWorkList
        rows={rows}
        selectedId={wide ? selectedId : null}
        // An approved review reply opens in the pane — the Review Case, where the approved text and its copy are.
        linkFor={(row) => (row.kind === "REVIEW_REPLY" ? selectionHref(wide, `${PREPARED}${row.id}`, row.to, search) : row.to)}
      />
      {moreReplies > 0 ? (
        <p className="mt-2 px-1 text-sm">
          <Link
            to="/reviews"
            className="font-medium text-brand-700 underline underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700"
          >
            승인한 리뷰 답변 {moreReplies.toLocaleString("ko-KR")}건 더 보기
          </Link>
        </p>
      ) : null}
    </section>
  );
}

/**
 * Facts in a row, each kept whole with the separator in front of it — so a wrapped line starts with 「·」 or with a fact,
 * never ends on a dangling dot.
 */
function Items({ parts }: { parts: React.ReactNode[] }) {
  return (
    <>
      {/* A space between the unbreakable parts is the only place a long tally may wrap — without it a cell's line
          runs under the next cell instead of onto its own second line. */}
      {parts.map((part, i) => (
        <Fragment key={i}>
          {i > 0 ? " " : null}
          <span className="whitespace-nowrap">
            {i > 0 ? <span aria-hidden="true" className="mr-1.5">·</span> : null}
            {part}
          </span>
        </Fragment>
      ))}
    </>
  );
}



/** The latest run failed: the 24-hour tally above stands, and this names the check it does not include. */
function lastRunLines(co: CustomerOperationsHome, now: Date): React.ReactNode[] {
  if (co.lastRunStatus !== "FAILED") return [];
  const at = kstClock(co.lastCheckedAt, now);
  const next = kstClock(co.nextCheckAt, now);
  return [
    <span className="break-keep">
      {COPY.lastCheckFailed}
      {at ? ` (${at})` : ""} · 이번 확인분 집계 제외{next ? ` · 다음 확인 ${next}` : ""}
    </span>,
  ];
}

/**
 * A list read that failed is left out of the count, and the card says so. 「N+」 is kept for a read that reported more
 * than it returned; a failure knows nothing about how many there are, so it gets this line instead of a guess.
 */
function failedReads(ops: OperationsHome | null | undefined, queue: InquiryQueueResponse | null | undefined): React.ReactNode[] {
  const lines: React.ReactNode[] = [];
  if (ops === null) lines.push(<span className="break-keep">리뷰 목록 읽기 실패 · 부분 집계</span>);
  if (queue === null) lines.push(<span className="break-keep">문의 목록 읽기 실패 · 부분 집계</span>);
  return lines;
}

/** Sources the number above does not cover — a gap to reconnect, or a read that did not finish. */
function warningLines(co: CustomerOperationsHome, now: Date): React.ReactNode[] {
  const lines: React.ReactNode[] = [];
  const gapChannels = new Set<string>();
  for (const gap of co.gaps.rows) {
    if (gap.channelCode) gapChannels.add(gap.channelCode);
    const types = gap.dataTypes.map(dataTypeKo).join("·") || "자료";
    const since = kstClock(gap.since, now);
    lines.push(
      <>
        <span className="break-keep">
          {channelShort(gap.channelCode ?? gap.channelNameKo) ?? "채널"} {types} {failureShort(gap.reason)}
          {since ? ` · ${since}부터` : ""} 집계 제외
        </span>
        <Link to={gap.to} className="ml-auto font-bold text-warn hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700">
          {COPY.reconnect}
        </Link>
      </>,
    );
  }
  for (const source of co.sources) {
    if (source.completeness === "COMPLETE" || source.completeness === null || gapChannels.has(source.channelCode)) continue;
    const name = `${channelShort(source.channelCode) ?? "채널"} ${dataTypeKo(source.dataType)}`;
    lines.push(
      <span className="break-keep">
        {source.completeness === "NONE"
          ? `${name} ${failureShort(source.failureReason)} · 집계 제외`
          : `${name} 일부만 확인 · ${failureShort(source.failureReason)}`}
      </span>,
    );
  }
  return lines;
}

/**
 * <b>반복 문제 — what repeated, on which product, how often, and why it is worth a look.</b>
 *
 * <p>This used to be one grey line: 「관찰 중 {decidable + observing}」 plus, if any problem happened to have a trend
 * label, that one problem's title. Three things were wrong with it, and only the third is about layout.
 *
 * <ul>
 *   <li><b>It printed a sum under one of its parts' names.</b> {@code decidable} and {@code observing} are two
 *       populations the server returns separately and documents as un-addable; adding them and labelling the total
 *       「관찰 중」 told a seller with one problem 조치 중 and nineteen 관찰 중 that twenty were 관찰 중.</li>
 *   <li><b>Its link went to the list, not to the problem</b>, whenever no trend fired — which is the ordinary case
 *       for a problem that repeated steadily rather than suddenly.</li>
 *   <li><b>It named no product, no evidence and no count.</b> On the org this was measured against, eighteen pieces
 *       of evidence for one problem on one product rendered as 「관찰 중 20 · 보기」.</li>
 * </ul>
 *
 * <p>The rows were already on the wire — {@code ops.problems} is the Operations Home read AgentHome makes anyway,
 * already bounded to three, already ordered decidable-first by the server, already carrying each problem's
 * per-product evidence. Nothing new is read, derived or judged here; the same rows the other Home draws are drawn
 * here, by the same component.
 *
 * <p><b>Still not a task.</b> It sits below 「확인 필요」, has no verb and no button, and states its two counts as the
 * server's own sentence ({@code problemLine}) rather than as a workload. A repeated problem is a pattern over many
 * reviews, not another customer waiting — that separation is the reason one row can stand for eighteen of them
 * without the Home saying the same thing twice.
 */
function RepeatedProblems({ ops, selection }: { ops: OperationsHome | null | undefined; selection?: HomeSelection }) {
  const problems = ops?.problems;
  if (!problems || problems.rows.length === 0) return null;
  const wide = selection?.wide ?? false;
  const search = selection?.search ?? "";
  const selectedId = selection?.selectedKey?.startsWith(PROBLEM) ? selection.selectedKey.slice(PROBLEM.length) : null;
  return (
    <section aria-label="반복 문제">
      <div className="mb-3 mt-8 flex items-center gap-2">
        <h2 className="text-[17px] font-bold tracking-tight text-ink">반복 문제</h2>
      </div>
      <p className="break-keep px-1 leading-relaxed text-ink">{problemLine(problems)}</p>
      <RepeatedProblemList
        rows={problems.rows}
        selectedId={wide ? selectedId : null}
        linkFor={(issueId) => selectionHref(wide, `${PROBLEM}${issueId}`, `/memory/${issueId}`, search)}
      />
      <p className="mt-2 px-1 text-sm">
        <Link
          to="/memory"
          className="font-medium text-brand-700 underline underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700"
        >
          반복 문제 전체 보기
        </Link>
      </p>
    </section>
  );
}
