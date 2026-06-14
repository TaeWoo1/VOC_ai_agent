// Pure view helpers for the integrated inbox. No React, no I/O — every value is
// derived from the FeedItem fields the backend already returns, so the inbox
// never invents data. Kept out of the page component so the type checker covers
// these shapes (the frontend has no unit-test runner).
import type { FeedItem, ItemAnalysis } from "./types";

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

// --- Stored rule-based item analysis (read-only display) ---
//
// The analysis comes from GET /api/item-analysis as a flat list. We index it by
// (sourceType, sourceId) so each inbox card can look up its own analysis. This is
// display-only enrichment: it never re-derives or overrides anything — the
// backend rule-based analyzer is the single source of truth.

export type ChipTone = "good" | "warn" | "bad" | "neutral";

/** Composite join key matching FeedItem (type,id) to ItemAnalysis (sourceType,sourceId). */
export function analysisKey(sourceType: string, sourceId: string): string {
  return `${sourceType}:${sourceId}`;
}

export function buildAnalysisIndex(list: ItemAnalysis[]): Map<string, ItemAnalysis> {
  const index = new Map<string, ItemAnalysis>();
  for (const a of list) {
    index.set(analysisKey(a.sourceType, a.sourceId), a);
  }
  return index;
}

const URGENCY_KO: Record<string, { label: string; tone: ChipTone }> = {
  HIGH: { label: "높음", tone: "bad" },
  NORMAL: { label: "보통", tone: "warn" },
  LOW: { label: "낮음", tone: "neutral" },
};

const SENTIMENT_KO: Record<string, { label: string; tone: ChipTone }> = {
  POSITIVE: { label: "긍정", tone: "good" },
  NEUTRAL: { label: "중립", tone: "neutral" },
  NEGATIVE: { label: "부정", tone: "bad" },
};

export function urgencyChip(urgency: string): { label: string; tone: ChipTone } {
  return URGENCY_KO[urgency] ?? { label: urgency, tone: "neutral" };
}

export function sentimentChip(sentiment: string): { label: string; tone: ChipTone } {
  return SENTIMENT_KO[sentiment] ?? { label: sentiment, tone: "neutral" };
}

const URGENCY_ACTION_TONE: Record<string, ActionTone> = {
  HIGH: "bad",
  NORMAL: "warn",
  LOW: "muted",
};

/** The single most important action chip for the collapsed card. When a stored
 *  analysis exists, its recommendedAction is the operator's next step (toned by
 *  urgency); otherwise fall back to the item-level nextAction. Keeps the card
 *  action-first so an operator sees what to do without expanding. */
export function primaryAction(
  item: FeedItem,
  analysis?: ItemAnalysis,
): { label: string; tone: ActionTone } {
  if (analysis) {
    return {
      label: analysis.recommendedAction,
      tone: URGENCY_ACTION_TONE[analysis.urgency] ?? "muted",
    };
  }
  return nextAction(item);
}

// --- Workload summary strip + action filter ---
//
// A small "what's on my plate" strip above the feed: counts of the operator
// actions across the loaded inbox. All derived in the frontend from the items +
// joined analyses already loaded — no new API, no backend change. The action
// filter is a single optional label that composes with the tab + channel filters.

/** Attention reviews aren't an action label — they're a status (negative / ≤2★),
 *  so the strip carries them under this distinct key. */
export const ATTENTION_KEY = "주의 리뷰";

const WORK_ORDER = ["답변 필요", "확인 필요", "상세페이지 개선 후보", "FAQ 후보", ATTENTION_KEY];

const WORK_TONE: Record<string, ChipTone> = {
  "답변 필요": "warn",
  "확인 필요": "neutral",
  "상세페이지 개선 후보": "bad",
  "FAQ 후보": "neutral",
  [ATTENTION_KEY]: "bad",
};

export interface WorkloadChip {
  label: string;
  count: number;
  tone: ChipTone;
}

/** One item's contribution to the strip: its primary-action label, plus the
 *  attention-review flag (an item can be both, e.g. a negative review whose
 *  recommended action is "상세페이지 개선 후보"). */
function workLabelsFor(item: FeedItem, analysis?: ItemAnalysis): string[] {
  const labels = [primaryAction(item, analysis).label];
  if (isLowOrNegativeReview(item)) {
    labels.push(ATTENTION_KEY);
  }
  return labels;
}

/** Does an item belong under the active action/status filter? `null` = no filter. */
export function workItemMatches(
  item: FeedItem,
  analysis: ItemAnalysis | undefined,
  filter: string | null,
): boolean {
  if (!filter) {
    return true;
  }
  return workLabelsFor(item, analysis).includes(filter);
}

/** Counts for the strip, in a fixed order, omitting zero-count chips. */
export function workloadSummary(
  items: FeedItem[],
  index: Map<string, ItemAnalysis>,
): WorkloadChip[] {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const analysis = index.get(analysisKey(item.type, item.id));
    for (const label of workLabelsFor(item, analysis)) {
      counts[label] = (counts[label] ?? 0) + 1;
    }
  }
  return WORK_ORDER.filter((l) => (counts[l] ?? 0) > 0).map((l) => ({
    label: l,
    count: counts[l],
    tone: WORK_TONE[l] ?? "neutral",
  }));
}
