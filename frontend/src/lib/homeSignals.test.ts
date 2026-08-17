import { describe, expect, it } from "vitest";
import {
  buildInboxAttention,
  buildIssueAttention,
  hintFor,
  summarizeConnections,
  topAttentionItems,
} from "./homeSignals";
import type { ChannelResponse, ConnectorAlertView, FeedItem } from "./types";

function feedItem(over: Partial<FeedItem> & Pick<FeedItem, "id" | "type">): FeedItem {
  return {
    channelNameKo: "채널 가",
    productName: "상품",
    snippet: "내용",
    rating: null,
    status: "NORMAL",
    receivedAt: "2026-08-03T10:00:00Z",
    ...over,
  } as FeedItem;
}

const unanswered = feedItem({ id: "i1", type: "INQUIRY", status: "UNANSWERED" });
const negative = feedItem({ id: "r1", type: "REVIEW", status: "NEGATIVE", rating: 1 });
const calm = feedItem({ id: "r2", type: "REVIEW", status: "NORMAL", rating: 5 });

describe("attention signals — a number only when a number was measured", () => {
  it("counts what loaded", () => {
    const [reply, check] = buildInboxAttention([unanswered, negative, calm]);
    expect(reply.signal).toEqual({ kind: "READY", count: 1 });
    expect(check.signal).toEqual({ kind: "READY", count: 1 });
  });

  it("reports zero honestly when the read succeeded and there is genuinely nothing", () => {
    const [reply] = buildInboxAttention([calm]);
    expect(reply.signal).toEqual({ kind: "READY", count: 0 });
  });

  it("says NOT_CONNECTED — not zero — when nothing has arrived yet", () => {
    const [reply, check] = buildInboxAttention([]);
    expect(reply.signal).toEqual({ kind: "NOT_CONNECTED" });
    expect(check.signal).toEqual({ kind: "NOT_CONNECTED" });
  });

  it("says UNAVAILABLE — never zero — when the read failed", () => {
    // "0건" rendered because a request failed reads as "nothing needs you today", and the seller
    // stops looking. That is the single worst lie this screen could tell.
    const [reply, check] = buildInboxAttention(null);
    expect(reply.signal).toEqual({ kind: "UNAVAILABLE" });
    expect(check.signal).toEqual({ kind: "UNAVAILABLE" });
    expect(reply.hint).toBe("지금은 확인할 수 없습니다");
  });

  it("carries the right hint for each non-ready state", () => {
    expect(hintFor({ kind: "NOT_CONNECTED" })).toBe("자료를 연결하면 표시됩니다");
    expect(hintFor({ kind: "UNAVAILABLE" })).toBe("지금은 확인할 수 없습니다");
    expect(hintFor({ kind: "READY", count: 3 })).toBeNull();
  });

  it("points each card at where the operator acts on it", () => {
    const [reply, check] = buildInboxAttention([unanswered]);
    expect(reply.to).toBe("/inquiries");
    expect(check.to).toBe("/inbox");
  });
});

describe("recurring-issue signal", () => {
  it("counts only issues the operator has not set aside", () => {
    expect(buildIssueAttention(2, true).signal).toEqual({ kind: "READY", count: 2 });
  });

  it("is UNAVAILABLE before it has loaded", () => {
    expect(buildIssueAttention(null, false).signal).toEqual({ kind: "UNAVAILABLE" });
  });

  it("is UNAVAILABLE when the strict read failed — it never invents issues", () => {
    expect(buildIssueAttention(null, true).signal).toEqual({ kind: "UNAVAILABLE" });
  });

  it("sends the operator to the memory surface", () => {
    expect(buildIssueAttention(1, true).to).toBe("/memory");
  });
});

describe("home preview rows", () => {
  it("shows only rows that need a person, worst first, capped", () => {
    const rows = topAttentionItems([calm, negative, unanswered], new Map(), 3);
    expect(rows.map((r) => r.id)).toEqual(["i1", "r1"]);
  });

  it("respects the cap", () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      feedItem({ id: `i${i}`, type: "INQUIRY", status: "UNANSWERED" }),
    );
    expect(topAttentionItems(many, new Map(), 3)).toHaveLength(3);
  });
});

describe("connection summary — action-needed only", () => {
  function channel(over: Partial<ChannelResponse>): ChannelResponse {
    return {
      id: "c1",
      code: "X",
      nameKo: "채널",
      status: "CONNECTED",
      dataBadges: [],
      lastSyncedAt: null,
      actionLabel: "관리",
      support: {} as ChannelResponse["support"],
      ...over,
    };
  }

  const alert = (over: Partial<ConnectorAlertView>): ConnectorAlertView => ({
    id: "a1",
    sellerAccountId: "s1",
    channelId: null,
    channelNameKo: null,
    accountAlias: null,
    type: "AUTH_EXPIRED",
    severity: "WARNING",
    message: "연결을 다시 확인해 주세요",
    createdAt: "2026-08-01T00:00:00Z",
    acknowledgedAt: null,
    ...over,
  });

  it("surfaces only channels a person must act on", () => {
    const summary = summarizeConnections(
      [
        channel({ id: "ok", status: "CONNECTED" }),
        channel({ id: "avail", status: "AVAILABLE" }),
        channel({ id: "broken", status: "RECONNECT_REQUIRED" }),
      ],
      [],
    );
    expect(summary.needsAttention.map((c) => c.id)).toEqual(["broken"]);
  });

  it("does not treat 'available to connect' as a problem", () => {
    const summary = summarizeConnections([channel({ status: "AVAILABLE" })], []);
    expect(summary.needsAttention).toHaveLength(0);
    expect(summary.nothingConnected).toBe(false);
  });

  it("keeps only unacknowledged alerts", () => {
    const summary = summarizeConnections(
      [],
      [alert({ id: "open" }), alert({ id: "seen", acknowledgedAt: "2026-08-02T00:00:00Z" })],
    );
    expect(summary.openAlerts.map((a) => a.id)).toEqual(["open"]);
  });

  it("distinguishes 'nothing connected' from 'could not read'", () => {
    expect(summarizeConnections([], []).nothingConnected).toBe(true);
    expect(summarizeConnections(null, null).nothingConnected).toBe(false);
  });
});
