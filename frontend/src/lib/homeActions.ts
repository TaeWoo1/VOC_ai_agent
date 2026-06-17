import type { OrderSummaryResponse } from "./types";
import { count } from "./format";

export interface OperatingItem {
  id: string;
  text: string;
  actionLabel?: string;
  to?: string;
}

/** Today's figures = the last trend point. The order summary builds its trend
 *  through today (to = LocalDate.now()), so trend[last].date === today. Falls
 *  back to 0 when the trend is empty. */
export function todayOrders(data: OrderSummaryResponse): number {
  const last = data.trend[data.trend.length - 1];
  return last ? last.orderCount : 0;
}

export function todaySales(data: OrderSummaryResponse): number {
  const last = data.trend[data.trend.length - 1];
  return last ? last.salesAmount : 0;
}

/** Order-derived operating checklist for Home. Deterministic and pure — uses
 *  ONLY the order/sales summary. Inquiry/review/product items are intentionally
 *  excluded: they have no live data source in the current seller-ops MVP, so
 *  surfacing counts here would be fabricated. */
export function buildHomeOperatingItems(data: OrderSummaryResponse): OperatingItem[] {
  const items: OperatingItem[] = [];
  const today = todayOrders(data);

  if (today > 0) {
    items.push({
      id: "today-orders",
      text: `오늘 들어온 주문 ${count(today)}건을 확인하세요.`,
      actionLabel: "확인",
      to: "/orders",
    });
  } else {
    items.push({ id: "no-orders", text: "오늘 아직 주문이 없습니다." });
  }

  items.push({
    id: "trend",
    text: "최근 7일 주문·매출 흐름을 확인하세요.",
    actionLabel: "보기",
    to: "/orders",
  });

  return items;
}
