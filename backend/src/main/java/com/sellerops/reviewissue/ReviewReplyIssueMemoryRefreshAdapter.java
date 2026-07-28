package com.sellerops.reviewissue;

import com.sellerops.attention.reply.IssueMemoryRefreshPort;
import java.time.LocalDate;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * Wires the reply loop's {@link IssueMemoryRefreshPort} to {@link ReviewIssueRefreshService} — the
 * ONE place the reply domain reaches the issue domain, and it does so through the port so the
 * dependency points inward (reply declares the seam; issue implements it).
 *
 * <p><b>Best-effort, in its own transaction.</b> {@link ReviewIssueRefreshService#refresh} is
 * {@code @Transactional}; invoked here from a non-transactional reply path it runs in its own
 * transaction, so a failure rolls back only the refresh — never the already-committed reported
 * outcome. A thrown exception is swallowed to {@code false} and logged; the memory stays consistent
 * because the refresh is idempotent and the next ingest/reply/manual extract brings it current.
 *
 * <p><b>Bounded small.</b> A reply's real refresh value is re-running the lifecycle pass (org-wide,
 * independent of the cap); re-extraction over already-extracted reviews is idempotent and adds
 * nothing, so a small cap keeps the after-reply pass cheap. Honesty carries over unchanged: the
 * thresholds are DRAFT and the extractor is UNMEASURED.
 */
@Component
class ReviewReplyIssueMemoryRefreshAdapter implements IssueMemoryRefreshPort {

    private static final Logger log = LoggerFactory.getLogger(ReviewReplyIssueMemoryRefreshAdapter.class);

    /** Enough recent reviews to cover a just-answered one; the lifecycle pass re-runs over all issues. */
    private static final int AFTER_REPLY_MAX_REVIEWS = 500;

    private final ReviewIssueRefreshService refresh;

    ReviewReplyIssueMemoryRefreshAdapter(ReviewIssueRefreshService refresh) {
        this.refresh = refresh;
    }

    @Override
    public boolean refreshAfterReply(UUID orgId, LocalDate referenceDate) {
        try {
            refresh.refresh(orgId, referenceDate, AFTER_REPLY_MAX_REVIEWS);
            return true;
        } catch (RuntimeException e) {
            // Best-effort: the reported outcome already committed. Do not rethrow — that would fail an
            // (already-successful) reply record. The surface shows "분석 미갱신" from the false return.
            log.warn("Review issue-memory refresh after reply failed (best-effort; reply record unaffected): {}",
                    e.toString());
            return false;
        }
    }
}
