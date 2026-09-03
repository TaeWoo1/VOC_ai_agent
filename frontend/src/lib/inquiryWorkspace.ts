import { elapsedSince } from "./elapsed";
import { productLabel } from "./inquiryProductBinding";
import { WORK_STATE, type WorkStateWord } from "./workState";
import type { FeedItem, InquiryQueueItem, InquiryRowItem } from "./types";

/**
 * <b>The 문의 workspace: what is waiting on the seller, and the record of everything else.</b>
 *
 * Two reads, because they answer two questions and the product already had both:
 *
 * <ul>
 *   <li><b>지금 처리할 일</b> — `GET /api/inquiries?phase=…`, the WORK QUEUE over
 *       `InquiryWorkItem`. Its membership rule is not invented here: `InquiryWorkItemPhase
 *       .AWAITING_SELLER` = {OPEN, PROPOSED} is declared once in the backend as "the phases where the
 *       work is still waiting for the SELLER to decide something", and every recommendation surface
 *       reads it. A phase added later has to be classified there, not guessed at here.</li>
 *   <li><b>전체 문의</b> — `GET /api/inquiries/rows`, the inquiries themselves, filtered server-side
 *       and bounded, with the whole set's count beside the page.</li>
 * </ul>
 *
 * <b>Why not one list.</b> The screen used to read 500 rows and render every one of them in a single
 * column: 94 rows and 7,100px on the demo org, with an answered inquiry from last week at the same
 * weight as the oldest unanswered one, and nothing to search with. A pilot seller with three thousand
 * inquiries would have got three thousand rows. The queue is bounded by how much work exists; the
 * record is bounded by a page and found by searching.
 *
 * <b>The same object may appear in both, and that is not a duplicated fact.</b> A row in the queue is
 * there as WORK; the same row in the record is there as a RECORD. 리뷰 has read this way since Review
 * Approval Path v1 — its 목록 holds all 4,455 including the four in 내 답변 작업.
 */

/** The queue row's state word. Both come from the product's one work vocabulary. */
export function queueRowState(row: Pick<InquiryQueueItem, "hasDraft">): WorkStateWord {
  // 초안 준비됨 is the draft's own answer, never the phase (Operational Workspace UX System v1 §2).
  return row.hasDraft ? WORK_STATE.DRAFT_READY : WORK_STATE.REPLY_NEEDED;
}

/** The record row's state word, from the channel's own answered/unanswered state. */
export function recordRowState(row: Pick<InquiryRowItem, "status">): WorkStateWord {
  return row.status === "ANSWERED" ? WORK_STATE.ANSWERED : WORK_STATE.REPLY_NEEDED;
}

/** Older than a year: real, still open, and not this morning's work. */
export function isOldBacklog(row: { receivedAt: string }, now = new Date()): boolean {
  return elapsedSince(row.receivedAt, now)?.unit === "overYear";
}

/**
 * The queue in the order a seller works it: <b>recent work first, the year-plus backlog after it.</b>
 *
 * Longest-waiting first is the one urgency criterion this product has — `conversation/urgency.ts`
 * says so in as many words — but applied to a whole queue it is the wrong shape, and a previous
 * package measured why: this org's Cafe24 backlog reaches back a decade, and sorted purely worst-first
 * a 2014 question wore the same weight as one from an hour ago and buried it. So the criterion is
 * applied INSIDE two groups rather than across them. The old rows are not hidden, not dropped and not
 * reordered away — they sit under their own quiet divider, which is the same idiom the 문의 list has
 * used since Executive-friendly UX Redesign v1.
 */
export function queueOrder<T extends { receivedAt: string }>(
  rows: readonly T[],
  now = new Date(),
): { recent: T[]; old: T[] } {
  const waiting = (a: T, b: T) => a.receivedAt.localeCompare(b.receivedAt);
  return {
    recent: rows.filter((r) => !isOldBacklog(r, now)).sort(waiting),
    old: rows.filter((r) => isOldBacklog(r, now)).sort(waiting),
  };
}

/**
 * A record row as the detail pane reads it.
 *
 * `InboxDetail` and the analysis index speak `FeedItem`, and every field they need is on the row
 * already — `FeedItem.id` IS the inquiry id, which is why the two ever joined. This is a rename, not
 * a second shape: nothing is computed, defaulted or invented, and a field the row does not carry
 * (a review's rating) stays null rather than acquiring a value.
 */
export function asFeedItem(row: InquiryRowItem): FeedItem {
  return {
    id: row.inquiryId,
    type: "INQUIRY",
    channelId: row.channelId ?? "",
    channelNameKo: row.channelNameKo ?? "",
    // The same placeholder the feed's own backend writes for an unattributed row
    // (`InboxService.UNATTRIBUTED_LABEL`), through the helper this repository already reads it by, so
    // the two paths cannot say different things about the same absence.
    productName: productLabel(row),
    snippet: row.snippet ?? row.title ?? "",
    rating: null,
    status: row.status,
    receivedAt: row.receivedAt,
  };
}

/** The 답변 상태 filter, in the record's own vocabulary. A closed set the server also knows. */
export const RECORD_STATUS_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "ALL", label: "전체" },
  { value: "UNANSWERED", label: "답변 필요" },
  { value: "ANSWERED", label: "답변함" },
];
