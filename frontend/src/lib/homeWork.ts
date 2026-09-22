import { REASON, reasonOfCase, sourceLabel, waitSince, DRAFT_UNSENT, type Reason } from "./copy/customerOps";
import { subjectFallback } from "./customerOperations";
import { isOldBacklog as isOldInquiryBacklog } from "./inquiryWorkspace";
import type { CustomerOperationsDecisionRow, CustomerOperationsHome } from "./customerOperationsTypes";
import type { InquiryQueueResponse, OperationsHome, ReviewWorkView } from "./types";

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
  /**
   * The screen that owns the customer item — the dedupe key this list is built on, kept on the row.
   *
   * Deliberately not the same field as `to`: a case OPENS its own case screen while being ABOUT an inquiry, so the
   * two differ exactly where it matters. It is carried because another section of the same Home has to be able to
   * ask 「is this already in 확인 필요?」, and the only honest way to ask is with the key this list deduped by.
   */
  owner: string;
  caseId: string | null;
  verb: string;
  /**
   * What the row is, so the master-detail pane can draw it in place (UI/UX v2 Phase 1). Carried, never derived from
   * `to`: parsing our own URLs back into ids is the kind of second source that drifts.
   */
  kind: "CASE" | "REVIEW" | "INQUIRY";
  /**
   * What the row is ABOUT — a case's stored `subjectKind`, or the item itself. Carried for the 확인할 일 filter
   * (UI/UX v2 Phase 4), which must not parse `owner` back into a noun.
   */
  subject: "INQUIRY" | "REVIEW";
  /** The id the pane opens: the case, the review, or the inquiry. */
  subjectId: string;
  /** For an inquiry row, the work item its response panel is addressed by. */
  workItemId: string | null;
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
    owner: row.to,
    caseId: row.caseId,
    verb: reason === REASON.info ? "정보 입력" : "검토",
    kind: "CASE",
    subject: row.subjectKind,
    subjectId: row.caseId,
    workItemId: null,
  };
}

export function mergeHomeWork(
  co: CustomerOperationsHome | null | undefined,
  ops: OperationsHome | null | undefined,
  queue: InquiryQueueResponse | null | undefined,
  now: Date = new Date(),
  /**
   * The review half, whole (UI/UX v2 Phase 3). When present it replaces the Home's three-row slice of undecided
   * 확인 필요 reviews with all of them, and adds the seller's own reply work still before approval — the items the
   * 리뷰 screen's 「내 답변 작업」 used to be the only place for. Absent (a failed read, an older caller), the list is
   * what it was.
   */
  reviewWork?: ReviewWorkView | null,
): HomeWork {
  const byOwner = new Map<string, HomeWorkRow>();
  const settled = new Set<string>((co?.handled.rows ?? []).map((r) => r.to));
  let truncated = false;

  for (const row of co?.decisions.rows ?? []) {
    byOwner.set(row.to, caseWorkRow(row));
  }
  if (co && co.decisions.total > co.decisions.rows.length) truncated = true;

  const attentionRows = reviewWork ? reviewWork.attention : ops?.reviews.rows ?? [];
  for (const row of attentionRows) {
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
      owner,
      caseId: null,
      verb: "검토",
      kind: "REVIEW",
      subject: "REVIEW",
      subjectId: row.reviewId,
      workItemId: null,
    });
  }

  if (reviewWork && reviewWork.attentionTotal > reviewWork.attention.length) truncated = true;

  // The seller's own reply work before approval. A decided review is not in the undecided list above, so the two
  // never describe one review twice; a case about it still wins, by the same owner key.
  for (const account of reviewWork?.committed ?? []) {
    for (const item of account.todo) {
      if (!item.reviewId) continue;
      const owner = `/reviews/reply/${item.reviewId}`;
      if (byOwner.has(owner) || settled.has(owner)) continue;
      const awaiting = item.replyWorkState === "AWAITING_APPROVAL";
      byOwner.set(owner, {
        key: `review:${item.reviewId}`,
        reason: awaiting ? REASON.approve : REASON.draft,
        source: sourceLabel(item.channelCode ?? account.channelCode, "REVIEW", item.rating),
        title: item.safePreview?.trim() || "본문 없는 리뷰",
        line: [awaiting ? `초안 있음 · ${DRAFT_UNSENT}` : "대응 필요로 정함 · 답변 초안 없음", item.productName]
          .filter(Boolean)
          .join(" · "),
        since: item.sourceCreatedDate,
        to: owner,
        owner,
        caseId: null,
        verb: "검토",
        kind: "REVIEW",
        subject: "REVIEW",
        subjectId: item.reviewId,
        workItemId: null,
      });
    }
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
      owner,
      caseId: null,
      verb: "검토",
      kind: "INQUIRY",
      subject: "INQUIRY",
      subjectId: row.inquiryId,
      workItemId: row.workItemId,
    });
  }
  if (queue && queue.totalElements > queue.content.length) truncated = true;

  const rows = [...byOwner.values()].sort(
    (a, b) => Number(isOldBacklog(a, now)) - Number(isOldBacklog(b, now)) || waitSince(a.since) - waitSince(b.since),
  );
  return { rows, truncated };
}

