package com.sellerops.reviewissue;

import com.sellerops.reviewimport.ReviewSegmentIngestedEvent;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * Refreshes the repeated-issue memory after a review-import segment lands, so the issue list reflects the
 * reviews just collected without an operator having to POST {@code /api/review-issues/extract} by hand.
 * This is the "ingest → 정규화·분석" step of the review-operations loop (product-scope §1.7 carve-out,
 * 2026-07-27) — analysis over already-collected data, never a marketplace action.
 *
 * <p><b>Why AFTER_COMMIT, in a new transaction, best-effort.</b> The collection result is the durable
 * truth; the analysis refresh is a follow-on. Consuming the event only after the ingest transaction
 * commits, in {@link Propagation#REQUIRES_NEW}, means a slow or failing refresh can never roll back or
 * fail the import that produced the reviews. A thrown exception is swallowed with a log — the next ingest
 * (or a manual {@code /extract}) will bring the memory current again, because the refresh is idempotent.
 */
@Component
public class ReviewIssueImportRefreshListener {

    private static final Logger log = LoggerFactory.getLogger(ReviewIssueImportRefreshListener.class);

    /** After one segment (≈ one calendar month) the newest few thousand reviews cover what just landed. */
    private static final int MAX_REVIEWS_PER_REFRESH = 2000;

    private final ReviewIssueRefreshService refresh;

    public ReviewIssueImportRefreshListener(ReviewIssueRefreshService refresh) {
        this.refresh = refresh;
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void onSegmentIngested(ReviewSegmentIngestedEvent event) {
        try {
            refresh.refresh(event.orgId(), event.referenceDate(), MAX_REVIEWS_PER_REFRESH);
        } catch (RuntimeException e) {
            // Best-effort: the import already committed. Do not rethrow — that would only fail the
            // (already-successful) request. The memory stays consistent because the refresh is idempotent.
            log.warn("Review issue-memory refresh after ingest failed (best-effort; collection unaffected): {}",
                    e.toString());
        }
    }
}
