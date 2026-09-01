/**
 * The customer's inquiries as ROWS (Query Accuracy v1, 2026-08-28) — 「최근 문의 3개」, 「오늘 들어온 문의」,
 * 「오늘 네이버 문의 중 최근 2개」, 「답변 안 한 것만」.
 *
 * <b>Not the work queue.</b> {@link readInquiryWorkload} answers 「내가 답해야 할 일」 over work-item phases;
 * this step answers "which inquiries came in" over the inquiries themselves, through one backend read
 * (`GET /api/inquiries/rows`) whose every axis is a closed token the planner chose: window · channel ·
 * status · order · limit. Nothing here invents a default the spec did not state — the defaults are named
 * once, below, and disclosed in the artifact's `scope`.
 *
 * <b>One axis is not a closed token, and it is the seller's own word.</b> `term` (`spec.term`) is the
 * subject the sentence named when no closed topic family holds it — 현금영수증, 세금계산서, 파손. It is
 * extracted deterministically by `conversation/subjectTerm.ts` (never by the planner, never by a model)
 * and sent to the backend as one bounded `q`. This is the ONLY sentence-reading this step does, it can
 * only ever narrow, and the narrowing is said back in the seller's own word — so a zero under it is a
 * zero about that subject. Before it existed the word was dropped and the read answered a wider question.
 *
 * <b>A follow-up refines the same read.</b> With `scope=WORKING_SET` over an INQUIRIES set this step
 * re-reads with the previous set's window/channel/status as the base, the new tokens layered on top, then
 * keeps only the rows that were in the set (by inquiry id) before applying order and limit — so 「그중
 * 네이버만」 → 「그중 최근 1개」 → 「답변 안 한 것만」 each stand on the set the seller was looking at.
 */
import type { EvidenceRef, Finding } from "../state/OperatorState";
import type { NeedState } from "../plan/InvestigationPlan";
import type { SpecialistInput } from "./specialistInput";
import { OPERATOR_TOOL } from "../tools/OperatorTools";
import { attemptTool } from "../failure/SpecialistOutcome";
import type { ToolFailure } from "../failure/SpecialistOutcome";
import { eventOn, eventRange, observationDate } from "../scope/EvidenceTime";
import type { Artifact, DateWindow, InquiryItem, InquiryListArtifact, PeriodToken } from "../../conversation/contract";
import type { InquiryRowsParams, InquiryRowsResponse } from "../../spring/types";
import { periodLabel, windowOf } from "../../conversation/period";
import { matchesTopic } from "../tools/inquiryWorkload";
import type { WorkloadTopic } from "../tools/inquiryWorkload";
import { TOPIC_LABEL } from "../../conversation/taskInterpreter";
import { subjectTermOf } from "../../conversation/subjectTerm";
import { log } from "../../log";

/** The most rows a ROWS read fetches when no limit was asked for — the backend page ceiling. */
export const ROWS_PAGE = 50;

export interface RowsRead {
  readonly findings: Finding[];
  readonly evidence: EvidenceRef[];
  readonly artifacts: Artifact[];
  readonly notes: string[];
  readonly failures: ToolFailure[];
  readonly needState: NeedState;
}

type Status = "UNANSWERED" | "ANSWERED" | "ALL";
type Order = "NEWEST" | "OLDEST";

/** The QuerySpec this read executes — resolved from the plan's filters and, on a follow-up, the previous set. */
export interface InquiryRowsSpec {
  readonly window: DateWindow | null;
  readonly channel: string | null;
  readonly status: Status;
  readonly order: Order;
  readonly limit: number | null;
  /**
   * Conversation Core v1: the closed topic family the plan named (「배송 관련만」). Applied in-process
   * over the rows' own subject line and product name — the same `TOPIC_WORDS` table the workload
   * filter uses. Before this axis existed the token died here and a WORKING_SET refine with a topic
   * re-served the previous rows unchanged (PO QA 2026-08-31, failure 1).
   */
  readonly topic: WorkloadTopic | null;
  /**
   * The seller's own subject word (「현금영수증」) — the axis `topic` cannot carry. Read from the
   * sentence by the closed extractor in `conversation/subjectTerm.ts`, never by the planner, and sent
   * to the backend as `q`. This is the one place this step reads the seller's words, and it reads them
   * for exactly one purpose: to narrow by a noun the closed vocabularies do not hold. Before it existed
   * the noun was dropped and the answer was about a wider question than the one that was asked.
   */
  readonly term: string | null;
  readonly previousIds: readonly string[] | null;
  /** On a refine: the order the previous set was read in. The re-read uses it; `order` is applied in-process. */
  readonly baseOrder: Order;
}

