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
    private final ReviewIssueRepository issues;
    private final IssueSignatureExtractor extractor;

    public ReviewIssueRefreshService(ReviewRepository reviews,
                                     ReviewIssueExtractionService extraction,
                                     ReviewIssueLifecycleService lifecycle,
                                     ReviewIssueRepository issues,
                                     IssueSignatureExtractor extractor) {
        this.reviews = reviews;
        this.extraction = extraction;
        this.lifecycle = lifecycle;
        this.issues = issues;
        this.extractor = extractor;
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
        Tally tally = new Tally();
        for (Review review : batch) {
            tally.add(extraction.extract(review));
        }
        AutomaticPassResult pass = lifecycle.runAutomaticPass(orgId, referenceDate);
        return tally.result(batch.size(), pass);
    }

    /**
     * The whole corpus, page by page, then stamp every issue with the extractor that now vouches for
     * its evidence (Issue Evidence Trust Closure v1).
     *
     * <p>Exists because {@link #refresh} is bounded to the NEWEST reviews — right for an after-ingest
     * pass, and useless for the case a better extractor creates: evidence written by the old one sits
     * on reviews of every age. The stamp is what makes this run once per extractor version rather than
     * on every boot: {@link ReviewIssueReextractionRunner} visits only orgs that still hold an issue
     * stamped with another version. Reads and writes the database only.
     */
    @Transactional
    public IssueRefreshResult reextractAll(UUID orgId, LocalDate referenceDate) {
        Tally tally = new Tally();
        int scanned = 0;
        for (int page = 0;; page++) {
            List<Review> batch = reviews.findForIssueExtraction(orgId, PageRequest.of(page, REEXTRACT_PAGE));
            for (Review review : batch) {
                tally.add(extraction.extract(review));
            }
            scanned += batch.size();
            if (batch.size() < REEXTRACT_PAGE) {
                break;
            }
        }
        AutomaticPassResult pass = lifecycle.runAutomaticPass(orgId, referenceDate);
        for (ReviewIssue issue : issues.findByOrgIdAndExtractorVersionNot(orgId, extractor.version())) {
            issue.setExtractorKind(extractor.kind());
            issue.setExtractorVersion(extractor.version());
            issues.save(issue);
        }
        return tally.result(scanned, pass);
    }

    /** Page size for the full pass — small enough that one page's rows stay a modest transaction step. */
    static final int REEXTRACT_PAGE = 500;

    private static final class Tally {
        int evidenceAdded;
        int evidenceRemoved;
        int unknownAdded;
        int issuesCreated;
        int reopened;

        void add(ExtractionResult result) {
            evidenceAdded += result.evidenceAdded();
            evidenceRemoved += result.evidenceRemoved();
            unknownAdded += result.unknownAdded();
            issuesCreated += result.issuesCreated();
            reopened += result.issuesReopened();
        }

        IssueRefreshResult result(int scanned, AutomaticPassResult pass) {
            return new IssueRefreshResult(scanned, evidenceAdded, unknownAdded, issuesCreated, reopened,
                    pass.raisedForReview(), pass.resolved(), evidenceRemoved);
        }
    }

    /**
     * What one refresh changed. All zeros with a non-zero {@code reviewsScanned} is the normal, correct
     * result of a re-run over already-extracted reviews — reported, not hidden.
     */
    public record IssueRefreshResult(int reviewsScanned, int evidenceAdded, int unknownAdded,
                                     int issuesCreated, int issuesReopened,
                                     int raisedForReview, int resolved, int evidenceRemoved) {

        /** The seven-number shape callers built before retraction existed. */
        public IssueRefreshResult(int reviewsScanned, int evidenceAdded, int unknownAdded,
                                  int issuesCreated, int issuesReopened, int raisedForReview, int resolved) {
            this(reviewsScanned, evidenceAdded, unknownAdded, issuesCreated, issuesReopened,
                    raisedForReview, resolved, 0);
        }
    }
}
