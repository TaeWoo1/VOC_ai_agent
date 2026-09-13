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
 *
 * <p><b>{@code countedInUnansweredNow} is a second verdict for a second question, and it has to be.</b>
 * Every other figure on this row is a window figure — what arrived between two dates. 미답변 is not:
 * it is the backlog standing right now, and this screen's own caption says so
 * (「현재 미답변」은 기간과 무관한 지금 수치). Asking the window question about it produced the defect this
 * field exists to close: a channel that received nothing this week had its whole standing backlog
 * dropped from the headline, so 운영 숫자 said 미답변 1 while 문의 and 리포트 said 22 for the same
 * words. The rule is not relaxed — it is asked with the operand it was written for: rows we hold,
 * not rows that arrived.
 *
 * <p><b>{@code connected} and {@code connectable} are two facts, and neither is a data state.</b>
 * Until Data-bearing Channel Home v1 the frontend derived «has this seller connected anything» from
 * the three enums above — a proxy that worked only while a row could not exist without a connection,
 * which stopped being true the moment an org uploaded its reviews. {@code connected} is the account
 * fact, read from the coverage row that already carries it. {@code connectable} is whether this
 * channel is one the product offers to connect at all ({@code ProductChannels}); a data-bearing
 * channel outside that set appears here so its rows are not erased, and this flag is how a surface
 * avoids offering a connection that does not exist.
 */
public record ChannelMetricRow(String channelCode, String channelNameKo,
                               ChannelDataState orderState, long revenue, long orders,
                               boolean countedInOrders,
                               ChannelDataState inquiryState, long inquiries, long unansweredInquiries,
                               boolean countedInInquiries,
                               boolean countedInUnansweredNow,
                               ChannelDataState reviewState, long reviews, long negativeReviews,
                               boolean countedInReviews,
                               boolean connected,
                               boolean connectable) {
}
