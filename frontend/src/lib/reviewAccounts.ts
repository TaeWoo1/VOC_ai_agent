// Which accounts the 리뷰 surface can show, in product order. Pure; no React, no I/O.
//
// The 리뷰 page is one workflow surface over per-account review records (`ChannelReviews`), so it
// needs to know which of the org's accounts have a record to open. That is: the account's channel is
// a product channel (`productChannels`) AND keeps a review record (`reviewRecord`). File-upload
// accounts count — a NAVER review export lands on one — because the record is the account's, however
// it was filled.

import { isProductChannel, PRODUCT_CHANNEL_CODES } from "./productChannels";
import { hasReviewRecord } from "./reviewRecord";
import type { ChannelResponse, SellerAccountResponse } from "./types";

export interface ReviewAccount {
  account: SellerAccountResponse;
  channel: ChannelResponse;
  /** What the switcher calls it: the channel name, plus the alias when one channel has several. */
  label: string;
}

export function reviewAccounts(
  accounts: readonly SellerAccountResponse[] | null,
  channels: readonly ChannelResponse[] | null,
): ReviewAccount[] {
  if (!accounts || !channels) {
    return [];
  }
  const byId = new Map(channels.map((channel) => [channel.id, channel] as const));
  const matched = accounts.flatMap((account) => {
    const channel = byId.get(account.channelId);
    if (!channel || !isProductChannel(channel.code) || !hasReviewRecord(channel.code)) {
      return [];
    }
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
    .sort((a, b) => rank(a.channel.code) - rank(b.channel.code))
    .map(({ account, channel }) => ({
      account,
      channel,
      label:
        (perChannel.get(channel.code) ?? 0) > 1 && account.alias
          ? `${channel.nameKo} · ${account.alias}`
          : channel.nameKo,
    }));
}