export function resolveRowsSpec(input: SpecialistInput): InquiryRowsSpec {
  const filters = input.filters;
  const previous = filters?.scope === "WORKING_SET" && input.workingSet?.kind === "INQUIRIES" ? input.workingSet : null;
  const today = observationDate(input.referenceDate);
  const token: PeriodToken | null = filters?.period ?? previous?.filters.period?.token ?? null;
  // The day count belongs to the token that carries it: taken from the sentence when the sentence named
  // the period, otherwise from the window the previous set was read with.
  const periodDays = filters?.period ? filters.periodDays : previous?.filters.period?.days ?? null;
  const window = token ? windowOf(token, today, periodDays) : previous?.filters.period ?? null;
  const channel = filters?.channel ?? input.channelScope ?? previous?.filters.channelCode ?? null;
  const status: Status = filters?.status ?? previous?.filters.status ?? "ALL";
  const order: Order = filters?.order ?? "NEWEST";
  const limit = filters?.limit ?? null;
  const topic: WorkloadTopic | null = (filters?.topic && filters.topic !== "OTHER" ? filters.topic : null)
    ?? (previous?.filters.topic && previous.filters.topic !== "OTHER" ? previous.filters.topic : null);
  // A topic family already names the subject; a term beside it would narrow the same noun twice and
  // the seller would read back two words for one question.
  const term = topic ? null : subjectTermOf(input.goalText) ?? previous?.filters.term ?? null;
  const baseOrder: Order = previous?.filters.order ?? "NEWEST";
  return { window, channel, status, order, limit, topic, term, previousIds: previous ? [...previous.ids] : null, baseOrder };
}

