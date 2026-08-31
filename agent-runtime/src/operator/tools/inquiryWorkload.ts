/**
 * `list_inquiry_workload` — the queue, classified, over reads the product already makes.
 *
 * <b>A composition of existing READs, not a new endpoint.</b> One page each of `phase=OPEN` and
 * `phase=PROPOSED`, then a bounded number of `GET /api/inquiries/{workItemId}` reads to learn what
 * a PROPOSED item's draft rests on. OPEN items need no detail read: OPEN means no draft, which is the
 * whole classification for them. That is what keeps the read bounded — the detail cap is spent only
 * on rows that have something to learn.
 *
 * <b>The topic filter is a data FILTER over rows the planner already asked for; it is not intent
 * routing.</b> The planner decided the seller wants 「배송 관련」 (`filters.topic = SHIPPING`) and this
 * table narrows rows to that topic by their own subject line. Customer text is read in-process for
 * that one comparison and never logged, never persisted, never placed in an evidence ref — the row
 * that leaves this function carries the title only so a live screen can name the inquiry, and the
 * persisted form strips it (`persistableArtifact`).
 */
import type { SpringClient } from "../../spring/SpringClient";
import type { ExecutableIdentity, InquiryDetail, InquiryQueueItem } from "../../spring/types";
import type { InquiryGroupKey, PlanFilters } from "../../conversation/contract";

/** How many detail reads one workload read may spend. Bounded and disclosed (`truncated`). */
export const WORKLOAD_DETAIL_CAP = 8;
const QUEUE_PAGE = 100;

export type WorkloadTopic = NonNullable<PlanFilters["topic"]>;

/**
 * The closed Korean keyword table per topic. Deliberately small and literal — a word missed here
 * leaves a row in the queue, which is the safe direction for a filter. Exported so the conversation's
 * visible-set selection reads the SAME table instead of keeping a third copy of the topic vocabulary.
 */
export const TOPIC_WORDS: Record<WorkloadTopic, readonly string[]> = {
  SHIPPING: ["배송", "택배", "도착", "발송", "언제 와", "언제와"],
  EXCHANGE_RETURN: ["교환", "반품", "환불", "취소"],
  PRODUCT_SPEC: ["규격", "사이즈", "mm", "cm", "크기", "용량", "가닥"],
  USAGE: ["사용", "설치", "붙이", "부착"],
  OTHER: [],
};

export interface InquiryWorkloadItem {
  readonly workItemId: string;
  readonly inquiryId: string;
  readonly sellerAccountId: string;
  readonly channelCode: string | null;
  readonly channelNameKo: string | null;
  readonly productId: string | null;
  readonly productName: string | null;
  readonly phase: string;
  readonly status: string;
  readonly receivedAt: string;
  readonly group: InquiryGroupKey;
  readonly answerBasis: string | null;
  /** NAVER subtype (`NAVER_PRODUCT_QNA` / `NAVER_CUSTOMER_INQUIRY`); null for a single-source channel or an older backend. */
  readonly sourceSubtype: string | null;
  /** Backend-decided; absent on the row ⇒ NONE (fail closed — a label is not a binding). */
  readonly executableIdentity: ExecutableIdentity;
  /** The seller-visible subject line — transient; a live screen shows it, persistence drops it. */
  readonly title: string | null;
  /** Whether a detail read informed this classification (false ⇒ phase-only). */
  readonly detailRead: boolean;
}

export interface InquiryWorkloadResult {
  readonly items: InquiryWorkloadItem[];
  /** Rows in the two queue pages BEFORE any filter — the size of what was looked at. */
  readonly queued: number;
  /** Backend totals for the two phases, so a capped page is visible as capped. */
  readonly totalOpen: number;
  readonly totalProposed: number;
  readonly detailReads: number;
  /** True when more PROPOSED rows existed than the detail cap could classify by basis. */
  readonly truncated: boolean;
  readonly topic: WorkloadTopic | null;
}

export interface InquiryWorkloadArgs {
  readonly productIds?: readonly string[];
  readonly workItemIds?: readonly string[];
  readonly topic?: WorkloadTopic | null;
  /** Narrow to one channel (closed code). A data filter over rows already read, not routing. */
  readonly channel?: string | null;
  readonly maxDetailReads?: number;
  /** Query Accuracy v1: receipt window (inclusive ISO dates), order and row limit — applied to the rows read. */
  readonly from?: string | null;
  readonly to?: string | null;
  readonly order?: "NEWEST" | "OLDEST" | null;
  readonly limit?: number | null;
}

