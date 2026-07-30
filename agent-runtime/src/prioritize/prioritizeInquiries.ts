/**
 * Inquiry prioritization — deterministic, pure, no clock, no LLM.
 *
 * The backend has no per-inquiry priority concept (confirmed by audit); ranking is
 * therefore new orchestration logic and lives here, in the runtime, not in a rewritten
 * domain rule. Policy for this slice: **oldest-waiting first** — an unanswered inquiry
 * that has been open longest is the most urgent to answer. Ties break by `workItemId`
 * ascending so the order is stable and reproducible (a property the tests pin).
 *
 * No wall-clock read: rank is derived purely from the `receivedAt` already on each row.
 * A coarse, sanitized `priorityBucket` (rank-relative) is attached for observability;
 * it never encodes an exact timestamp.
 */
import type { InquiryQueueItem } from "../spring/types";

export type PriorityBucket = "top" | "high" | "normal";

export interface RankedInquiry {
  readonly item: InquiryQueueItem;
  readonly rank: number; // 1-based; 1 = highest priority
  readonly priorityBucket: PriorityBucket;
}

/** Compare by receivedAt asc (oldest first), then workItemId asc for stability. */
function compare(a: InquiryQueueItem, b: InquiryQueueItem): number {
  if (a.receivedAt < b.receivedAt) return -1;
  if (a.receivedAt > b.receivedAt) return 1;
  if (a.workItemId < b.workItemId) return -1;
  if (a.workItemId > b.workItemId) return 1;
  return 0;
}

function bucketFor(rank: number): PriorityBucket {
  if (rank === 1) return "top";
  if (rank <= 3) return "high";
  return "normal";
}

/** Rank a page of queue rows. Input is not mutated (a copy is sorted). */
export function prioritizeInquiries(items: readonly InquiryQueueItem[]): RankedInquiry[] {
  const sorted = [...items].sort(compare);
  return sorted.map((item, i) => ({ item, rank: i + 1, priorityBucket: bucketFor(i + 1) }));
}

/** The single highest-priority row, or null when the queue is empty. */
export function selectTop(ranked: readonly RankedInquiry[]): RankedInquiry | null {
  return ranked.length > 0 ? ranked[0]! : null;
}
