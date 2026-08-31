/**
 * InquiryOps' WORKLOAD path — the queue as things to do, classified by what each is waiting on.
 *
 * <b>The planner asked for rows; this reads them through one composed tool.</b> `list_inquiry_workload`
 * is two queue pages plus a bounded number of detail reads (`tools/inquiryWorkload.ts`), and every
 * item comes back with a closed group: draft ready, needs a clarification, knowledge missing, or
 * simply unanswered. The seller sees a list they can act on in that order.
 *
 * <b>Three follow-ups, all filters over rows the planner already asked for.</b>
 *  · 「배송 관련부터」 — `scope=WORKING_SET` + `topic`: the previous set's work-item ids, narrowed by
 *    topic (details re-read only for those ids, still under the cap);
 *  · 「문의에서도 같은 얘기 있어?」 from a REVIEWS set — the review rows' product ids anchor the
 *    workload AND a customer-memory search per product, and an empty result is said as an empty result;
 *  · a draft request — the same read, because the target 「첫 번째 거」 is an index into this order.
 *
 * <b>Customer text stays where the tool left it.</b> The title rides on the live artifact for the
 * screen and is stripped before persistence; an evidence ref carries ids, the closed work state, the
 * channel, the product and the receipt date.
 */
import type { EvidenceRef, Finding } from "../state/OperatorState";
import type { NeedState } from "../plan/InvestigationPlan";
import type { SpecialistInput } from "./specialistInput";
import { OPERATOR_TOOL } from "../tools/OperatorTools";
import type { InquiryWorkloadResult } from "../tools/inquiryWorkload";
import { WORKLOAD_DETAIL_CAP } from "../tools/inquiryWorkload";
import { attemptTool } from "../failure/SpecialistOutcome";
import type { ToolFailure } from "../failure/SpecialistOutcome";
import { eventOn } from "../scope/EvidenceTime";
import type { Artifact, InquiryGroupKey, InquiryListArtifact } from "../../conversation/contract";
import type { CustomerMemorySearch } from "../../spring/types";
import { subjectTermOf } from "../../conversation/subjectTerm";
import { rankByUrgency, URGENCY_CRITERION, URGENCY_LIMIT, waitingDaysOf } from "../../conversation/urgency";
import { observationDate } from "../scope/EvidenceTime";
import { log } from "../../log";

const GROUP_ORDER: readonly InquiryGroupKey[] = ["DRAFT_READY", "NEEDS_CLARIFICATION", "KNOWLEDGE_MISSING", "UNANSWERED"];
export const GROUP_LABEL: Record<InquiryGroupKey, string> = {
  DRAFT_READY: "초안 준비됨",
  NEEDS_CLARIFICATION: "규격 확인이 필요한 문의",
  KNOWLEDGE_MISSING: "답변 기준이 없는 문의",
  UNANSWERED: "아직 초안이 없는 문의",
  ANSWERED: "답변함",
};
const MEMORY_PRODUCTS_CAP = 3;

/** Whether the plan asked for the classified queue rather than the count — plan fields only. */
/**
 * Which inquiry read an INQUIRY_VOLUME need is served by (Query Accuracy v1). The planner's closed
 * `inquiryIntent` token decides; the two structural cases that can only stand on work items (a draft or
 * send request, an ordinal target) are WORKLOAD whatever the token says, because a row without a work
 * item has nothing to draft on. With no token at all: a follow-up keeps the kind of the set it refines,
 * and a spec that names any row axis (window · channel · status · order · limit) is a ROWS question —
 * every one of those is a spec FIELD, not a word in the sentence.
 */
export type InquiryIntent = "ROWS" | "WORKLOAD" | "COUNT" | "PRIORITY";

export function inquiryIntentOf(input: SpecialistInput): InquiryIntent {
  const f = input.filters;
  if (input.requestedAction === "PREPARE_INQUIRY_DRAFT" || input.requestedAction === "REQUEST_SEND_APPROVAL") return "WORKLOAD";
  if (input.target && input.target.selector !== "NONE") return "WORKLOAD";
  if (f?.inquiryIntent) return f.inquiryIntent;
  if (f?.scope === "WORKING_SET" && input.workingSet?.kind === "INQUIRIES") {
    return input.workingSet.filters.inquiryIntent ?? "WORKLOAD";
  }
  if (f?.scope === "WORKING_SET" && input.workingSet?.kind === "REVIEWS") return "WORKLOAD";
  // No token (a plan from before v4): the legacy reading, so recorded plans keep their meaning — a
  // period, topic or working-set follow-up was the queue; a status/order/limit could only mean rows.
  if (f && (f.period != null || f.topic != null || f.scope === "WORKING_SET")) return "WORKLOAD";
  if (f && (f.status != null || f.order != null || f.limit != null)) return "ROWS";
  return "COUNT";
}

