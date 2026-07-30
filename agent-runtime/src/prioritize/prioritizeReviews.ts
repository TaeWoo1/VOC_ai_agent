/**
 * Review prioritization — deterministic, pure, no clock, no LLM.
 *
 * Mirrors the inquiry policy: **oldest-waiting first** — a review the operator has committed
 * to reply to (RESPONSE_NEEDED) that has waited longest is the most urgent. The only ordering
 * signal on a reply-work row is `sourceCreatedDate` (a KST date-only string, or null when the
 * source carried no usable date); nulls sort LAST (an undated row is not evidence of urgency).
 * Ties — and every undated row — break by `actionRef` ascending so the order is stable and
 * reproducible (a property the tests pin).
 *
 * No wall-clock read: rank derives purely from the row's own `sourceCreatedDate`. A coarse,
 * sanitized `priorityBucket` (rank-relative) is attached for observability; it encodes no
 * timestamp and no content.
 */
import type { ReviewWorkItem } from "../spring/types";

export type PriorityBucket = "top" | "high" | "normal";

export interface RankedReview {
  readonly item: ReviewWorkItem;
  readonly rank: number; // 1-based; 1 = highest priority
  readonly priorityBucket: PriorityBucket;
}

/** Oldest sourceCreatedDate first (nulls last), then actionRef asc for stability. */
function compare(a: ReviewWorkItem, b: ReviewWorkItem): number {
  const ad = a.sourceCreatedDate;
  const bd = b.sourceCreatedDate;
  if (ad !== bd) {
    if (ad == null) return 1; // a undated → after b
    if (bd == null) return -1; // b undated → after a
    return ad < bd ? -1 : 1; // ISO date strings sort lexically
  }
  if (a.actionRef < b.actionRef) return -1;
  if (a.actionRef > b.actionRef) return 1;
  return 0;
}

function bucketFor(rank: number): PriorityBucket {
  if (rank === 1) return "top";
  if (rank <= 3) return "high";
  return "normal";
}

/** Rank a reply worklist. Input is not mutated (a copy is sorted). */
export function prioritizeReviews(items: readonly ReviewWorkItem[]): RankedReview[] {
  const sorted = [...items].sort(compare);
  return sorted.map((item, i) => ({ item, rank: i + 1, priorityBucket: bucketFor(i + 1) }));
}

/**
 * The highest-priority row the agent can still PREPARE: the oldest review with no reply
 * preparation yet (`hasReplyPreparation === false`). A review that already has a draft or a
 * standing approval is skipped — it is either awaiting the human's guided post (approved) or
 * already started, so re-selecting it would strand the operator on one review while the rest
 * of the worklist stays unreachable, and re-approving an approved review is a backend
 * conflict. Returns null when every worklist row is already prepared (or the list is empty);
 * the caller distinguishes those two cases from the ranked length for an honest status.
 */
export function selectTopReview(ranked: readonly RankedReview[]): RankedReview | null {
  return ranked.find((r) => !r.item.hasReplyPreparation) ?? null;
}
