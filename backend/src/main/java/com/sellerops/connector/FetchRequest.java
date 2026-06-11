package com.sellerops.connector;

import java.util.UUID;

/**
 * One incremental pull request to a {@link PullConnector}. {@code cursorValue} is
 * the opaque resume position from the previous page (null = start from the
 * beginning); {@code limit} is the requested page size.
 */
public record FetchRequest(
        UUID orgId,
        UUID sellerAccountId,
        String channelCode,
        DataType dataType,
        String cursorValue,
        int limit) {
}
