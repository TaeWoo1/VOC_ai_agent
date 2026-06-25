package com.sellerops.connector;

/**
 * A {@link ChannelConnector} that actively pulls data from a source on a schedule
 * (API connectors now mocked; real Coupang/Naver later), as opposed to the
 * operator-initiated {@code FileUploadConnector} which is NOT a PullConnector.
 *
 * <p>Implementations must be safe to call repeatedly and idempotently: a
 * {@link #fetch} with the same {@link FetchRequest} cursor returns the same page,
 * and persistence/dedup is handled downstream by the existing IngestionService.
 */
public interface PullConnector extends ChannelConnector {

    /**
     * Channel codes this connector exclusively serves (e.g. the real Naver
     * connector → {@code {"NAVER"}}), or empty for a generic connector that can
     * serve any channel (the mock). The registry prefers a dedicated connector
     * for its channel and never routes other channels to it.
     */
    default java.util.Set<String> dedicatedChannels() {
        return java.util.Set.of();
    }

    /**
     * Capability descriptor for a specific channel: the priority class plus the
     * data types this connector can actually serve for {@code channelCode}. This
     * is channel-aware so it never disagrees with {@link #fetch} — e.g. a
     * marketplace with no review API excludes {@code REVIEW} here, and calling
     * {@code fetch} for it throws {@link UnsupportedDataTypeException}.
     */
    ConnectorCapabilities capabilities(String channelCode);

    /**
     * Fetch one incremental page for the requested data type and cursor.
     *
     * @throws UnsupportedDataTypeException if this connector cannot serve the
     *         requested data type for the request's channel.
     */
    FetchPage fetch(FetchRequest request);

    /**
     * Translate an operator-selected bounded date window into this connector's
     * opaque <em>starting</em> cursor for a backfill run, or
     * {@link java.util.Optional#empty()} if the connector cannot serve a windowed
     * backfill for {@code dataType}. The executor seeds the returned value as the
     * run's first cursor — so {@link #fetch} reads the window — and persists every
     * subsequent advance through the normal {@code sync_cursors} path. A connector
     * that returns empty fails the backfill closed (a config error), never an
     * unbounded sweep. Default: unsupported.
     */
    default java.util.Optional<String> backfillCursor(DataType dataType,
                                                      java.time.LocalDate startDate,
                                                      java.time.LocalDate endDate) {
        return java.util.Optional.empty();
    }
}
