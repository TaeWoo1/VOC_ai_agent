package com.sellerops.dashboard.metrics.dto;

import com.sellerops.coverage.ChannelDataState;

/**
 * One channel's row in the breakdown — three data types, three freshness verdicts, never one.
 *
 * <p>A channel can be collecting reviews and locked out of inquiries at the same time (NAVER, this
 * week), so a single per-channel state would have to be a lie in one column or the other.
 *
 * <p><b>{@code countedIn*} says whether this row's numbers are inside the headline totals.</b> The
 * rule is one sentence and it lives in the service: a channel is counted when its collection is
 * provably current, or when it actually contributed rows we hold. A channel that is merely silent —
 * disconnected, blocked, unsupported — is NOT counted and NOT drawn as a zero.
 */
public record ChannelMetricRow(String channelCode, String channelNameKo,
                               ChannelDataState orderState, long revenue, long orders,
                               boolean countedInOrders,
                               ChannelDataState inquiryState, long inquiries, long unansweredInquiries,
                               boolean countedInInquiries,
                               ChannelDataState reviewState, long reviews, long negativeReviews,
                               boolean countedInReviews) {
}
