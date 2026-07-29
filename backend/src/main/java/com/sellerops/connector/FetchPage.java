package com.sellerops.connector;

import java.util.List;

/**
 * One page returned by a {@link PullConnector#fetch}.
 *
 * <p>{@code records} is intentionally {@code List<?>} of canonical records whose
 * concrete type matches {@code dataType} (e.g. {@code CanonicalInquiry} for
 * {@code INQUIRY}). A {@code SyncRunExecutor} dispatches by {@code dataType} to the
 * right {@code IngestionService} method, avoiding unsafe casts.
 *
 * <p>{@code orders} is an <b>additive, optional</b> secondary payload: per-order
 * ({@code CanonicalOrder}) records a per-order channel (NAVER) emits alongside the
 * daily {@code ORDER_SUMMARY} {@code records}. It is empty for every aggregate-only
 * channel and for every non-order page, so the primary path is unchanged.
 *
 * <p>{@code nextCursorValue}/{@code hasMore} drive resumable paging.
 * {@code rateLimited}/{@code retryAfterSeconds} carry a throttling signal for the
 * rate-limit governor; a page only emits the signal, it does not act on it.
 * {@code source} is the originating connector kind (e.g. MOCK_API).
 */
public record FetchPage(
        DataType dataType,
        List<?> records,
        List<?> orders,
        String nextCursorValue,
        boolean hasMore,
        boolean rateLimited,
        Integer retryAfterSeconds,
        String source) {

    /** A normal page of records with no per-order payload. */
    public static FetchPage of(DataType dataType, List<?> records, String nextCursorValue,
                               boolean hasMore, String source) {
        return new FetchPage(dataType, List.copyOf(records), List.of(), nextCursorValue, hasMore,
                false, null, source);
    }

    /**
     * A page that carries both aggregate {@code records} and per-order {@code orders} — used by a
     * per-order channel so the daily summary and the order-level rows land from the same page.
     */
    public static FetchPage ofWithOrders(DataType dataType, List<?> records, List<?> orders,
                                         String nextCursorValue, boolean hasMore, String source) {
        return new FetchPage(dataType, List.copyOf(records), List.copyOf(orders), nextCursorValue,
                hasMore, false, null, source);
    }

    /** A throttled response: no records, retry after the given seconds, cursor unchanged. */
    public static FetchPage rateLimited(DataType dataType, String cursorValue,
                                        int retryAfterSeconds, String source) {
        return new FetchPage(dataType, List.of(), List.of(), cursorValue, true, true,
                retryAfterSeconds, source);
    }
}
