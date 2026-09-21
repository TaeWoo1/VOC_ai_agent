import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Btn } from "../ui/Btn";
import { DecisionList, DecisionRow } from "../ui/DecisionRow";
import { WorkFlowCard } from "../ui/WorkFlowCard";
import { RepeatedProblemList } from "../home/RepeatedProblemList";
import { api } from "../../lib/apiClient";
import { problemLine } from "../../lib/operationsHome";
import { dataTypeKo, kstClock } from "../../lib/customerOperations";
import { COPY, DRAFT_UNSENT, channelShort, failureShort, kstLongDate, waitLabel } from "../../lib/copy/customerOps";
import { mergeHomeWork, reasonCounts } from "../../lib/homeWork";
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
 * <b>Home (Customer Operations v3.1)</b>: a title line, 「자동 확인 → 내 확인 필요」, the one 「확인 필요」 list, and
 * 「반복 문제」 — the patterns, stated below the work and never added to it. Nothing here decides, sends or resolves;
 * every row opens the screen that does.
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

  const work = mergeHomeWork(co, ops, queue);
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

      <RepeatedProblems ops={ops} />
    </div>
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
