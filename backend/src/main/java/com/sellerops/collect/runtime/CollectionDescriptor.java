package com.sellerops.collect.runtime;

import com.sellerops.connector.DataType;
import java.util.UUID;

/**
 * Identity of one collection run: who ({@code orgId}, {@code sellerAccountId},
 * {@code channelId}/{@code channelCode}), what ({@code dataType}), how ({@code method}),
 * and why ({@code trigger}: UPLOAD / SCHEDULED / MANUAL / RETRY).
 *
 * <p>{@code sellerAccountId} and {@code channelId} may be null for legacy channel-only
 * jobs; the runtime skips connection-health updates when there is no seller account.
 */
public record CollectionDescriptor(
        UUID orgId,
        UUID sellerAccountId,
        UUID channelId,
        String channelCode,
        DataType dataType,
        CollectionMethod method,
        String trigger) {
}
