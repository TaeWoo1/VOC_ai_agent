// Pure view logic for the customer inbox workspace. No React, no I/O.
//
// Everything here is derived from fields the server already returns. The inbox never invents a
// state, a channel, or a priority it cannot point at — which is why the state filter offers only
// the three conditions `FeedItem` can actually express, and the channel filter is built from the
// loaded rows rather than from a fixed channel list (a fixed list would read as a support claim).

import type { FeedItem, ItemAnalysis } from "./types";
import { analysisKey, isLowOrNegativeReview } from "./inboxView";

export type TypeFilter = "ALL" | "INQUIRY" | "REVIEW";
export type StateFilter = "ALL" | "NEEDS_REPLY" | "NEEDS_CHECK" | "HANDLED";
export type PeriodFilter = "ALL" | "TODAY" | "WEEK" | "MONTH";

export interface InboxFilters {
  type: TypeFilter;
  state: StateFilter;
  period: PeriodFilter;
  /** A `channelNameKo` present in the loaded rows, or null for every channel. */
  channel: string | null;
}

export const DEFAULT_FILTERS: InboxFilters = {
  type: "ALL",
  state: "ALL",
  period: "ALL",
  channel: null,
};

export const TYPE_OPTIONS: ReadonlyArray<{ value: TypeFilter; label: string }> = [
  { value: "ALL", label: "전체" },
  { value: "INQUIRY", label: "문의" },
  { value: "REVIEW", label: "리뷰" },
];

/**
 * Only the three conditions the data can actually state.
 *
 * `FeedItem.status` is UNANSWERED/ANSWERED for an inquiry and NEGATIVE/NORMAL for a review. There
 * is no "처리 중" or "보류" anywhere in that vocabulary, so offering one would be a filter that can
 * never match — a control that quietly lies about what the product tracks.
 */
export const STATE_OPTIONS: ReadonlyArray<{ value: StateFilter; label: string }> = [
  { value: "ALL", label: "전체" },
  { value: "NEEDS_REPLY", label: "답변 필요" },
  { value: "NEEDS_CHECK", label: "확인 필요" },
  { value: "HANDLED", label: "답변함" },
];

export const PERIOD_OPTIONS: ReadonlyArray<{ value: PeriodFilter; label: string }> = [
  { value: "ALL", label: "전체 기간" },
  { value: "TODAY", label: "오늘" },
  { value: "WEEK", label: "최근 7일" },
  { value: "MONTH", label: "최근 30일" },
];

/** An inquiry the seller has not answered. */
export function needsReply(item: FeedItem): boolean {
  return item.type === "INQUIRY" && item.status === "UNANSWERED";
}

/** A review the seller should look at: explicitly negative, or rated 2 stars or lower. */
export function needsCheck(item: FeedItem): boolean {
  return isLowOrNegativeReview(item);
}

/** An inquiry the channel reports as answered. Reviews are never "handled" — nothing says so. */
export function isHandled(item: FeedItem): boolean {
  return item.type === "INQUIRY" && item.status === "ANSWERED";
}

export function matchesState(item: FeedItem, state: StateFilter): boolean {
  switch (state) {
    case "ALL":
      return true;
    case "NEEDS_REPLY":
      return needsReply(item);
    case "NEEDS_CHECK":
      return needsCheck(item);
    case "HANDLED":
      return isHandled(item);
    default:
      return true;
  }
}

const PERIOD_DAYS: Record<Exclude<PeriodFilter, "ALL">, number> = {
  TODAY: 1,
  WEEK: 7,
  MONTH: 30,
};

export function matchesPeriod(item: FeedItem, period: PeriodFilter, now = new Date()): boolean {
  if (period === "ALL") {
    return true;
  }
  const received = new Date(item.receivedAt);
  if (Number.isNaN(received.getTime())) {
    // An unparseable timestamp is kept rather than hidden: dropping a row because its date is
    // malformed would silently shrink the operator's queue.
    return true;
  }
  const elapsedDays = (now.getTime() - received.getTime()) / 86_400_000;
  return elapsedDays >= 0 && elapsedDays <= PERIOD_DAYS[period];
}

export function applyFilters(
  items: readonly FeedItem[],
  filters: InboxFilters,
  now = new Date(),
): FeedItem[] {
  return items.filter(
    (item) =>
      (filters.type === "ALL" || item.type === filters.type) &&
      matchesState(item, filters.state) &&
      matchesPeriod(item, filters.period, now) &&
      (filters.channel === null || item.channelNameKo === filters.channel),
  );
}

export interface ChannelOption {
  value: string;
  count: number;
}

/**
 * Channel filter options, built from the loaded rows only.
 *
 * A hard-coded channel list on this control would tell the seller which marketplaces the product
 * supports — a claim the capability record does not back. What is here is only what arrived.
 */
export function channelOptions(items: readonly FeedItem[]): ChannelOption[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const name = item.channelNameKo?.trim();
    if (name) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

/**
 * Worst-first ordering.
 *
 * Rank 0 is anything the stored analysis marked urgent AND that still needs a person; then
 * unanswered inquiries, then reviews to look at, then everything else. Ties break on recency. The
 * analysis only ever PROMOTES a row that already needs attention — it never invents urgency for a
 * row nobody has to touch.
 */
export function priorityRank(item: FeedItem, analysis?: ItemAnalysis): number {
  const open = needsReply(item) || needsCheck(item);
  if (open && analysis?.urgency === "HIGH") {
    return 0;
  }
  if (needsReply(item)) {
    return 1;
  }
  if (needsCheck(item)) {
    return 2;
  }
  return 3;
}

export function sortByPriority(
  items: readonly FeedItem[],
  index: Map<string, ItemAnalysis>,
): FeedItem[] {
  return [...items].sort((a, b) => {
    const rankDiff =
      priorityRank(a, index.get(analysisKey(a.type, a.id))) -
      priorityRank(b, index.get(analysisKey(b.type, b.id)));
    if (rankDiff !== 0) {
      return rankDiff;
    }
    return Date.parse(b.receivedAt) - Date.parse(a.receivedAt);
  });
}

export type SelectionState =
  /** No row requested — the reader has not picked one yet. */
  | { kind: "NONE" }
  /** The requested row is loaded. */
  | { kind: "FOUND"; item: FeedItem }
  /** A row was requested by URL but is not in the loaded set. */
  | { kind: "MISSING"; itemRef: string };

/**
 * Resolves the deep-linked row against everything loaded — not against the filtered view, so a
 * shared link still opens its item when the reader's filters would have hidden it.
 */
export function resolveSelection(
  items: readonly FeedItem[],
  itemRef: string | undefined,
): SelectionState {
  if (!itemRef) {
    return { kind: "NONE" };
  }
  const item = items.find((candidate) => candidate.id === itemRef);
  return item ? { kind: "FOUND", item } : { kind: "MISSING", itemRef };
}

/** Headline for a row. Falls back through the fields that exist; never renders an id. */
export function itemTitle(item: FeedItem): string {
  const product = item.productName?.trim();
  if (product) {
    return product;
  }
  const snippet = item.snippet?.trim();
  return snippet || (item.type === "INQUIRY" ? "문의" : "리뷰");
}

export const TYPE_LABEL: Record<FeedItem["type"], string> = {
  INQUIRY: "문의",
  REVIEW: "리뷰",
};