/** Does this row's own subject (and body, when read) fall under the topic? */
export function matchesTopic(topic: WorkloadTopic, texts: readonly (string | null | undefined)[]): boolean {
  const words = TOPIC_WORDS[topic];
  if (words.length === 0) {
    // OTHER: rows that match no named topic.
    return !(Object.keys(TOPIC_WORDS) as WorkloadTopic[])
      .filter((t) => t !== "OTHER")
      .some((t) => matchesTopic(t, texts));
  }
  const haystack = texts.filter((t): t is string => typeof t === "string").join("\n").toLowerCase();
  return words.some((w) => haystack.includes(w.toLowerCase()));
}

/** The classification of one item from its phase and (when read) its draft's answer basis. */
export function classify(phase: string, detail: InquiryDetail | null): { group: InquiryGroupKey; answerBasis: string | null } {
  const draft = detail?.draft ?? null;
  if (phase === "OPEN" && !draft) {
    return { group: "UNANSWERED", answerBasis: null };
  }
  const basis = draft?.answerBasis ?? null;
  if (basis === "NEEDS_CLARIFICATION") return { group: "NEEDS_CLARIFICATION", answerBasis: basis };
  if (basis === "NO_ANSWER_BASIS") return { group: "KNOWLEDGE_MISSING", answerBasis: basis };
  // A PROPOSED item has an AI draft by the phase's own meaning; a basis it did not record is a
  // draft that is ready to be read, not one that is missing.
  return { group: "DRAFT_READY", answerBasis: basis ?? (draft ? "GROUNDED" : null) };
}

export async function listInquiryWorkload(
  client: SpringClient,
  args: InquiryWorkloadArgs,
): Promise<InquiryWorkloadResult> {
  const [open, proposed] = await Promise.all([
    client.listInquiries({ phase: "OPEN", page: 0, size: QUEUE_PAGE }),
    client.listInquiries({ phase: "PROPOSED", page: 0, size: QUEUE_PAGE }),
  ]);
  const cap = Math.max(0, Math.min(args.maxDetailReads ?? WORKLOAD_DETAIL_CAP, WORKLOAD_DETAIL_CAP));
  const productIds = args.productIds && args.productIds.length > 0 ? new Set(args.productIds) : null;
  const workItemIds = args.workItemIds && args.workItemIds.length > 0 ? new Set(args.workItemIds) : null;
  const topic = args.topic ?? null;

  const channel = args.channel ? args.channel.toUpperCase() : null;
  const from = args.from ?? null;
  const to = args.to ?? null;
  const oldestFirst = args.order !== "NEWEST";
  const all: InquiryQueueItem[] = [...open.content, ...proposed.content]
    .filter((r) => !channel || (r.channelCode ?? "").toUpperCase() === channel)
    .filter((r) => !from || r.receivedAt.slice(0, 10) >= from)
    .filter((r) => !to || r.receivedAt.slice(0, 10) <= to)
    .filter((r) => !workItemIds || workItemIds.has(r.workItemId))
    .filter((r) => !productIds || (r.productId != null && productIds.has(r.productId)))
    .sort((a, b) => oldestFirst ? a.receivedAt.localeCompare(b.receivedAt) : b.receivedAt.localeCompare(a.receivedAt));
  const rows = args.limit != null && args.limit >= 1 ? all.slice(0, args.limit) : all;

  let detailReads = 0;
  let truncated = false;
  const items: InquiryWorkloadItem[] = [];
  for (const row of rows) {
    let detail: InquiryDetail | null = null;
    if (row.phase !== "OPEN") {
      if (detailReads < cap) {
        detailReads += 1;
        try {
          detail = await client.getInquiryDetail(row.workItemId);
        } catch {
          // One unreadable detail costs that row its basis and nothing else: it is classified by phase.
          detail = null;
        }
      } else {
        truncated = true;
      }
    }
    if (topic && !matchesTopic(topic, [row.title, detail?.title, detail?.details])) {
      continue;
    }
    const { group, answerBasis } = classify(row.phase, detail);
    items.push({
      workItemId: row.workItemId,
      inquiryId: row.inquiryId,
      sellerAccountId: row.sellerAccountId,
      channelCode: row.channelCode ?? detail?.channelCode ?? null,
      channelNameKo: row.channelNameKo ?? detail?.channelNameKo ?? null,
      productId: row.productId ?? detail?.productId ?? null,
      productName: row.productName ?? detail?.productName ?? null,
      phase: row.phase,
      status: row.status,
      receivedAt: row.receivedAt,
      group,
      answerBasis,
      sourceSubtype: row.sourceSubtype ?? detail?.sourceSubtype ?? null,
      executableIdentity: row.executableIdentity ?? detail?.executableIdentity ?? "NONE",
      title: row.title ?? detail?.title ?? null,
      detailRead: detail != null,
    });
  }
  return {
    items,
    queued: open.content.length + proposed.content.length,
    totalOpen: open.totalElements,
    totalProposed: proposed.totalElements,
    detailReads,
    truncated,
    topic,
  };
}
