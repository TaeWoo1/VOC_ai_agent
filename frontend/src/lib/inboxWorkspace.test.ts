import { describe, expect, it } from "vitest";
import {
  DEFAULT_FILTERS,
  STATE_OPTIONS,
  applyFilters,
  channelOptions,
  isHandled,
  itemTitle,
  matchesPeriod,
  needsCheck,
  needsReply,
  priorityRank,
  resolveSelection,
  sortByPriority,
} from "./inboxWorkspace";
import { buildAnalysisIndex } from "./inboxView";
import type { FeedItem, ItemAnalysis } from "./types";

const NOW = new Date("2026-08-03T12:00:00Z");

function feedItem(over: Partial<FeedItem> & Pick<FeedItem, "id" | "type">): FeedItem {
  return {
    channelNameKo: "채널 가",
    productName: "상품",
    snippet: "내용",
    rating: null,
    status: "NORMAL",
    receivedAt: NOW.toISOString(),
    ...over,
  } as FeedItem;
}

const unanswered = feedItem({ id: "i1", type: "INQUIRY", status: "UNANSWERED" });
const answered = feedItem({ id: "i2", type: "INQUIRY", status: "ANSWERED" });
const negative = feedItem({ id: "r1", type: "REVIEW", status: "NEGATIVE", rating: 1 });
const lowRated = feedItem({ id: "r2", type: "REVIEW", status: "NORMAL", rating: 2 });
const goodReview = feedItem({ id: "r3", type: "REVIEW", status: "NORMAL", rating: 5 });

describe("inbox states — only what the data can say", () => {
  it("offers exactly the three conditions FeedItem expresses", () => {
    // There is no "처리 중" or "보류" anywhere in the feed's vocabulary; offering one would be a
    // filter that can never match.
    expect(STATE_OPTIONS.map((o) => o.value)).toEqual([
      "ALL",
      "NEEDS_REPLY",
      "NEEDS_CHECK",
      "HANDLED",
    ]);
  });

  it("marks an unanswered inquiry as needing a reply", () => {
    expect(needsReply(unanswered)).toBe(true);
    expect(needsReply(answered)).toBe(false);
    expect(needsReply(negative)).toBe(false);
  });

  it("marks negative and low-rated reviews as needing a look", () => {
    expect(needsCheck(negative)).toBe(true);
    expect(needsCheck(lowRated)).toBe(true);
    expect(needsCheck(goodReview)).toBe(false);
  });

  it("never calls a review 'handled' — nothing in the data says so", () => {
    expect(isHandled(answered)).toBe(true);
    expect(isHandled(goodReview)).toBe(false);
    expect(isHandled(negative)).toBe(false);
  });
});

describe("filters", () => {
  const all = [unanswered, answered, negative, lowRated, goodReview];

  it("passes everything through by default", () => {
    expect(applyFilters(all, DEFAULT_FILTERS, NOW)).toHaveLength(all.length);
  });

  it("filters by type", () => {
    expect(applyFilters(all, { ...DEFAULT_FILTERS, type: "INQUIRY" }, NOW)).toEqual([
      unanswered,
      answered,
    ]);
  });

  it("filters by state", () => {
    expect(applyFilters(all, { ...DEFAULT_FILTERS, state: "NEEDS_REPLY" }, NOW)).toEqual([
      unanswered,
    ]);
    expect(applyFilters(all, { ...DEFAULT_FILTERS, state: "NEEDS_CHECK" }, NOW)).toEqual([
      negative,
      lowRated,
    ]);
  });

  it("filters by channel", () => {
    const other = feedItem({ id: "x", type: "REVIEW", channelNameKo: "채널 나" });
    expect(applyFilters([...all, other], { ...DEFAULT_FILTERS, channel: "채널 나" }, NOW)).toEqual([
      other,
    ]);
  });

  it("bounds the period window", () => {
    const old = feedItem({ id: "old", type: "REVIEW", receivedAt: "2026-06-01T00:00:00Z" });
    expect(matchesPeriod(old, "WEEK", NOW)).toBe(false);
    expect(matchesPeriod(old, "ALL", NOW)).toBe(true);
    expect(matchesPeriod(unanswered, "TODAY", NOW)).toBe(true);
  });

  it("keeps a row whose timestamp cannot be parsed rather than hiding it", () => {
    const broken = feedItem({ id: "b", type: "REVIEW", receivedAt: "not-a-date" });
    expect(matchesPeriod(broken, "WEEK", NOW)).toBe(true);
  });
});

