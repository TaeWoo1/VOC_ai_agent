// Which of the org's seller accounts a PRODUCT screen may name. Pure; no React, no I/O.
//
// `reviewAccounts` already answers this for the 리뷰 surface, but it answers a narrower question — "and does
// this channel keep a review record?" — so screens that are not about reviews cannot reuse it and were reading
// `getSellerAccountsStrict()` raw instead. That is how `/agent` and `/connect/review-history` came to list
// `G마켓/옥션 · ESM 문의 엑셀 가져오기` in their account pickers: the ESM connector legitimately still exists in
// the catalog and connector layer (product-owner decision, 2026-08-17), but it is explicitly "not returned to
// product surfaces", and an account picker is a product surface.
//
// So this is the general form: the account's channel must be a product channel (`productChannels`), and the
// result comes back in PRODUCT order (NAVER, Coupang, Cafe24) so the same three accounts cannot appear in a
// different order on different screens. Ties (several accounts on one channel) keep the list's own order.

import { isProductChannel, PRODUCT_CHANNEL_CODES } from "./productChannels";
import type { ChannelResponse, SellerAccountResponse } from "./types";

export interface ProductAccount {
  account: SellerAccountResponse;
  channel: ChannelResponse;
  /** What a picker calls it: the channel name, plus the alias when one channel has several accounts. */
  label: string;
}

/**
 * The visible accounts, in product order.
 *
 * **Fails CLOSED on a missing channel list.** A screen that could not read `/api/channels` cannot tell which
 * channel an account belongs to, and the honest answer there is "no accounts to offer" — not "all of them",
 * which is precisely the fallback that would put an ESM row back on the screen the first time a channel read
 * failed. Callers render their own empty/degraded state.
 */
export function productAccounts(
  accounts: readonly SellerAccountResponse[] | null | undefined,
  channels: readonly ChannelResponse[] | null | undefined,
): ProductAccount[] {
  if (!accounts || !channels) return [];
  const byId = new Map(channels.map((channel) => [channel.id, channel] as const));
  const matched = accounts.flatMap((account) => {
    const channel = byId.get(account.channelId);
    if (!channel || !isProductChannel(channel.code)) return [];
    return [{ account, channel }];
  });
  const perChannel = new Map<string, number>();
  for (const { channel } of matched) {
    perChannel.set(channel.code, (perChannel.get(channel.code) ?? 0) + 1);
  }
  const rank = (code: string) => {
    const index = (PRODUCT_CHANNEL_CODES as readonly string[]).indexOf(code);
    return index === -1 ? PRODUCT_CHANNEL_CODES.length : index;
  };
  return matched
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => rank(a.entry.channel.code) - rank(b.entry.channel.code) || a.index - b.index)
    .map(({ entry: { account, channel } }) => ({
      account,
      channel,
      label:
        (perChannel.get(channel.code) ?? 0) > 1 && account.alias
          ? `${channel.nameKo} · ${account.alias}`
          : channel.nameKo,
    }));
}
