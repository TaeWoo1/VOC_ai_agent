package com.sellerops.collect.runtime;

/**
 * How a collection run obtained its data — a first-class dimension orthogonal to
 * {@code SyncJob.trigger} (which says <em>why</em> a run started, not <em>how</em> it
 * collected). Stored in {@code sync_jobs.method}.
 */
public enum CollectionMethod {
    /** Official partner/open API pull (the existing scheduled SyncRunExecutor path). */
    API,
    /** Supervised seller-center export captured by the browser collector (NAVER review = verified). */
    SELLER_CENTER_EXPORT,
    /** A human-uploaded export file (the existing /api/uploads path). */
    MANUAL_UPLOAD
}
