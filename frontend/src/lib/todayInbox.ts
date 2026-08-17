// Today Inbox — pure derivation for the home. No React, no I/O.
//
// THE CONTRACT (docs/product_assembly_ia_v1.md §4a):
//   1. Every count on the home is the count its destination shows. A tile is a link only when the
//      screen it opens counts the same rows the same way; otherwise the tile is a heading and the
//      links underneath carry the exact numbers.
//   2. A count is shown only when it was computed from data that actually loaded (homeSignals rule).
//      Failure is an honest absence, never 0.
//   3. Sources are the workflow surfaces themselves: 리뷰 = the per-account record under
//      `tier=NEEDS_ATTENTION` (its `total` IS what /reviews/:account?tier=NEEDS_ATTENTION shows);
//      문의 = the inbox feed under `needsReply` (what /inquiries?state=NEEDS_REPLY shows); 연결 =
//      channels whose own status asks for a person + open connector alerts.
//   4. 주문 is absent: the order model has no actionable state yet (PAID / UNKNOWN only).

import type { Signal } from "./homeSignals";
import { hintFor, type ConnectionSummary } from "./homeSignals";
import { needsReply, priorityRank } from "./inboxWorkspace";
import { analysisKey } from "./inboxView";
import type { ReviewAccount } from "./reviewAccounts";
import { reviewRecordPath, reviewWord } from "./reviewRecord";
import type { ChannelReviewPageView, FeedItem, ItemAnalysis } from "./types";

/** One row under a Today item — a thing to open, never a summary. */
export interface TodayRow {
  key: string;
  title: string;
  /** Short context: channel, rating, time. */
  meta: string;
  to: string;
}

/** A per-channel share of a Today item, each with its own exact destination. */
export interface TodayBreakdown {
  key: string;
  label: string;
  count: number;
  to: string;
}

export interface TodayItem {
  id: "reviews" | "inquiries" | "connections";
  label: string;
  signal: Signal;
  /** Wording shown instead of a number when the signal is not READY. */
  hint: string;
  /** Where the headline goes. Null when no single screen shows exactly this count. */
  to: string | null;
  breakdown: TodayBreakdown[];
  rows: TodayRow[];
  /** A partial-failure note ("쿠팡은 지금 확인할 수 없습니다"), or null. */
  note: string | null;
}

/** The 리뷰 destination that shows exactly the 확인 필요 rows of one account. */
export function reviewAttentionPath(accountId: string): string {
  return `${reviewRecordPath(accountId)}?tier=NEEDS_ATTENTION`;
}

/** The 리뷰 destination that opens one review of one account. */
export function reviewDetailPath(accountId: string, reviewId: string): string {
  return `${reviewRecordPath(accountId)}?review=${encodeURIComponent(reviewId)}`;
}

/** The 문의 destination that shows exactly the 답변 필요 rows. */
export const INQUIRY_NEEDS_REPLY_PATH = "/inquiries?state=NEEDS_REPLY";

/** One account's read for the home: the page under `tier=NEEDS_ATTENTION`, or null when it failed. */
export interface ReviewSource {
  account: ReviewAccount;
  page: ChannelReviewPageView | null;
}

const ROW_LIMIT = 3;

/**
 * 확인이 필요한 리뷰.
 *
 * `sources` is null when the account/channel reads failed (nothing can be said), empty when the org
 * has no review-capable account (nothing is connected). Each source's `page.total` is the count under
 * the attention filter — the same number the destination prints — so the breakdown links are exact
 * by construction. The headline is a link only when there is exactly one account.
 */
export function buildReviewToday(sources: readonly ReviewSource[] | null): TodayItem {
  const label = "확인이 필요한 리뷰";
  if (sources === null) {
    return item("reviews", label, { kind: "UNAVAILABLE" }, null, [], [], null);
  }
  if (sources.length === 0) {
    return item("reviews", label, { kind: "NOT_CONNECTED" }, null, [], [], null);
  }
  const loaded = sources.filter((s): s is ReviewSource & { page: ChannelReviewPageView } => s.page !== null);
  const failed = sources.filter((s) => s.page === null);
  if (loaded.length === 0) {
    return item("reviews", label, { kind: "UNAVAILABLE" }, null, [], [], null);
  }
  const breakdown: TodayBreakdown[] = loaded.map((s) => ({
    key: s.account.account.id,
    label: s.account.label,
    count: s.page.total,
    to: reviewAttentionPath(s.account.account.id),
  }));
  const rows: TodayRow[] = loaded
    .flatMap((s) =>
      s.page.items.map((review) => ({
        key: `${s.account.account.id}:${review.id}`,
        title: review.productName?.trim() || review.preview?.trim() || reviewWord(s.account.channel.code),
        meta: [
          s.account.channel.nameKo,
          review.rating === null ? null : `${review.rating}점`,
          review.writtenOn,
        ]
          .filter((part): part is string => !!part)
          .join(" · "),
        to: reviewDetailPath(s.account.account.id, review.id),
        // For ordering only: newest first across accounts.
        writtenOn: review.writtenOn ?? "",
      })),
    )
    .sort((a, b) => (a.writtenOn < b.writtenOn ? 1 : a.writtenOn > b.writtenOn ? -1 : 0))
    .slice(0, ROW_LIMIT)
    .map(({ writtenOn: _ignored, ...row }) => row);
  const total = loaded.reduce((sum, s) => sum + s.page.total, 0);
  const note =
    failed.length > 0
      ? `${failed.map((s) => s.account.channel.nameKo).join(", ")}은(는) 지금 확인할 수 없습니다.`
      : null;
  return item(
    "reviews",
    label,
    { kind: "READY", count: total },
    loaded.length === 1 ? breakdown[0].to : null,
    breakdown,
    rows,
    note,
  );
}

