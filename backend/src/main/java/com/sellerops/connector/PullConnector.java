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
}
