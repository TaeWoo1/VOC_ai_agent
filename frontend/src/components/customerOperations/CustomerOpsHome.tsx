import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Btn } from "../ui/Btn";
import { DecisionList, DecisionRow } from "../ui/DecisionRow";
import { WorkFlowCard } from "../ui/WorkFlowCard";
import { RepeatedProblemList } from "../home/RepeatedProblemList";
import { PreparedWorkList } from "../home/PreparedWorkList";
import { api } from "../../lib/apiClient";
import { problemLine } from "../../lib/operationsHome";
import { dataTypeKo, kstClock } from "../../lib/customerOperations";
import { COPY, DRAFT_UNSENT, channelShort, failureShort, kstLongDate, waitLabel } from "../../lib/copy/customerOps";
import { mergeHomeWork, reasonCounts, type HomeWork } from "../../lib/homeWork";
import type { CustomerOperationsHome } from "../../lib/customerOperationsTypes";
import type { InquiryQueueResponse, OperationsHome } from "../../lib/types";

/** How many rows the list shows before 「+N」. */
export const HOME_ROWS = 5;
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
}: {
  co: CustomerOperationsHome;
  ops: OperationsHome | null | undefined;
  now?: Date;
  onChanged: () => void;
}) {
  const [queue, setQueue] = useState<InquiryQueueResponse | null | undefined>(undefined);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api
      .getInquiryQueueStrict({ size: HOME_QUEUE_SIZE })
      .then((r) => live && setQueue(r))
      .catch(() => live && setQueue(null));
    return () => {
      live = false;
    };
  }, []);

  const work = mergeHomeWork(co, ops, queue, now);
  const shown = expanded ? work.rows : work.rows.slice(0, HOME_ROWS);
  const hidden = work.rows.length - shown.length;
  const caseIds = work.rows.map((r) => r.caseId).filter((id): id is string => id !== null);
  const next = co.status === "ACTIVE" ? kstClock(co.nextCheckAt, now) : null;
  const running = co.status === "ACTIVE" || co.status === "PAUSED";

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

  return (
    <div className="space-y-5 pb-2">
      <header>
        <h1 className="text-[25px] font-extrabold leading-tight tracking-tight text-ink">{COPY.homeTitle}</h1>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-muted">
          <span>{kstLongDate(now)}</span>
          <Link
            to="/customer-operations"
            className={`inline-flex items-center gap-1.5 rounded-full py-0.5 pl-2 pr-2.5 text-xs font-semibold hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 ${pill.cls}`}
          >
            <span aria-hidden="true" className={`h-[7px] w-[7px] rounded-full ${pill.dot}`} />
            {pill.label}
          </Link>
          {co.status === "ACTIVE" ? (
            <span className="tabular-nums">
              {cadenceShort(co.cadenceMinutes)}
              {next ? ` · 다음 확인 ${next}` : ""}
            </span>
          ) : null}
        </p>
      </header>

      {running && co.status === "ACTIVE" ? (
        <WorkFlowCard
          ariaLabel="자동 확인과 내 확인 필요"
          done={doneCell(co)}
          mine={
            work.rows.length > 0
              ? {
                  label: COPY.mineLabel,
                  value: `${work.rows.length}${work.truncated ? "+" : ""}`,
                  unit: "건",
                  line: <Items parts={reasonCounts(work.rows)} />,
                }
              : { label: COPY.mineLabel, value: COPY.none, line: next ? <span>다음 확인 {next}</span> : undefined }
          }
          warnings={[...lastRunLines(co, now), ...warningLines(co, now), ...failedReads(ops, queue)]}
        />
      ) : (
        <section
          aria-label={pill.label}
          className="flex flex-wrap items-center gap-3 rounded-[16px] bg-surface px-6 py-5 shadow-[0_0_0_1px_#E4E7EC]"
        >
          <p className="text-base font-bold text-ink">{co.status === "PAUSED" ? COPY.paused : COPY.off}</p>
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
          <div className="mb-3 mt-8 flex items-center gap-2">
            <h2 className="text-[17px] font-bold tracking-tight text-ink">{COPY.listTitle}</h2>
            <span className="rounded-full bg-[#E6E9ED] px-2 text-xs font-semibold leading-[21px] text-muted">{COPY.listOrder}</span>
          </div>
          <DecisionList ariaLabel={COPY.listTitle}>
            {shown.map((row, i) => (
              <DecisionRow
                key={row.key}
                tone={row.reason.tone}
                icon={row.reason.icon}
                tag={row.reason.tag}
                source={row.source}
                title={row.title}
                line={row.line}
                wait={waitLabel(row.since, now)}
                verb={row.verb}
                primary={i === 0}
                to={row.to}
                state={row.caseId ? { caseIds } : undefined}
              />
            ))}
          </DecisionList>
          {hidden > 0 ? (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="mt-2 w-full rounded-lg py-2 text-sm font-semibold text-muted hover:bg-canvas hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700"
            >
              +{hidden.toLocaleString("ko-KR")}
            </button>
          ) : null}
          {/* The Home is a briefing, so it is read short on purpose — but 「더 있다」 with nowhere to go is the one
              thing it must not say. The queue is the same list, unbriefed. */}
          {work.truncated && hidden === 0 ? (
            <p className="mt-2 text-sm">
              <Link
                to="/customer-operations/cases"
                className="font-medium text-brand-700 underline underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700"
              >
                전체 목록 보기
              </Link>
            </p>
          ) : null}
        </section>
      ) : null}

      <AwaitingExecution ops={ops} work={work} />
      <RepeatedProblems ops={ops} />
    </div>
  );
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
function AwaitingExecution({ ops, work }: { ops: OperationsHome | null | undefined; work: HomeWork }) {
  const prepared = ops?.prepared;
  if (!prepared) return null;

  // Anything 확인 필요 is already offering is not offered again, by the same key that list deduped itself with.
  // In practice this is the inquiry-draft kind: a draft-ready inquiry is AWAITING_SELLER, so the work queue above
  // is already showing it — with 「초안 있음 · 미발송」 on the row, which says more than a second row here would.
  const claimed = new Set(work.rows.map((row) => row.owner));
  const rows = prepared.rows.filter((row) => !claimed.has(row.to));
  if (rows.length === 0) return null;

  // The server caps its list; the counts above it are org-wide. Only the review-reply kind is compared, because it
  // is the only one this section never expects to lose rows to the dedupe above — inferring a remainder for the
  // others would be counting the rows we deliberately dropped as missing.
  const drawnReplies = rows.filter((row) => row.kind === "REVIEW_REPLY").length;
  const moreReplies = prepared.reviewRepliesApproved - drawnReplies;

  return (
    <section aria-label="실행 대기">
      <div className="mb-3 mt-8 flex items-center gap-2">
        <h2 className="text-[17px] font-bold tracking-tight text-ink">실행 대기</h2>
        <span className="rounded-full bg-[#E6E9ED] px-2 text-xs font-semibold leading-[21px] text-muted">
          승인함 · 등록 전
        </span>
      </div>
      <PreparedWorkList rows={rows} />
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
      {parts.map((part, i) => (
        <span key={i} className="whitespace-nowrap">
          {i > 0 ? <span aria-hidden="true" className="mr-1.5">·</span> : null}
          {part}
        </span>
      ))}
    </>
  );
}