/**
 * 답변이 필요한 문의.
 *
 * `inbox` is null when the feed read failed; empty when nothing has arrived. The count is
 * `needsReply` over the feed — exactly what /inquiries?state=NEEDS_REPLY lists — so the headline is
 * always a link. Rows are the worst-first top few (urgent analysis first, then newest).
 */
export function buildInquiryToday(
  inbox: readonly FeedItem[] | null,
  index: Map<string, ItemAnalysis>,
): TodayItem {
  const label = "답변이 필요한 문의";
  if (inbox === null) {
    return item("inquiries", label, { kind: "UNAVAILABLE" }, INQUIRY_NEEDS_REPLY_PATH, [], [], null);
  }
  if (inbox.length === 0) {
    return item("inquiries", label, { kind: "NOT_CONNECTED" }, INQUIRY_NEEDS_REPLY_PATH, [], [], null);
  }
  const open = inbox.filter(needsReply);
  const rows: TodayRow[] = [...open]
    .sort((a, b) => {
      const rankDiff =
        priorityRank(a, index.get(analysisKey(a.type, a.id))) -
        priorityRank(b, index.get(analysisKey(b.type, b.id)));
      return rankDiff !== 0 ? rankDiff : Date.parse(b.receivedAt) - Date.parse(a.receivedAt);
    })
    .slice(0, ROW_LIMIT)
    .map((q) => ({
      key: q.id,
      title: q.productName?.trim() || q.snippet?.trim() || "문의",
      meta: q.channelNameKo,
      to: `/inquiries/${q.id}`,
    }));
  return item(
    "inquiries",
    label,
    { kind: "READY", count: open.length },
    INQUIRY_NEEDS_REPLY_PATH,
    [],
    rows,
    null,
  );
}

/**
 * 확인이 필요한 연결.
 *
 * Interrupted channels (their own status) + unacknowledged alerts. `channels`/`alerts` null means
 * that read failed. Rows link to where each is handled: a channel to 채널 연결, an alert to 연결 알림.
 * The headline is a link only when everything points at one screen.
 */
export function buildConnectionToday(
  summary: ConnectionSummary,
  channelsLoaded: boolean,
  alertsLoaded: boolean,
): TodayItem {
  const label = "확인이 필요한 연결";
  if (!channelsLoaded && !alertsLoaded) {
    return item("connections", label, { kind: "UNAVAILABLE" }, "/connect", [], [], null);
  }
  const rows: TodayRow[] = [
    ...summary.needsAttention.map((channel) => ({
      key: `channel:${channel.id}`,
      title: channel.nameKo,
      meta: channel.actionLabel,
      to: "/connect",
    })),
    ...summary.openAlerts.map((alert) => ({
      key: `alert:${alert.id}`,
      title: alert.message,
      meta: alert.channelNameKo ?? "연결 알림",
      to: "/settings/alerts",
    })),
  ];
  const count = rows.length;
  const targets = new Set(rows.map((row) => row.to));
  const to = targets.size === 1 ? [...targets][0] : count === 0 ? "/connect" : null;
  const note = !channelsLoaded
    ? "채널 상태는 지금 확인할 수 없습니다."
    : !alertsLoaded
      ? "연결 알림은 지금 확인할 수 없습니다."
      : null;
  return item("connections", label, { kind: "READY", count }, to, [], rows, note);
}

function item(
  id: TodayItem["id"],
  label: string,
  signal: Signal,
  to: string | null,
  breakdown: TodayBreakdown[],
  rows: TodayRow[],
  note: string | null,
): TodayItem {
  return { id, label, signal, hint: hintFor(signal) ?? "", to, breakdown, rows, note };
}
