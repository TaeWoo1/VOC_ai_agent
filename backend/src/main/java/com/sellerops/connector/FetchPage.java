package com.sellerops.connector;

import java.util.List;

/**
 * One page returned by a {@link PullConnector#fetch}.
 *
 * <p>{@code records} is intentionally {@code List<?>} of canonical records whose
 * concrete type matches {@code dataType} (e.g. {@code CanonicalInquiry} for
 * {@code INQUIRY}). Slice 2 does not route or persist these — a later
 * SyncRunExecutor will dispatch by {@code dataType} to the right
 * {@code IngestionService} method, avoiding unsafe casts.
 *
 * <p>{@code nextCursorValue}/{@code hasMore} drive resumable paging.
 * {@code rateLimited}/{@code retryAfterSeconds} carry a throttling signal for the
 * (future) rate-limit governor; this slice only emits the signal, it does not act
 * on it. {@code source} is the originating connector kind (e.g. MOCK_API).
 */
public record FetchPage(
        DataType dataType,
        List<?> records,
        String nextCursorValue,
        boolean hasMore,
        boolean rateLimited,
        Integer retryAfterSeconds,
        String source) {

    /** A normal page of records. */
    public static FetchPage of(DataType dataType, List<?> records, String nextCursorValue,
                               boolean hasMore, String source) {
        return new FetchPage(dataType, List.copyOf(records), nextCursorValue, hasMore,
                false, null, source);
    }

    /** A throttled response: no records, retry after the given seconds, cursor unchanged. */
    public static FetchPage rateLimited(DataType dataType, String cursorValue,
                                        int retryAfterSeconds, String source) {
        return new FetchPage(dataType, List.of(), cursorValue, true, true, retryAfterSeconds, source);
    }
}