function cadenceShort(minutes: number): string {
  return minutes > 0 && minutes % 60 === 0 ? `${minutes / 60}시간 주기` : `${minutes}분 주기`;
}

/**
 * The left cell. 「확인」 counts what was read — never what was processed. It is the last 24 hours, not the last run:
 * a failed latest run does not un-check what earlier runs checked, so the tally stays and the failure is said beside it
 * ({@link lastRunLines}) — what that run could not read is the part the number does not cover.
 */
function doneCell(co: CustomerOperationsHome) {
  const label = COPY.checkedLabel;
  if (!co.lastCheckedAt) return { label, value: COPY.firstCheck, phrase: true };
  const h = co.handled;
  const parts: React.ReactNode[] = [
    `정리 ${h.autoResolved.toLocaleString("ko-KR")}`,
    `관찰 ${h.monitoring.toLocaleString("ko-KR")}`,
    <Link key="d" to="/customer-operations" className="font-semibold text-muted underline decoration-[#D5DAE1] underline-offset-4 hover:text-ink">
      초안 {h.draftsPrepared.toLocaleString("ko-KR")} ({DRAFT_UNSENT})
    </Link>,
  ];
  if (h.verifying > 0) parts.push(`처리 확인 중 ${h.verifying.toLocaleString("ko-KR")}`);
  return h.checked != null
    ? { label, value: h.checked.toLocaleString("ko-KR"), unit: "건", line: <Items parts={parts} /> }
    : { label, value: "확인 완료", phrase: true, line: <Items parts={parts} /> };
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
function RepeatedProblems({ ops }: { ops: OperationsHome | null | undefined }) {
  const problems = ops?.problems;
  if (!problems || problems.rows.length === 0) return null;
  return (
    <section aria-label="반복 문제">
      <div className="mb-3 mt-8 flex items-center gap-2">
        <h2 className="text-[17px] font-bold tracking-tight text-ink">반복 문제</h2>
      </div>
      <p className="break-keep px-1 leading-relaxed text-ink">{problemLine(problems)}</p>
      <RepeatedProblemList rows={problems.rows} />
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
