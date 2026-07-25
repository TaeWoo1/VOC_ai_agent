package com.sellerops.reviewimport;

/**
 * Lifecycle of a {@link ReviewImportLaunch}. A ticket is the whole authorization for one guided run, so
 * it is deliberately SINGLE USE — the terminal states exist to make replay impossible rather than to
 * describe progress.
 */
public enum ReviewImportLaunchStatus {

    /** Outstanding: the runtime may resolve it and complete its run exactly once. */
    ISSUED,

    /** Spent — discovery produced a plan, or a segment run's file was ingested. Never reusable. */
    CONSUMED,

    /**
     * Abandoned without being spent (the seller cancelled, or the run never finished). Kept rather than
     * deleted so the history shows an import was attempted, and superseded by a freshly issued ticket.
     */
    EXPIRED
}
