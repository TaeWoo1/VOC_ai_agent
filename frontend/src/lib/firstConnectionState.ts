import type { ChannelMetricRow } from "./types";

/**
 * **Has this seller connected anything yet?** — read from the numbers the page already has
 * (Pilot Readiness Gate v1 §4).
 *
 * The home screen needs this to decide whether 「채널 N곳이 이 숫자에 없습니다」 is a warning or the
 * ordinary state of a brand-new account. It is derived from `metrics.channels` rather than fetched,
 * because a second read could disagree with the table rendered six inches below it.
 *
 * <b>Two states mean "nothing is arriving from here", and only one of them is about connection.</b>
 * `NOT_CONNECTED` is the seller not having connected the channel; `NOT_SUPPORTED` is this product
 * having no collection path for that data type at all (NAVER reviews, Coupang reviews — both true on
 * a fully connected account). A row is evidence of a connection when ANY of its three data types is
 * in neither of those states, so a connected NAVER whose reviews are unsupported still counts.
 *
 * Absence of rows is not proof of absence of connections: an empty list answers `false` only because
 * a page with no channel table has no channel to speak for, and the caller uses this to choose a
 * colour — never to tell a seller their channels are disconnected.
 */
export function hasAnyConnectedChannel(rows: readonly ChannelMetricRow[]): boolean {
  const silent = (state: string) => state === "NOT_CONNECTED" || state === "NOT_SUPPORTED";
  return rows.some(
    (row) => !silent(row.orderState) || !silent(row.inquiryState) || !silent(row.reviewState),
  );
}