export interface WorkloadRead {
  readonly findings: Finding[];
  readonly evidence: EvidenceRef[];
  readonly artifacts: Artifact[];
  readonly notes: string[];
  readonly failures: ToolFailure[];
  readonly needState: NeedState;
}

/** How many ranked rows a PRIORITIZE answer names when the seller did not say a number. */
export const PRIORITY_DEFAULT = 3;

/**
 * ONE sentence for a ranked queue, shared by the finding and the conversation headline so the two can
 * never say the same fact in different words — and so the criterion is never dropped as "redundant".
 */
export function urgencySentence(subject: string, total: number, shown: number): string {
  if (total === 0) return `${subject}는 없습니다.`;
  return shown >= total
    ? `${subject} ${total}건을 먼저 볼 순서로 정리했습니다. ${URGENCY_CRITERION}`
    : `${subject} ${total}건 중 먼저 보실 ${shown}건입니다. ${URGENCY_CRITERION}`;
}

export async function readInquiryWorkload(input: SpecialistInput, needId: string, rank = false): Promise<WorkloadRead> {
  const { registry, budget, evidence, allowedTools } = input;
  const pending = (reason: string): WorkloadRead => ({
    findings: [], evidence: [], artifacts: [], notes: [reason], failures: [],
    needState: { id: needId, status: "PENDING", evidenceIds: [] },
  });
  if (!budget.spend("tool")) {
    return pending("문의 목록을 읽기 전에 예산이 끝났습니다.");
  }
  const filters = input.filters;
  const set = filters?.scope === "WORKING_SET" ? input.workingSet ?? null : null;
  const fromInquiries = set?.kind === "INQUIRIES" ? set : null;
  const fromReviews = set?.kind === "REVIEWS" ? set : null;
  const resolvedProduct = input.resolved.find((e) => e.kind === "PRODUCT")?.id ?? null;
  const productIds = fromReviews && fromReviews.productIds.length > 0
    ? [...fromReviews.productIds]
    : resolvedProduct ? [resolvedProduct]
      : fromInquiries && fromInquiries.productIds.length > 0 && !fromInquiries.workItemIds.length ? [...fromInquiries.productIds] : [];
  const workItemIds = fromInquiries ? [...fromInquiries.workItemIds] : [];
  const topic = filters?.topic ?? null;
  // The subject the sentence named when no closed family holds it (`subjectTerm.ts`) — the same axis
  // the ROWS read carries, so 「현금영수증 관련 답해야 할 문의」 narrows here too.
  const term = topic ? null : subjectTermOf(input.goalText);
  // Query Accuracy v1: the spec axes reach the tool by name. A work queue has NO receipt window — what is
  // pending is pending whenever it arrived — so `period` is not an axis here; 「어제 온 문의 중 답해야 할
  // 것」 is a ROWS read with status=UNANSWERED (`inquiryRowsStep`). Channel, order and limit apply.
  const channel = filters?.channel ?? input.channelScope ?? fromInquiries?.filters.channelCode ?? null;
  const order = filters?.order ?? null;
  // A ranked answer names a FEW rows and says why they are first; reading the whole queue and then
  // cutting is what makes 「가장 시급한 건」 answerable at all.
  const limit = filters?.limit ?? null;

  const attempt = await attemptTool(
    { specialist: "INQUIRY_OPS", tool: OPERATOR_TOOL.LIST_INQUIRY_WORKLOAD, needId },
    () => registry.invoke<InquiryWorkloadResult>(
      OPERATOR_TOOL.LIST_INQUIRY_WORKLOAD,
      {
        ...(productIds.length > 0 ? { productIds } : {}),
        ...(workItemIds.length > 0 ? { workItemIds } : {}),
        ...(topic ? { topic } : {}),
        ...(term ? { term } : {}),
        ...(channel ? { channel } : {}),
        ...(rank ? {} : {
          ...(order ? { order } : {}),
          ...(limit != null ? { limit } : {}),
        }),
        maxDetailReads: WORKLOAD_DETAIL_CAP,
      },
      allowedTools,
    ),
  );
  if (!attempt.ok) {
    return { ...pending("문의 목록을 읽지 못했습니다."), failures: [attempt.failure] };
  }
  const read = attempt.value;
  // The composed tool spent detail reads on the run's behalf; they are charged after the fact because
  // the cap is what bounds them, and a budget that could not see them would be blind to half the read.
  for (let i = 0; i < read.detailReads; i += 1) {
    if (!budget.spend("tool")) break;
  }

  const refs: EvidenceRef[] = [];
  const findings: Finding[] = [];
  const notes: string[] = [];
  const failures: ToolFailure[] = [];
  const pageRef = evidence.add({
    kind: "INQUIRY",
    sourceTool: OPERATOR_TOOL.LIST_INQUIRY_WORKLOAD,
    args: { products: productIds.length, ids: workItemIds.length, topic: topic ?? null },
    locator: { count: read.items.length, label: "답변이 필요한 문의" },
    events: read.items.length > 0
      ? { from: read.items[0]!.receivedAt.slice(0, 10), to: read.items[read.items.length - 1]!.receivedAt.slice(0, 10) }
      : null,
    coverage: "COVERED",
    provenance: `inquiry-workload/${topic ?? "ALL"}${set ? ":working-set" : ""}`,
  });
  refs.push(pageRef);
  for (const item of read.items) {
    refs.push(evidence.add({
      kind: "INQUIRY",
      sourceTool: OPERATOR_TOOL.LIST_INQUIRY_WORKLOAD,
      args: { workItemId: item.workItemId },
      locator: {
        workItemId: item.workItemId, inquiryId: item.inquiryId,
        ...(item.channelCode ? { channelCode: item.channelCode } : {}),
        ...(item.productId ? { productId: item.productId } : {}),
        ...(item.productName ? { productName: item.productName } : {}),
        phase: item.phase, status: item.status, label: item.group,
      },
      events: eventOn(item.receivedAt.slice(0, 10)),
      coverage: "COVERED",
      provenance: "inquiry-workload/item",
    }));
  }

  const today = observationDate(input.referenceDate);
  // PRIORITIZE: the queue in urgency order, cut to the few rows the answer names. The criterion and its
  // limit are said in the prose — a ranking whose basis is not stated is a judgement the data cannot back.
  const shown = rank
    ? rankByUrgency(read.items).slice(0, Math.max(1, limit ?? PRIORITY_DEFAULT))
    : read.items;
  const toItem = (i: (typeof read.items)[number]) => ({
    workItemId: i.workItemId, inquiryId: i.inquiryId, channelCode: i.channelCode, channelNameKo: i.channelNameKo,
    receivedAt: i.receivedAt, phase: i.phase, status: i.status, title: i.title, snippet: i.snippet,
    productId: i.productId, productName: i.productName, answerBasis: i.answerBasis,
    sourceSubtype: i.sourceSubtype, executableIdentity: i.executableIdentity,
    ...(rank ? { waitingDays: waitingDaysOf(i.receivedAt, today) } : {}),
    to: `/inquiries/${i.inquiryId}`,
  });
  // A ranked answer keeps the RANK as its order: consecutive rows of the same work state become one
  // group each (each row still reads its own state word), never a re-sort into state buckets.
  const groups = rank
    ? shown.reduce<Array<{ key: InquiryGroupKey; label: string; items: ReturnType<typeof toItem>[] }>>((acc, i) => {
      const last = acc.at(-1);
      if (last && last.key === i.group) last.items.push(toItem(i));
      else acc.push({ key: i.group, label: GROUP_LABEL[i.group], items: [toItem(i)] });
      return acc;
    }, [])
    : GROUP_ORDER
      .map((key) => ({ key, label: GROUP_LABEL[key], items: read.items.filter((i) => i.group === key).map(toItem) }))
      .filter((g) => g.items.length > 0);
  const counts = rank ? "" : groups.map((g) => `${g.label} ${g.items.length}건`).join(" · ");
  const narrowed = topic ? `${topicLabel(topic)} 관련 ` : term ? `${term} 관련 ` : "";
  const subject = fromReviews ? "같은 상품에 대한 미답변 문의" : `${narrowed}답변이 필요한 문의`;
  const rankedStatement = urgencySentence(subject, read.items.length, shown.length);
  findings.push({
    findingId: `f-${pageRef.evidenceId}`,
    specialist: "INQUIRY_OPS",
    statement: rank
      ? rankedStatement
      : read.items.length === 0
        ? `${subject}는 없습니다.`
        : fromInquiries
          ? `방금 본 ${fromInquiries.count}건 중 ${subject}는 ${read.items.length}건입니다${counts ? ` (${counts})` : ""}.`
          : `${subject}가 ${read.items.length}건 있습니다${counts ? ` (${counts})` : ""}.`,
    evidenceIds: [pageRef.evidenceId],
    confidence: "NEEDS_REVIEW",
    verdict: null,
    surfaceLink: "/inquiries?state=NEEDS_REPLY",
    needId,
  });
  if (rank && read.items.length > 0) notes.push(URGENCY_LIMIT);
  if (read.truncated) {
    notes.push(`초안이 있는 문의 중 ${read.detailReads}건까지만 답변 근거를 확인했습니다. 나머지는 초안 준비됨으로 표시했습니다.`);
  }
  const artifacts: Artifact[] = [];
  const list: InquiryListArtifact = {
    artifactId: `a-${pageRef.evidenceId}`,
    type: "INQUIRY_LIST",
    title: rank ? `${narrowed}먼저 볼 문의` : subject,
    groups,
    totalCount: rank ? shown.length : read.items.length,
    scope: {
      period: null, channelCode: channel, status: "UNANSWERED", order: order ?? "OLDEST",
      limit: rank ? shown.length : limit, ...(term ? { term } : {}), ...(rank ? { rank: "URGENCY" as const } : {}),
    },
    more: { label: "문의 화면에서 처리하기", to: "/inquiries?state=NEEDS_REPLY", count: read.totalOpen + read.totalProposed },
    ...(read.truncated ? { note: notes.filter((n) => n !== URGENCY_LIMIT).join(" ") } : {}),
  };
  artifacts.push(list);

  // ── Cross-domain from a REVIEWS set: what customer memory holds for those products, too.
  if (fromReviews && productIds.length > 0) {
    for (const productId of productIds.slice(0, MEMORY_PRODUCTS_CAP)) {
      if (!budget.spend("tool")) break;
      const memory = await attemptTool(
        { specialist: "INQUIRY_OPS", tool: OPERATOR_TOOL.SEARCH_CUSTOMER_MEMORY, needId },
        () => registry.invoke<CustomerMemorySearch>(
          OPERATOR_TOOL.SEARCH_CUSTOMER_MEMORY, { productId, limit: 3 }, allowedTools,
        ),
      );
      if (!memory.ok) { failures.push(memory.failure); continue; }
      for (const hit of memory.value.hits.slice(0, 3)) {
        const ref = evidence.add({
          kind: "CUSTOMER_MEMORY",
          sourceTool: OPERATOR_TOOL.SEARCH_CUSTOMER_MEMORY,
          args: { productId },
          locator: {
            productId, ...(hit.productName ? { productName: hit.productName } : {}),
            ...(hit.channelCode ? { channelCode: hit.channelCode } : {}),
            label: hit.signatureKey ?? hit.topic ?? "과거 사례",
          },
          events: eventOn(hit.occurredOn),
          coverage: memory.value.coverage.coverage,
          provenance: `${memory.value.coverage.provenance}/${hit.retrieverKind}:${hit.retrieverVersion}`,
        });
        refs.push(ref);
        findings.push({
          findingId: `f-${ref.evidenceId}`,
          specialist: "INQUIRY_OPS",
          statement: `${hit.productName ?? "이 상품"}에 "${hit.signatureKey ?? hit.topic}" 유형의 과거 문의 기록이 있습니다`
            + `${hit.occurredOn ? ` (${hit.occurredOn})` : ""}.`,
          evidenceIds: [ref.evidenceId],
          confidence: "NEEDS_REVIEW",
          verdict: null,
          surfaceLink: "/memory",
          needId,
        });
      }
    }
  }

  log("inquiry_workload", { items: read.items.length, shown: shown.length, rank, queued: read.queued,
    detailReads: read.detailReads, truncated: read.truncated, topic: topic ?? "NONE", term: term != null,
    workingSet: set?.kind ?? "NONE", products: productIds.length });
  return {
    findings, evidence: refs, artifacts, notes, failures,
    needState: { id: needId, status: "SATISFIED", evidenceIds: refs.map((r) => r.evidenceId) },
  };
}

function topicLabel(topic: NonNullable<SpecialistInput["filters"]>["topic"]): string {
  switch (topic) {
    case "SHIPPING": return "배송";
    case "EXCHANGE_RETURN": return "교환·반품";
    case "PRODUCT_SPEC": return "규격";
    case "USAGE": return "사용법";
    default: return "기타";
  }
}
