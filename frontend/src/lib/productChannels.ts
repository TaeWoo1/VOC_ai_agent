/**
 * The channels the product shows to a seller.
 *
 * Product-owner decision (2026-08-17, product assembly): channel expansion is paused and the
 * user-visible channel set is exactly NAVER / Coupang / Cafe24 — a channel on screen is a channel
 * that is actually usable. The backend enforces the same set on `/api/channels`
 * (`ProductChannels.java`); this mirror exists so the demo-mode catalog and any client-side channel
 * list obey the same rule, and so a screen can ask the question without knowing where the list
 * came from. Canonical: `docs/product_assembly_ia_v1.md` §2.
 *
 * Adding a channel here is a product decision made after a connector/capability proof — never a
 * side effect of a connector or a mock row landing.
 */
export const PRODUCT_CHANNEL_CODES = ["NAVER", "COUPANG", "CAFE24"] as const;

export type ProductChannelCode = (typeof PRODUCT_CHANNEL_CODES)[number];

const VISIBLE: ReadonlySet<string> = new Set(PRODUCT_CHANNEL_CODES);

/** Whether the product shows this channel. Null / unknown codes are never visible. */
export function isProductChannel(code: string | null | undefined): code is ProductChannelCode {
  return !!code && VISIBLE.has(code);
}

/**
 * The visible subset of a channel list, in PRODUCT order (NAVER, Coupang, Cafe24) — the order the
 * 리뷰 switcher, the home shares and every list of the three channels use, so the catalog's own
 * sort order cannot make the same three channels appear in a different order on different screens
 * (product assembly A7). Ties (several rows on one code) keep the list's own order.
 */
export function visibleChannels<T extends { code: string }>(list: readonly T[]): T[] {
  const rank = (code: string) => (PRODUCT_CHANNEL_CODES as readonly string[]).indexOf(code);
  return list
    .filter((channel) => isProductChannel(channel.code))
    .map((channel, index) => ({ channel, index }))
    .sort((a, b) => rank(a.channel.code) - rank(b.channel.code) || a.index - b.index)
    .map(({ channel }) => channel);
}