export async function readInquiryRows(input: SpecialistInput, needId: string): Promise<RowsRead> {
  const { registry, budget, evidence, allowedTools } = input;
  const pending = (reason: string): RowsRead => ({
    findings: [], evidence: [], artifacts: [], notes: [reason], failures: [],
    needState: { id: needId, status: "PENDING", evidenceIds: [] },
  });
  if (!budget.spend("tool")) {
    return pending("문의 목록을 읽기 전에 예산이 끝났습니다.");
  }
  const spec = resolveRowsSpec(input);
  // A follow-up over a set must see every row of that set before it narrows, so the read itself is not
  // limited and is made in the ORDER the set was read in (「최근 3개」 then 「그중 가장 오래된 1개」: the
  // oldest page of 92 holds none of the 3 newest — the base set is reproduced first, re-sorted after);
  // the limit is applied after the intersection. A fresh read hands order and limit to the backend.
  const args: InquiryRowsParams = {
    ...(spec.window ? { from: spec.window.from, to: spec.window.to } : {}),
    ...(spec.channel ? { channel: spec.channel } : {}),
    status: spec.status,
    order: spec.previousIds ? spec.baseOrder : spec.order,
    // A topic is filtered in-process, so the read must not be pre-limited to fewer rows than the
    // filter will inspect — the limit is applied after the topic keeps or drops each row. A TERM is
    // applied by the query itself, so it does not widen the page.
    limit: spec.previousIds || spec.topic ? ROWS_PAGE : spec.limit ?? ROWS_PAGE,
    ...(spec.term ? { q: spec.term } : {}),
  };
  const attempt = await attemptTool(
    { specialist: "INQUIRY_OPS", tool: OPERATOR_TOOL.LIST_INQUIRY_ROWS, needId },
    () => registry.invoke<InquiryRowsResponse>(OPERATOR_TOOL.LIST_INQUIRY_ROWS, { ...args }, allowedTools),
  );
  if (!attempt.ok) {
    return { ...pending("문의 목록을 읽지 못했습니다."), failures: [attempt.failure] };
  }
  const read = attempt.value;
  const previousIds = spec.previousIds ? new Set(spec.previousIds) : null;
  let inSet = previousIds ? read.items.filter((i) => previousIds.has(i.inquiryId)) : read.items;
  // The topic narrows by the row's own words (subject line · product name) — the same closed table the
  // workload filter matches on; a row whose words this table cannot see stays out, which is honest for
  // a filter (the deterministic FILTER lane spends bounded detail reads; this planner path does not).
  if (spec.topic) inSet = inSet.filter((i) => matchesTopic(spec.topic!, [i.title, i.productName]));
  if (previousIds && spec.order !== spec.baseOrder) inSet.reverse();
  const rows = spec.limit != null && (spec.previousIds || spec.topic) ? inSet.slice(0, spec.limit) : inSet;
  // The rows in hand ARE this read's result: a count that arrived beside them can never say less than
  // them, so the rows are the floor of `total` — a zero claim can never stand next to returned rows
  // (the 2026-08-30 live turn answered 「문의는 없습니다」 while a list stood under it).
  const total = Math.max(previousIds || spec.topic ? inSet.length : read.totalCount, rows.length);

  const refs: EvidenceRef[] = [];
  const findings: Finding[] = [];
  const notes: string[] = [];
  const pageRef = evidence.add({
    kind: "INQUIRY",
    sourceTool: OPERATOR_TOOL.LIST_INQUIRY_ROWS,
    args: { from: spec.window?.from ?? null, to: spec.window?.to ?? null, channel: spec.channel, status: spec.status, order: spec.order, limit: spec.limit, term: spec.term },
    locator: { count: total, label: "문의", ...(spec.channel ? { channelCode: spec.channel } : {}) },
    events: spec.window
      ? eventRange(spec.window.from, spec.window.to)
      : rows.length > 0
        ? eventRange(
          rows.map((r) => r.receivedAt.slice(0, 10)).sort()[0]!,
          rows.map((r) => r.receivedAt.slice(0, 10)).sort().at(-1)!,
        )
        : null,
    coverage: "COVERED",
    provenance: `inquiry-rows/${spec.status}:${spec.order}${spec.previousIds ? ":working-set" : ""}`,
  });
  refs.push(pageRef);
  for (const item of rows) {
    refs.push(evidence.add({
      kind: "INQUIRY",
      sourceTool: OPERATOR_TOOL.LIST_INQUIRY_ROWS,
      args: { inquiryId: item.inquiryId },
      locator: {
        inquiryId: item.inquiryId, ...(item.workItemId ? { workItemId: item.workItemId } : {}),
        ...(item.channelCode ? { channelCode: item.channelCode } : {}),
        ...(item.productId ? { productId: item.productId } : {}),
        ...(item.productName ? { productName: item.productName } : {}),
        status: item.status, label: item.status,
      },
      events: eventOn(item.receivedAt.slice(0, 10)),
      coverage: "COVERED",
      provenance: "inquiry-rows/item",
    }));
  }

  const toItem = (i: InquiryRowsResponse["items"][number]): InquiryItem => ({
    workItemId: i.workItemId ?? null, inquiryId: i.inquiryId, channelCode: i.channelCode, channelNameKo: i.channelNameKo,
    receivedAt: i.receivedAt, phase: i.phase ?? "", status: i.status, title: i.title, snippet: i.snippet ?? null,
    productId: i.productId, productName: i.productName, answerBasis: null,
    sourceSubtype: i.sourceSubtype ?? null, executableIdentity: i.executableIdentity ?? "NONE",
    to: `/inquiries/${i.inquiryId}`,
  });
  // The seller asked for an ORDER, so the rows stay in it: consecutive runs of the same answered state
  // become one group each (the group key is what names a row's state on screen), never a re-sort.
  const groups: Array<{ key: "UNANSWERED" | "ANSWERED"; label: string; items: InquiryItem[] }> = [];
  for (const r of rows) {
    const key = r.status === "UNANSWERED" ? "UNANSWERED" : "ANSWERED";
    const last = groups.at(-1);
    if (last && last.key === key) last.items.push(toItem(r));
    else groups.push({ key, label: key === "UNANSWERED" ? "답변 필요" : "답변함", items: [toItem(r)] });
  }

  const title = rowsTitle(spec);
  findings.push({
    findingId: `f-${pageRef.evidenceId}`,
    specialist: "INQUIRY_OPS",
    statement: rowsStatement(spec, rows.length, total),
    evidenceIds: [pageRef.evidenceId],
    confidence: "NEEDS_REVIEW",
    verdict: null,
    surfaceLink: "/inquiries",
    needId,
  });
  const list: InquiryListArtifact = {
    artifactId: `a-${pageRef.evidenceId}`,
    type: "INQUIRY_LIST",
    title,
    groups,
    totalCount: total,
    scope: { period: spec.window, channelCode: spec.channel, status: spec.status, order: spec.order, limit: spec.limit, topic: spec.topic, term: spec.term },
    more: { label: "문의 화면에서 보기", to: "/inquiries", count: total },
  };
  log("inquiry_rows", {
    window: spec.window?.token ?? "NONE", channel: spec.channel ?? "NONE", status: spec.status, order: spec.order,
    limit: spec.limit ?? "NONE", topic: spec.topic ?? "NONE", term: spec.term != null, rows: rows.length, total, workingSet: spec.previousIds != null,
  });
  return {
    findings, evidence: refs, artifacts: [list], notes, failures: [],
    needState: { id: needId, status: "SATISFIED", evidenceIds: refs.map((r) => r.evidenceId) },
  };
}

