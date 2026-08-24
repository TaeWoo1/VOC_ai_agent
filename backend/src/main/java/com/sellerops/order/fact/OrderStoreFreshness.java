package com.sellerops.order.fact;

import com.sellerops.coverage.ChannelDataState;
import java.util.UUID;

/**
 * "Can this channel's PER-ORDER store be spoken about as current?" — one question, one method.
 *
 * <p><b>A seam, not an abstraction for its own sake.</b> The answer is derived by
 * {@code ChannelCoverageService}, which needs eight repositories to compute the whole coverage grid.
 * The order-fact reader needs one verdict from it. Depending on the whole service would make every
 * test of "이 주문 상태를 말해도 되는가" also a test of the capability registry, the schedule table and
 * the sync history — and a reader that is hard to test about freshness is a reader whose freshness
 * rule stops being tested.
 *
 * <p>The derivation itself is deliberately NOT duplicated behind this interface. There is one
 * implementation in production and its order — support, then connection, then freshness — is the
 * safety property; a second implementation would be a second chance to get that order wrong.
 */
@FunctionalInterface
public interface OrderStoreFreshness {

    /**
     * The freshness verdict for one connection's per-order rows.
     *
     * @param rowsHeld how many per-order rows this connection actually holds. Passed in rather than
     *                 counted here because only a channel that is connected AND collecting may report
     *                 a measured zero, and the count alone cannot tell those apart.
     */
    ChannelDataState perOrderState(UUID orgId, String channelCode, UUID sellerAccountId, long rowsHeld);
}
