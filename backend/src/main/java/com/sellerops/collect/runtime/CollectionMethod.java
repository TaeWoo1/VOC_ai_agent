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
    SELLER_CENTER_READ;

    /**
     * Did this run OBSERVE the channel at the moment it ran?
     *
     * <p>A guided export and a guided screen read both did: the seller was standing in front of their own
     * seller center and the file (or the screen) is what it held right then. A {@code MANUAL_UPLOAD} did not
     * — it is a file of unknown age, and an API pull is already answered by its own run row.
     *
     * <p>The distinction is what lets a guided import count as freshness. Before this, a guided import wrote
     * its run with no {@code dataType} at all, so {@code ChannelCoverageService.lastSuccessfulSync(org,
     * channel, "REVIEW")} could never see it: on 2026-09-02 a run landed 115 reviews and the product went on
     * telling the seller 「네이버 스마트스토어 리뷰는 아직 확인한 적이 없어요」 in the same answer that showed
     * them two of the reviews it had just collected.
     */
    public boolean observesChannel() {
        return this == SELLER_CENTER_EXPORT || this == SELLER_CENTER_READ;
    }
}
