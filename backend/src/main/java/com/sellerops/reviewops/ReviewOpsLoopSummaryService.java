package com.sellerops.reviewops;

import com.sellerops.reviewimport.ReviewImportQueryService;
import com.sellerops.reviewimport.dto.ReviewImportHealthView;
import com.sellerops.reviewissue.ReviewIssueQueryService;
import com.sellerops.reviewissue.dto.ReviewIssueView;
import com.sellerops.reviewops.dto.IssueChangeCountsView;
import com.sellerops.reviewops.dto.ReviewOpsLoopSummaryView;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Composes the repeated review-operations loop's completion + change summary at READ time from the two
 * subsystems that already own the truth: the review-import coverage/health projection and the issue-memory
 * change judgements. It stores nothing — this is the lock-minimal "완료 결과 projection" the §1.7 carve-out
 * (2026-07-27) allows: a derived view, not a new durable {@code OperationRun} record.
 *
 * <p>It is the one place review-import and review-issue meet on the read side; keeping the composition here
 * lets each subsystem stay unaware of the other's read model (the only other coupling is the after-ingest
 * refresh event, which points the other way).
 */
@Service
public class ReviewOpsLoopSummaryService {

    private static final String NEEDS_REVIEW = "NEEDS_REVIEW";
    private static final String KIND_NEW = "NEW";
    private static final String KIND_SURGING = "SURGING";
    private static final String KIND_PERSISTENT = "PERSISTENT";
    private static final String KIND_CONCENTRATED = "CONCENTRATED";
    private static final String KIND_IMPROVED = "IMPROVED";

    private final ReviewImportQueryService imports;
    private final ReviewIssueQueryService issues;

    public ReviewOpsLoopSummaryService(ReviewImportQueryService imports, ReviewIssueQueryService issues) {
        this.imports = imports;
        this.issues = issues;
    }

    @Transactional(readOnly = true)
    public ReviewOpsLoopSummaryView summary(UUID orgId, UUID sellerAccountId, LocalDate referenceDate) {
        ReviewImportHealthView health = imports.health(orgId, sellerAccountId);
        List<ReviewIssueView> working = issues.list(orgId, referenceDate, false);

        int needsReview = 0;
        int newlyRaised = 0;
        int surging = 0;
        int persistent = 0;
        int concentrated = 0;
        int improved = 0;
        for (ReviewIssueView issue : working) {
            if (NEEDS_REVIEW.equals(issue.lifecycleState())) {
                needsReview++;
            }
            List<String> kinds = issue.change() == null ? List.of() : issue.change().kinds();
            if (kinds.contains(KIND_NEW)) {
                newlyRaised++;
            }
            if (kinds.contains(KIND_SURGING)) {
                surging++;
            }
            if (kinds.contains(KIND_PERSISTENT)) {
                persistent++;
            }
            if (kinds.contains(KIND_CONCENTRATED)) {
                concentrated++;
            }
            if (kinds.contains(KIND_IMPROVED)) {
                improved++;
            }
        }

        LocalDate next = health.nextRecommendedImport();
        boolean upToDate = health.missingRanges().isEmpty()
                && (next == null || next.isAfter(referenceDate));

        return new ReviewOpsLoopSummaryView(
                referenceDate,
                health.lastCoveredDate(),
                health.missingRanges(),
                next,
                upToDate,
                health.newCount(),
                health.duplicateCount(),
                health.failedCount(),
                new IssueChangeCountsView(working.size(), needsReview, newlyRaised, surging,
                        persistent, concentrated, improved));
    }
}
