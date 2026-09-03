import { WORK_STATE, type WorkStateWord } from "./workState";
import type { OperatorVocItem, ReviewReplyWorkState } from "./types";

/**
 * What the seller is being asked to do with one review they committed to.
 *
 * <b>Why this is a separate word from everything already on the row.</b> A reply-work row carried
 * three chips before this one and none of them answered the seller's question. 미답변 is what the
 * CHANNEL said at the last import; 기타 is a stored keyword classification of what the review is
 * about; 답변함으로 기록 is what the operator reported afterwards. A seller scanning the list to find
 * the review waiting on their approval could read all three and still not know which row that was.
 *
 * The words are instructions, not statuses, and 승인됨 deliberately is not 완료: the next step after
 * an approval happens in the seller center, which this product does not observe.
 */
export const REPLY_WORK_WORD: Record<ReviewReplyWorkState, WorkStateWord> = {
  DRAFT_NEEDED: WORK_STATE.DRAFT_NEEDED,
  AWAITING_APPROVAL: WORK_STATE.AWAITING_APPROVAL,
  APPROVED: WORK_STATE.APPROVED,
};

/** Kept for callers that only render text. The words themselves live in `lib/workState.ts`. */
export const REPLY_WORK_STATE_LABEL: Record<ReviewReplyWorkState, string> = {
  DRAFT_NEEDED: WORK_STATE.DRAFT_NEEDED.text,
  AWAITING_APPROVAL: WORK_STATE.AWAITING_APPROVAL.text,
  APPROVED: WORK_STATE.APPROVED.text,
};

/**
 * Presentation order: what is waiting on the seller comes first.
 *
 * A row whose draft is written and unapproved is the only one where a single press finishes the
 * seller's part, so it leads. 승인됨 sinks — its remaining step is outside this product, and leaving
 * it at the top is how a worklist fills with rows that need nothing.
 */
const RANK: Record<ReviewReplyWorkState, number> = {
  AWAITING_APPROVAL: 0,
  DRAFT_NEEDED: 1,
  APPROVED: 2,
};

/** The label for a row, or null when the row cannot carry reply work (a null state is not a state). */
export function replyWorkStateLabel(state: ReviewReplyWorkState | null | undefined): string | null {
  return state ? REPLY_WORK_STATE_LABEL[state] : null;
}

/** The word AND its tone, for a row that draws the state rather than just naming it. */
export function replyWorkStateWord(state: ReviewReplyWorkState | null | undefined): WorkStateWord | null {
  return state ? REPLY_WORK_WORD[state] : null;
}

/**
 * The worklist in the order a seller reads it. Stable: rows within one state keep the server's own
 * order, so this re-ranks and never re-sorts. A row with no state keeps its place at the end — an
 * unknown is not promoted, and it is not dropped either.
 */
export function byReplyWorkState<T extends Pick<OperatorVocItem, "replyWorkState">>(rows: readonly T[]): T[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const ra = a.row.replyWorkState ? RANK[a.row.replyWorkState] : 3;
      const rb = b.row.replyWorkState ? RANK[b.row.replyWorkState] : 3;
      return ra === rb ? a.index - b.index : ra - rb;
    })
    .map(({ row }) => row);
}

/**
 * How many rows are waiting on the seller right now — the one number the section heading may carry.
 *
 * Only {@code AWAITING_APPROVAL}: a heading that counted everything would say 「3건」 over a list where
 * two of them are already approved and one is not written yet, which is a number the seller cannot act
 * on. Zero is not rendered as 「0건」 anywhere; the caller drops the hint.
 */
export function awaitingApprovalCount<T extends Pick<OperatorVocItem, "replyWorkState">>(rows: readonly T[]): number {
  return rows.filter((r) => r.replyWorkState === "AWAITING_APPROVAL").length;
}
