// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { buildWeeklyReport } from "./reportView";
import { buildInquiryToday } from "./todayInbox";
import type { FeedItem, InboxResponse } from "./types";

/**
 * 홈과 리포트는 같은 org 데이터에서 같은 수를 인쇄한다.
 *
 * <b>This is the test that did not exist, and its absence is why the defect shipped.</b>
 * `docs/demo_baseline_recovery_audit_2026-08-21.md` §2.6 defect A: 홈 read the server's uncapped
 * `unansweredInquiries` while the report counted `needsReply` over the inbox FEED, which the server
 * caps at `limit` (default 50). On the demo org that printed 3,208 on 홈 and ≤50 on /reports — same
 * words, same destination link, different number. Each page's own tests passed the whole time, because
 * each only checked itself.
 *
 * So the assertion here is deliberately cross-surface: one fixture, both derivations, one number.
 */

/** The number 홈 actually prints, or null when its signal is not a measured count. */
function homeCount(item: ReturnType<typeof buildInquiryToday>): number | null {
  return item.signal.kind === "READY" ? item.signal.count : null;
}

function inquiry(id: string, status: string): FeedItem {
  return {
    id,
    type: "INQUIRY",
    title: `문의 ${id}`,
    snippet: "",
    status,
    channel: "NAVER",
    channelId: "nv",
    receivedAt: "2026-08-20T00:00:00Z",
    productName: null,
    rating: null,
  } as unknown as FeedItem;
}

/** 3,208 unanswered inquiries, of which the feed returns only the first 50 — the demo org's shape. */
function demoOrgInbox(): { response: InboxResponse; feed: FeedItem[] } {
  const total = 3208;
  const feed = Array.from({ length: 50 }, (_, i) => inquiry(`q-${i}`, "UNANSWERED"));
  return {
    response: { items: feed, total: feed.length, unansweredInquiries: total } as InboxResponse,
    feed,
  };
}

describe("홈과 리포트의 미답변 문의 수", () => {
  it("prints the same number on both surfaces when the feed is capped", () => {
    const { response, feed } = demoOrgInbox();

    const home = buildInquiryToday(response, new Map());
    const report = buildWeeklyReport(null, feed, [], null, undefined, response.unansweredInquiries);

    expect(home.signal, "홈 reads the server's uncapped number")
      .toEqual({ kind: "READY", count: 3208 });
    expect(report.unansweredInquiries.value, "리포트 must read the same one").toBe(3208);
    expect(report.unansweredInquiries.value).toBe(homeCount(home));
  });

  it("agrees on a small org too, where the cap never bites", () => {
    const feed = [inquiry("a", "UNANSWERED"), inquiry("b", "ANSWERED"), inquiry("c", "UNANSWERED")];
    const response = { items: feed, total: 3, unansweredInquiries: 2 } as InboxResponse;

    const home = buildInquiryToday(response, new Map());
    const report = buildWeeklyReport(null, feed, [], null, undefined, response.unansweredInquiries);

    expect(report.unansweredInquiries.value).toBe(homeCount(home));
    expect(report.unansweredInquiries.value).toBe(2);
  });

  it("both point at the same destination, so the number and the screen agree", () => {
    const { response, feed } = demoOrgInbox();

    const home = buildInquiryToday(response, new Map());
    const report = buildWeeklyReport(null, feed, [], null, undefined, response.unansweredInquiries);

    // The report's Figure links to /inquiries?state=NEEDS_REPLY (ReportsV2.tsx). If the counts ever
    // diverge again, the seller clicks through from one number to a screen showing the other.
    expect(home.to).toBe("/inquiries?state=NEEDS_REPLY");
    expect(report.unansweredInquiries.available).toBe(true);
  });

  it("a failed inbox read is unavailable on the report, never a zero", () => {
    const report = buildWeeklyReport(null, null, [], null, undefined, null);

    expect(report.unansweredInquiries.available, "a failed source contributes no line").toBe(false);
  });
});
