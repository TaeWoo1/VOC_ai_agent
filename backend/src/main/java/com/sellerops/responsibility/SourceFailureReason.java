package com.sellerops.responsibility;

/**
 * Why a source was not (fully) observed. A closed vocabulary: raw connector messages never reach this column.
 *
 * <p>{@link #DEVICE_OFFLINE}, {@link #STORE_MISMATCH} and {@link #STORE_UNRESOLVED} belong to browser sources and
 * are declared here so the contract is one list; Package A schedules only official-API sources and does not
 * produce them.
 */
public enum SourceFailureReason {
    /** The channel's authorization is no longer valid; the seller has to reconnect. */
    AUTH_REQUIRED(false),
    /** The account is not connected. */
    NOT_CONNECTED(false),
    /** The channel did not answer in time. */
    TIMEOUT(true),
    RATE_LIMITED(true),
    /** No collector exists for this channel in this deployment. */
    CONNECTOR_UNAVAILABLE(false),
    /** The deployment is missing configuration the collection needs. */
    CONFIGURATION_REQUIRED(false),
    EXECUTION_FAILED(true),
    /** The attempt that was observing this source stopped without finishing (process crash, lease loss). */
    INTERRUPTED(true),
    /** The responsibility was paused or stopped while the source was being observed. */
    CANCELLED(false),
    DEVICE_OFFLINE(true),
    STORE_MISMATCH(false),
    STORE_UNRESOLVED(false);

    private final boolean retryable;

    SourceFailureReason(boolean retryable) {
        this.retryable = retryable;
    }

    /** Whether trying the same source again later in the same window can plausibly change the answer. */
    public boolean retryable() {
        return retryable;
    }
}