function statusWord(status: Status): string {
  return status === "UNANSWERED" ? "답변 안 한 " : status === "ANSWERED" ? "답변한 " : "";
}

/** Closed channel vocabulary → seller word. An unknown code produces NO word rather than the token. */
const CHANNEL_WORD: Record<string, string> = { NAVER: "네이버", COUPANG: "쿠팡", CAFE24: "카페24" };

function rowsTitle(spec: InquiryRowsSpec): string {
  const period = spec.window ? `${periodLabel(spec.window.token ?? null, spec.window.days)} ` : "";
  const channel = spec.channel && CHANNEL_WORD[spec.channel.toUpperCase()] ? `${CHANNEL_WORD[spec.channel.toUpperCase()]} ` : "";
  const topic = spec.topic ? `${TOPIC_LABEL[spec.topic]} ` : spec.term ? `${spec.term} 관련 ` : "";
  const which = spec.limit != null ? `${spec.order === "OLDEST" ? "가장 오래된" : "가장 최근"} ${spec.limit}건` : "문의";
  return `${period}${channel}${topic}${statusWord(spec.status)}${which}`.trim();
}

/** The scope of a ROWS list as its artifact carries it — what the headline is built from. */
export interface RowsScopeWords {
  readonly period: DateWindow | null;
  readonly channelCode: string | null;
  readonly status: Status;
  readonly order: Order;
  readonly limit: number | null;
  readonly topic?: WorkloadTopic | null;
  readonly term?: string | null;
}

/**
 * ONE sentence for a ROWS read, shared by the finding and the conversation headline so the two can never
 * say the same fact twice in different words (the zero case has no number for the dedupe rule to match on).
 */
export function inquiryRowsSentence(scope: RowsScopeWords, shown: number, total: number, refine: boolean,
  breakdown: { unanswered: number; answered: number } | null = null): string {
  // The prose and the rows are ONE execution's result. Whatever `total` claims, the rows on screen are
  // the floor of it: 「없습니다」 is only sayable when the same read returned nothing.
  const count = Math.max(total, shown);
  const period = scope.period ? `${periodLabel(scope.period.token ?? null, scope.period.days)} 들어온 ` : "";
  const channel = scope.channelCode && CHANNEL_WORD[scope.channelCode.toUpperCase()] ? `${CHANNEL_WORD[scope.channelCode.toUpperCase()]} ` : "";
  // The seller's own word, said back verbatim: a zero under it is a zero about THAT subject, and a
  // read that could not narrow by it never wears its label.
  const topic = scope.topic ? `${TOPIC_LABEL[scope.topic]} ` : scope.term ? `${scope.term} 관련 ` : "";
  const subject = `${refine ? "방금 본 문의 중 " : ""}${period}${channel}${topic}${statusWord(scope.status)}문의`;
  if (count === 0) return `${subject}는 없습니다.`;
  const which = scope.limit != null && shown < count
    ? ` 그중 ${scope.order === "OLDEST" ? "가장 오래된" : "가장 최근"} ${shown}건입니다.` : "";
  const mix = !which && scope.status === "ALL" && breakdown && breakdown.unanswered > 0 && breakdown.answered > 0
    ? ` (답변 필요 ${breakdown.unanswered}건 · 답변함 ${breakdown.answered}건)` : "";
  return `${subject}는 ${count}건입니다${mix}.${which}`;
}

function rowsStatement(spec: InquiryRowsSpec, shown: number, total: number): string {
  return inquiryRowsSentence(
    { period: spec.window, channelCode: spec.channel, status: spec.status, order: spec.order, limit: spec.limit, topic: spec.topic, term: spec.term },
    shown, total, spec.previousIds != null,
  );
}
