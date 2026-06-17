import type { OrderSummaryResponse } from "./types";
import { count, wonShort } from "./format";

export interface OrderInsight {
  id: string;
  text: string;
  tone?: "warn";
}

/** Top channel sales-share (%) at or above which we flag concentration risk. */
const CONCENTRATION_THRESHOLD = 70;

/** Derives 3–5 plain-Korean takeaways from an order summary. Pure (no I/O, no
 *  React) so it can be unit-tested once a FE test runner exists.
 *
 *  Reads ONLY aggregate fields already on OrderSummaryResponse — never raw
 *  order/customer/product rows. `channelName` is non-null when a single-channel
 *  filter is active (callers pass "선택한 채널" when the channel list failed to
 *  load but a channelId is selected). */
export function buildOrderInsights(
  data: OrderSummaryResponse,
  opts: { range: number; channelName: string | null },
): OrderInsight[] {
  const { range, channelName } = opts;
  const filtered = channelName !== null;

  // R4 — empty period: show guidance only, suppress misleading summary/top-channel.
  if (data.totalOrders7d === 0) {
    return [
      {
        id: "empty",
        text: "선택한 기간에 집계된 주문이 없습니다. 기간을 늘리거나 채널 필터를 해제해 보세요.",
      },
    ];
  }

  const insights: OrderInsight[] = [];

  // R1 — period summary.
  const dailyAvg = Math.round(data.totalOrders7d / Math.max(range, 1));
  insights.push({
    id: "summary",
    text: `최근 ${range}일간 주문 ${count(data.totalOrders7d)}건 · 매출 ${wonShort(
      data.totalSales7d,
    )}원, 하루 평균 약 ${count(dailyAvg)}건입니다.`,
  });

  const top = data.channelShare[0];

  // R2/R3 are channel-relative; skip while a single channel is filtered.
  if (!filtered && top) {
    // R2 — top channel by sales share.
    insights.push({
      id: "top-channel",
      text: `${top.channelNameKo} 채널이 매출의 ${top.percent}%로 가장 큽니다.`,
    });

    // R3 — concentration warning (needs ≥2 channels to be meaningful).
    if (data.channelShare.length >= 2 && top.percent >= CONCENTRATION_THRESHOLD) {
      insights.push({
        id: "concentration",
        tone: "warn",
        text: `${top.channelNameKo} 채널 의존도가 높습니다 (${top.percent}%). 채널 다변화를 검토해 볼 수 있습니다.`,
      });
    }
  }

  // R5 — single-channel filter context.
  if (filtered) {
    insights.push({
      id: "filter-context",
      text: `현재 ${channelName} 채널만 보고 있습니다. 전체 추세는 ‘전체 채널’에서 확인하세요.`,
    });
  }

  return insights;
}
