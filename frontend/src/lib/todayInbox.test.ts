import { describe, expect, it } from "vitest";
import {
  INQUIRY_NEEDS_REPLY_PATH,
  buildConnectionToday,
  buildInquiryToday,
  buildReviewToday,
  reviewAttentionPath,
  reviewDetailPath,
  type ReviewSource,
} from "./todayInbox";
import type { ReviewAccount } from "./reviewAccounts";
import type { ChannelReviewPageView, ChannelResponse, ConnectorAlertView, FeedItem, SellerAccountResponse } from "./types";

function channel(id: string, code: string, nameKo: string, status: ChannelResponse["status"] = "CONNECTED"): ChannelResponse {
  return {
    id, code, nameKo, status,
    dataBadges: [], lastSyncedAt: null, actionLabel: status === "RECONNECT_REQUIRED" ? "다시 연결하기" : "연결 관리",
    support: { autoCollectSupported: false, autoCollectDataTypes: [], fileUploadSupported: true, fileUploadDataTypes: [], connectionCheckSupported: false, credentialSetupSupported: false },
  } as ChannelResponse;
}
function reviewAccount(id: string, code: string, nameKo: string): ReviewAccount {
  const account: SellerAccountResponse = { id, channelId: `${id}-ch`, channelNameKo: nameKo, alias: null, connectionStatus: "CONNECTED", lastSyncedAt: null, fileUpload: false };
  return { account, channel: channel(`${id}-ch`, code, nameKo), label: nameKo };
}
function page(total: number, items: Array<{ id: string; productName?: string; rating?: number; writtenOn?: string }>): ChannelReviewPageView {
  return {
    page: 0, size: 3, total, newCount: 0, lastImportAt: null, lastImportComplete: true, aiPilotEnabled: false,
    channel: { channelCode: "NAVER", aiTriage: true, originalLocate: "NONE", replySupported: true },
    triageSummary: { needsAttention: total, watch: 0, fyi: 0, aiAttention: 0, repeatedCategories: [] },
    items: items.map((i) => ({
      id: i.id, writtenOn: i.writtenOn ?? "2026-08-10", rating: i.rating ?? 1, negative: true, preview: "본문", productName: i.productName ?? null,
      productId: null, vendorItemId: null, mediaCount: 0, textless: false, isNew: false,
      triage: { tier: "NEEDS_ATTENTION", reason: "1점", tags: [], recommendedAction: null }, aiMark: null,
    })),
  } as ChannelReviewPageView;
}
function feed(over: Partial<FeedItem> & Pick<FeedItem, "id" | "type">): FeedItem {
  return { channelNameKo: "채널 가", productName: "상품", snippet: "내용", rating: null, status: "NORMAL", receivedAt: "2026-08-03T10:00:00Z", ...over } as FeedItem;
}

describe("Today — 확인이 필요한 리뷰", () => {
  const naver = reviewAccount("acc-nv", "NAVER", "네이버 스마트스토어");
  const coupang = reviewAccount("acc-cp", "COUPANG", "쿠팡");

  it("counts the attention-filtered total of each account and links each share to that exact filter", () => {
    const sources: ReviewSource[] = [
      { account: naver, page: page(12, [{ id: "r1", productName: "몰딩 A", writtenOn: "2026-08-12" }]) },
      { account: coupang, page: page(3, [{ id: "r2", productName: "몰딩 B", writtenOn: "2026-08-14" }]) },
    ];
    const t = buildReviewToday(sources);
    expect(t.signal).toEqual({ kind: "READY", count: 15 });
    // Two accounts: no single screen shows 15, so the headline is not a link.
    expect(t.to).toBeNull();
    expect(t.breakdown).toEqual([
      { key: "acc-nv", label: "네이버 스마트스토어", count: 12, to: "/reviews/acc-nv?tier=NEEDS_ATTENTION" },
      { key: "acc-cp", label: "쿠팡", count: 3, to: "/reviews/acc-cp?tier=NEEDS_ATTENTION" },
    ]);
    // Rows: newest first across accounts, each opening its own review on its own account.
    expect(t.rows.map((r) => r.to)).toEqual(["/reviews/acc-cp?review=r2", "/reviews/acc-nv?review=r1"]);
    expect(t.rows[0].meta).toBe("쿠팡 · 1점 · 2026-08-14");
    expect(t.note).toBeNull();
  });

  it("links the headline when there is exactly one account — that screen shows exactly this count", () => {
    const t = buildReviewToday([{ account: naver, page: page(4, []) }]);
    expect(t.signal).toEqual({ kind: "READY", count: 4 });
    expect(t.to).toBe(reviewAttentionPath("acc-nv"));
  });

  it("keeps the count from the accounts that loaded and names the one that did not", () => {
    const t = buildReviewToday([
      { account: naver, page: page(4, []) },
      { account: coupang, page: null },
    ]);
    expect(t.signal).toEqual({ kind: "READY", count: 4 });
    expect(t.note).toBe("쿠팡은(는) 지금 확인할 수 없습니다.");
    expect(t.breakdown.map((b) => b.key)).toEqual(["acc-nv"]);
  });

  it("is unavailable, never 0, when nothing could be read; not-connected when there is no account", () => {
    expect(buildReviewToday(null).signal).toEqual({ kind: "UNAVAILABLE" });
    expect(buildReviewToday([{ account: naver, page: null }]).signal).toEqual({ kind: "UNAVAILABLE" });
    expect(buildReviewToday([]).signal).toEqual({ kind: "NOT_CONNECTED" });
  });

  it("builds the two 리뷰 destinations from the record path", () => {
    expect(reviewAttentionPath("a")).toBe("/reviews/a?tier=NEEDS_ATTENTION");
    expect(reviewDetailPath("a", "r 1")).toBe("/reviews/a?review=r%201");
  });
});

