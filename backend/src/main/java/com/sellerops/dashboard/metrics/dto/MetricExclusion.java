package com.sellerops.dashboard.metrics.dto;

import com.sellerops.coverage.ChannelDataState;

/**
 * A channel left out of a total, and why — in the seller's words.
 *
 * <p>This list is the reason the totals are allowed to exist at all. Without it the only two options
 * are counting a silent channel as zero (false) or omitting it with no trace (false in a quieter way).
 */
public record MetricExclusion(String channelCode, String channelNameKo, String dataType,
                              ChannelDataState state, String reasonKo) {
}