describe("channel options — derived from data, never a fixed catalogue", () => {
  it("lists only channels present in the loaded rows, most frequent first", () => {
    const items = [
      feedItem({ id: "1", type: "REVIEW", channelNameKo: "채널 가" }),
      feedItem({ id: "2", type: "REVIEW", channelNameKo: "채널 나" }),
      feedItem({ id: "3", type: "REVIEW", channelNameKo: "채널 나" }),
    ];
    expect(channelOptions(items)).toEqual([
      { value: "채널 나", count: 2 },
      { value: "채널 가", count: 1 },
    ]);
  });

  it("is empty when nothing has arrived", () => {
    expect(channelOptions([])).toEqual([]);
  });
});

describe("priority ordering", () => {
  const urgentAnalysis: ItemAnalysis = {
    sourceType: "INQUIRY",
    sourceId: "i1",
    summary: "요약",
    category: "배송",
    sentiment: "NEGATIVE",
    urgency: "HIGH",
    recommendedAction: "답변 필요",
    analyzerKind: "RULE_BASED",
    analyzerName: "rule-based",
    analyzerVersion: "rules-v1",
    createdAt: NOW.toISOString(),
  };

  it("ranks open work above everything else", () => {
    expect(priorityRank(unanswered)).toBeLessThan(priorityRank(goodReview));
    expect(priorityRank(negative)).toBeLessThan(priorityRank(goodReview));
  });

  it("lets a stored HIGH urgency promote a row that already needs a person", () => {
    expect(priorityRank(unanswered, urgentAnalysis)).toBe(0);
    expect(priorityRank(unanswered)).toBe(1);
  });

  it("never invents urgency for a row nobody has to touch", () => {
    const calm: ItemAnalysis = { ...urgentAnalysis, sourceType: "REVIEW", sourceId: "r3" };
    expect(priorityRank(goodReview, calm)).toBe(3);
  });

  it("sorts worst-first, then newest-first", () => {
    const older = feedItem({
      id: "i9",
      type: "INQUIRY",
      status: "UNANSWERED",
      receivedAt: "2026-08-01T00:00:00Z",
    });
    const sorted = sortByPriority([goodReview, older, unanswered, negative], new Map());
    expect(sorted.map((i) => i.id)).toEqual(["i1", "i9", "r1", "r3"]);
  });

  it("uses the analysis index when ordering", () => {
    const index = buildAnalysisIndex([urgentAnalysis]);
    const sorted = sortByPriority([negative, unanswered], index);
    expect(sorted[0].id).toBe("i1");
  });
});

describe("deep-link selection", () => {
  const all = [unanswered, negative];

  it("reports nothing selected when no row is requested", () => {
    expect(resolveSelection(all, undefined)).toEqual({ kind: "NONE" });
  });

  it("resolves a requested row", () => {
    expect(resolveSelection(all, "r1")).toEqual({ kind: "FOUND", item: negative });
  });

  it("reports a requested row that is not loaded, rather than silently showing nothing", () => {
    expect(resolveSelection(all, "gone")).toEqual({ kind: "MISSING", itemRef: "gone" });
  });

  it("resolves against everything loaded, not the filtered view", () => {
    // A shared link opens its item even when the reader's filters would have hidden it.
    const filtered = applyFilters(all, { ...DEFAULT_FILTERS, type: "INQUIRY" }, NOW);
    expect(filtered).not.toContain(negative);
    expect(resolveSelection(all, "r1").kind).toBe("FOUND");
  });
});

describe("row title", () => {
  it("prefers the product name", () => {
    expect(itemTitle(feedItem({ id: "1", type: "REVIEW", productName: "몰딩" }))).toBe("몰딩");
  });

  it("falls back to the snippet, then to the type — never to an id", () => {
    expect(itemTitle(feedItem({ id: "1", type: "REVIEW", productName: "", snippet: "내용" }))).toBe(
      "내용",
    );
    const bare = itemTitle(feedItem({ id: "abc", type: "INQUIRY", productName: "", snippet: "" }));
    expect(bare).toBe("문의");
    expect(bare).not.toContain("abc");
  });
});
