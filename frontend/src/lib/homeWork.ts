import { REASON, reasonOfCase, sourceLabel, waitSince, DRAFT_UNSENT, type Reason } from "./copy/customerOps";
import { subjectFallback } from "./customerOperations";
import type { CustomerOperationsDecisionRow, CustomerOperationsHome } from "./customerOperationsTypes";
import type { InquiryQueueResponse, OperationsHome } from "./types";

/**
 * <b>「확인 필요」 on the Home — one list, not three</b> (Customer Operations v3.1).
 *
 * Three reads each know part of what is waiting for the seller: the cases 고객 운영 관리 opened and left for a
 * decision, the reviews the triage marked 「지금 확인」, and the inquiry work queue. The Home used to draw them as
 * three areas, so the same inquiry could appear twice under two names.
 *
 * <b>Identity is the screen that owns the thing.</b> A case row's `to`, a review row's `/reviews/reply/{id}` and a
 * queue row's `/inquiries/{id}` are the same string when they are the same customer item — the backend builds all
 * three from the subject id — so that string is the dedupe key. A case wins over the raw item it is about (it carries
 * the investigation), and anything a case already settled (`handled`) is not re-offered as work.
 *
 * <b>Counts are what was drawn.</b> When a read failed its rows are simply absent, and when a read returned fewer rows
 * than it knows exist the list says so (`truncated`) instead of passing its length off as the total.
 */
export interface HomeWorkRow {
  key: string;
  reason: Reason;
  source: string;
  title: string;
  line: string | null;
  since: string | null;
  /** Where the row opens: the case screen for a case, the owning screen otherwise. */
  to: string;
  caseId: string | null;
  verb: string;
}

export interface HomeWork {
  rows: HomeWorkRow[];
  truncated: boolean;
}

/**
 * One case, as a row of waiting work — <b>the only place a case becomes a row.</b> The Home's briefing and the queue
 * screen both call this, so a case reads the same way in the list the seller is briefed with and the list they work
 * through; a second mapping would be a second opinion about what this case is.
 *
 * <p>An inquiry and a review are not branched on here. What the row says comes from the decision the case carries
 * (recommended action, what is missing, whether a draft stands) — `subjectKind` only chooses the noun in `source`,
 * and the tag it gives a case that named no action type (see `reasonOfCase`).
 *
 * <p>The one line falls through what the case actually knows, most specific first: what it is missing, what an
 * investigation concluded, <b>what the review lane prepared</b>, and — last — the rule's line about why the subject
 * is here at all. `recommendedAction` sits above `reasonNote` because 「이 상품에서 「…」 문제가 3건 확인됐습니다」
 * tells the seller something 「낮은 별점에 내용이 있는 새 리뷰입니다」 does not; below `summary` because a summary is
 * a conclusion and a recommendation is what to do about one.
 */
export function caseWorkRow(row: CustomerOperationsDecisionRow): HomeWorkRow {
  const reason = reasonOfCase(row.recommendedActionType, row.missingInformation, row.subjectKind);
  const missing = row.missingInformation.length > 0 ? `${row.missingInformation.join(", ")} 필요` : null;
  const line = [
    row.draftPrepared ? `초안 있음 · ${DRAFT_UNSENT}` : null,
    missing ?? row.summary ?? row.recommendedAction ?? row.reasonNote,
  ]
    .filter(Boolean)
    .join(" · ");
  return {
    key: `case:${row.caseId}`,
    reason,
    source: sourceLabel(row.channelNameKo, row.subjectKind, row.rating),
    title: row.title?.trim() || row.summary || subjectFallback(row.subjectKind),
    line: line || null,
    since: row.openedAt,
    to: `/customer-operations/cases/${row.caseId}`,
    caseId: row.caseId,
    verb: reason === REASON.info ? "정보 입력" : "검토",
  };
}

export function mergeHomeWork(
  co: CustomerOperationsHome | null | undefined,
  ops: OperationsHome | null | undefined,
  queue: InquiryQueueResponse | null | undefined,
): HomeWork {
  const byOwner = new Map<string, HomeWorkRow>();
  const settled = new Set<string>((co?.handled.rows ?? []).map((r) => r.to));
  let truncated = false;

  for (const row of co?.decisions.rows ?? []) {
    byOwner.set(row.to, caseWorkRow(row));
  }
  if (co && co.decisions.total > co.decisions.rows.length) truncated = true;

  for (const row of ops?.reviews.rows ?? []) {
    const owner = `/reviews/reply/${row.reviewId}`;
    if (byOwner.has(owner) || settled.has(owner)) continue;
    byOwner.set(owner, {
      key: `review:${row.reviewId}`,
      reason: REASON.review,
      source: sourceLabel(row.channelCode, "REVIEW", row.rating),
      title: row.quote?.trim() || "본문 없는 리뷰",
      line: row.productName,
      since: row.occurredOn,
      to: owner,
      caseId: null,
      verb: "검토",
    });
  }

  for (const row of queue?.content ?? []) {
    const owner = `/inquiries/${row.inquiryId}`;
    if (byOwner.has(owner) || settled.has(owner)) continue;
    byOwner.set(owner, {
      key: `inquiry:${row.inquiryId}`,
      reason: REASON.reply,
      source: sourceLabel(row.channelCode ?? row.channelNameKo, "INQUIRY"),
      title: row.title?.trim() || row.snippet?.trim() || subjectFallback("INQUIRY"),
      line: row.hasDraft ? `초안 있음 · ${DRAFT_UNSENT}` : "답변 초안 없음",
      since: row.receivedAt,
      to: owner,
      caseId: null,
      verb: "검토",
    });
  }
  if (queue && queue.totalElements > queue.content.length) truncated = true;

  const rows = [...byOwner.values()].sort((a, b) => waitSince(a.since) - waitSince(b.since));
  return { rows, truncated };
}

/** 「교환·환불 1」, 「정보 부족 1」… — the reasons of the rows drawn, in a fixed order, zeros left out. */
export function reasonCounts(rows: HomeWorkRow[]): string[] {
  const order: Reason[] = [REASON.exchange, REASON.info, REASON.reply, REASON.review, REASON.withheld];
  return order
    .map((reason) => [reason.tag, rows.filter((r) => r.reason.tag === reason.tag).length] as const)
    .filter(([, n]) => n > 0)
    .map(([tag, n]) => `${tag} ${n}`);
}
