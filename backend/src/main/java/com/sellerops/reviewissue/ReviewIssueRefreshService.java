package com.sellerops.reviewissue;

import com.sellerops.review.Review;
import com.sellerops.review.ReviewRepository;
import com.sellerops.reviewissue.ReviewIssueExtractionService.ExtractionResult;
import com.sellerops.reviewissue.ReviewIssueLifecycleService.AutomaticPassResult;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * One bounded, idempotent pass that brings the issue memory up to date after new reviews land: extract the
 * newest reviews into evidence, then run the two automatic lifecycle transitions. This is what the repeated
 * review-operations loop calls after a segment ingests (via {@code ReviewSegmentIngestedEvent}), and it is
 * the same work {@code POST /api/review-issues/extract} + {@code /lifecycle-pass} do by hand.
 *
 * <p><b>Bounded on purpose.</b> {@code findForIssueExtraction} orders newest-first, so page 0 with a cap is
 * exactly the reviews a fresh import just added (plus a little recent overlap). Extraction is idempotent by
 * key, so the overlap re-attaches nothing and mints no duplicate — the cap keeps an after-ingest refresh
 * cheap without needing a per-review "already extracted" bookmark.
 *
 * <p><b>Honesty carry-over.</b> Everything downstream still speaks in unvalidated candidate signals: the
 * thresholds are DRAFT and the extractor's accuracy is UNMEASURED ({@code contracts/review-issue/v1/THRESHOLDS.md}).
 * This service only moves that same machinery; it upgrades no claim.
 */
@Service
public class ReviewIssueRefreshService {

    /** A hard ceiling so an after-ingest refresh can never turn into a full-corpus scan on the request thread. */
    public static final int MAX_REVIEWS_CEILING = 5000;

    private final ReviewRepository reviews;
    private final ReviewIssueExtractionService extraction;
    private final ReviewIssueLifecycleService lifecycle;

    public ReviewIssueRefreshService(ReviewRepository reviews,
                                     ReviewIssueExtractionService extraction,
                                     ReviewIssueLifecycleService lifecycle) {
        this.reviews = reviews;
        this.extraction = extraction;
        this.lifecycle = lifecycle;
    }

    /**
     * Extract up to {@code maxReviews} of the org's newest reviews into the issue memory, then apply the
     * automatic lifecycle pass for {@code referenceDate}. Idempotent for a given input, so it is safe to
     * re-run after a failure and safe to call on every ingest.
     */
    @Transactional
    public IssueRefreshResult refresh(UUID orgId, LocalDate referenceDate, int maxReviews) {
        int limit = Math.max(1, Math.min(maxReviews, MAX_REVIEWS_CEILING));
        List<Review> batch = reviews.findForIssueExtraction(orgId, PageRequest.of(0, limit));
        int evidenceAdded = 0;
        int unknownAdded = 0;
        int issuesCreated = 0;
        int reopened = 0;
        for (Review review : batch) {
            ExtractionResult result = extraction.extract(review);
            evidenceAdded += result.evidenceAdded();
            unknownAdded += result.unknownAdded();
            issuesCreated += result.issuesCreated();
            reopened += result.issuesReopened();
        }
        AutomaticPassResult pass = lifecycle.runAutomaticPass(orgId, referenceDate);
        return new IssueRefreshResult(batch.size(), evidenceAdded, unknownAdded, issuesCreated, reopened,
                pass.raisedForReview(), pass.resolved());
    }

    /**
     * What one refresh changed. All zeros with a non-zero {@code reviewsScanned} is the normal, correct
     * result of a re-run over already-extracted reviews — reported, not hidden.
     */
    public record IssueRefreshResult(int reviewsScanned, int evidenceAdded, int unknownAdded,
                                     int issuesCreated, int issuesReopened,
                                     int raisedForReview, int resolved) {
    }
}