describe("Today — 답변이 필요한 문의", () => {
  it("counts needsReply over the feed and links to the state-filtered 문의 page", () => {
    const t = buildInquiryToday(
      [
        feed({ id: "i1", type: "INQUIRY", status: "UNANSWERED", productName: "몰딩 A" }),
        feed({ id: "i2", type: "INQUIRY", status: "ANSWERED" }),
        feed({ id: "r1", type: "REVIEW", status: "NEGATIVE", rating: 1 }),
      ],
      new Map(),
    );
    expect(t.signal).toEqual({ kind: "READY", count: 1 });
    expect(t.to).toBe(INQUIRY_NEEDS_REPLY_PATH);
    expect(t.rows).toEqual([{ key: "i1", title: "몰딩 A", meta: "채널 가", to: "/inquiries/i1" }]);
  });

  it("is unavailable when the feed failed and not-connected when it is empty", () => {
    expect(buildInquiryToday(null, new Map()).signal).toEqual({ kind: "UNAVAILABLE" });
    expect(buildInquiryToday([], new Map()).signal).toEqual({ kind: "NOT_CONNECTED" });
  });
});

describe("Today — 확인이 필요한 연결", () => {
  const alert = { id: "al1", sellerAccountId: "a", channelId: null, channelNameKo: "쿠팡", accountAlias: null, type: "AUTH_EXPIRED", severity: "WARNING", message: "연결 정보가 만료되었습니다", createdAt: "2026-08-10T00:00:00Z", acknowledgedAt: null } as ConnectorAlertView;

  it("counts interrupted channels and open alerts, each row pointing where it is handled", () => {
    const t = buildConnectionToday(
      { needsAttention: [channel("c1", "NAVER", "네이버", "RECONNECT_REQUIRED")], openAlerts: [alert], nothingConnected: false },
      true,
      true,
    );
    expect(t.signal).toEqual({ kind: "READY", count: 2 });
    expect(t.to).toBeNull(); // two screens are involved
    expect(t.rows.map((r) => r.to)).toEqual(["/connect", "/settings/alerts"]);
  });

  it("links the headline when everything is on one screen, and to 채널 연결 when quiet", () => {
    expect(buildConnectionToday({ needsAttention: [], openAlerts: [alert], nothingConnected: false }, true, true).to).toBe("/settings/alerts");
    const quiet = buildConnectionToday({ needsAttention: [], openAlerts: [], nothingConnected: false }, true, true);
    expect(quiet.signal).toEqual({ kind: "READY", count: 0 });
    expect(quiet.to).toBe("/connect");
  });

  it("is unavailable when both reads failed, and says which half is missing when one did", () => {
    expect(buildConnectionToday({ needsAttention: [], openAlerts: [], nothingConnected: false }, false, false).signal).toEqual({ kind: "UNAVAILABLE" });
    expect(buildConnectionToday({ needsAttention: [], openAlerts: [], nothingConnected: false }, false, true).note).toBe("채널 상태는 지금 확인할 수 없습니다.");
  });
});