/**
 * Whether this row is year-plus backlog — <b>the 문의 화면's rule, read here rather than restated.</b>
 *
 * <p>Longest-waiting-first is the one urgency criterion this product has, and applied across a whole list it is the
 * wrong shape: measured on this org, the Home's five briefed rows were five Cafe24 questions from 2016 — 「3838일
 * 대기」 — while the case Reviewnary investigated last night, the three reviews it flagged and the inquiry that
 * arrived this month all sat under 「+22」. A briefing whose visible half is a decade old answers 「오늘 무엇을
 * 해야 하는가」 with 「2016년에 놓친 것」.
 *
 * <p>So the criterion is applied INSIDE two groups instead of across them, exactly as `/inquiries` has since
 * Operational Workspace UX System v1 — {@link isOldBacklog} is that screen's own predicate, imported so the two
 * lists cannot disagree about which rows are this morning's work. <b>Nothing is hidden, dropped or reordered
 * away</b>: the old rows keep their place in the same single list, after the recent ones, and the counts above
 * still count all of them.
 *
 * <p>A row with no timestamp is not backlog: absence of a date is not evidence of age.
 */
export function isOldBacklog(row: HomeWorkRow, now: Date): boolean {
  return row.since != null && isOldInquiryBacklog({ receivedAt: row.since }, now);
}

/** 「교환·환불 1」, 「정보 부족 1」… — the reasons of the rows drawn, in a fixed order, zeros left out. */
export function reasonCounts(rows: HomeWorkRow[]): string[] {
  const order: Reason[] = [REASON.exchange, REASON.info, REASON.reply, REASON.review, REASON.approve, REASON.draft, REASON.withheld];
  return order
    .map((reason) => [reason.tag, rows.filter((r) => r.reason.tag === reason.tag).length] as const)
    .filter(([, n]) => n > 0)
    .map(([tag, n]) => `${tag} ${n}`);
}

/**
 * <b>확인할 일's filters</b> (UI/UX v2 Phase 4) — views of the one list, never a second list. Each is a predicate over
 * facts the row already carries (what it is about, and the reason tag it was given); none of them ranks, and the
 * order inside a filter is the list's own.
 */
export const WORK_FILTERS = [
  { key: "all", label: "전체", test: () => true },
  { key: "inquiry", label: "문의 답변", test: (r: HomeWorkRow) => r.subject === "INQUIRY" },
  {
    key: "review",
    label: "리뷰 확인",
    test: (r: HomeWorkRow) => r.subject === "REVIEW" && r.reason !== REASON.approve && r.reason !== REASON.draft,
  },
  { key: "approve", label: "승인 대기", test: (r: HomeWorkRow) => r.reason === REASON.approve },
  { key: "draft", label: "초안 필요", test: (r: HomeWorkRow) => r.reason === REASON.draft },
] as const;

export type WorkFilterKey = (typeof WORK_FILTERS)[number]["key"];

export function workFilterOf(value: string | null): WorkFilterKey {
  return WORK_FILTERS.find((f) => f.key === value)?.key ?? "all";
}
