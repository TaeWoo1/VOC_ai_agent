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
    MANUAL_UPLOAD,
    /**
     * The Local Agent reading a seller-center screen the seller brought up, under their own connection —
     * Coupang WING 상품평, which Coupang exposes through no API and offers no export for.
     *
     * <p>Distinct from {@link #SELLER_CENTER_EXPORT} on purpose. That one names a file the channel produced,
     * which can be re-read, checked against, and pointed at afterwards. This one names a reading of a screen,
     * whose only evidence is what the agent returned — a weaker provenance, and the operator surface should
     * not have to infer the difference from a channel name.
     */
    SELLER_CENTER_READ
}
