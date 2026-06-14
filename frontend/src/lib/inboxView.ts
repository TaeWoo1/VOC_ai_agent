// Pure view helpers for the integrated inbox. No React, no I/O — every value is
// derived from the FeedItem fields the backend already returns, so the inbox
// never invents data. Kept out of the page component so the type checker covers
// these shapes (the frontend has no unit-test runner).
import type { FeedItem } from "./types";

export type InboxTabKey =
  | "ALL"
  | "INQUIRY"
  | "REVIEW"
  | "UNANSWERED"
  | "ATTENTION"
  | "RECENT";

export const INBOX_TABS: { key: InboxTabKey; label: string }[] = [
  { key: "ALL", label: "전체" },
  { key: "INQUIRY", label: "문의" },
  { key: "REVIEW", label: "리뷰" },
  { key: "UNANSWERED", label: "미답변" },
  { key: "ATTENTION", label: "주의 리뷰" },
  { key: "RECENT", label: "오늘" },
];

/** A review needing attention: explicitly negative, or rated 2 stars or lower. */
export function isLowOrNegativeReview(item: FeedItem): boolean {
  return (
    item.type === "REVIEW" &&
    (item.status === "NEGATIVE" || (item.rating != null && item.rating <= 2))
  );
}

/** True when the ISO timestamp falls on the operator's local calendar today. */
export function isToday(iso: string | null): boolean {
  if (!iso) {
    return false;
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return false;
  }
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

export function matchesTab(item: FeedItem, key: InboxTabKey): boolean {
  switch (key) {
    case "ALL":
      return true;
    case "INQUIRY":
      return item.type === "INQUIRY";
    case "REVIEW":
      return item.type === "REVIEW";
    case "UNANSWERED":
      return item.type === "INQUIRY" && item.status === "UNANSWERED";
    case "ATTENTION":
      return isLowOrNegativeReview(item);
    case "RECENT":
      return isToday(item.receivedAt);
    default:
      return false;
  }
}

export function tabCount(items: FeedItem[], key: InboxTabKey): number {
  return items.reduce((n, item) => (matchesTab(item, key) ? n + 1 : n), 0);
}

export type ActionTone = "warn" | "bad" | "muted";

/** A short, non-interactive next-action hint for the operator. Visual only —
 *  this slice has no detail route or status mutation. */
export function nextAction(item: FeedItem): { label: string; tone: ActionTone } {
  if (item.type === "INQUIRY") {
    return item.status === "UNANSWERED"
      ? { label: "답변 필요", tone: "warn" }
      : { label: "답변 완료", tone: "muted" };
  }
  // REVIEW
  return isLowOrNegativeReview(item)
    ? { label: "리뷰 확인", tone: "bad" }
    : { label: "확인", tone: "muted" };
}
