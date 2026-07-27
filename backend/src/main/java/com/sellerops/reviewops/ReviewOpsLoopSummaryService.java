package com.sellerops.reviewops;

import com.sellerops.reviewimport.ReviewImportQueryService;
import com.sellerops.reviewimport.dto.ReviewImportHealthView;
import com.sellerops.reviewissue.ReviewIssueQueryService;
import com.sellerops.reviewissue.ReviewIssueRepository;
import com.sellerops.reviewissue.ReviewIssueUnknownUnitRepository;
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
    private final ReviewIssueRepository issueRepo;
    private final ReviewIssueUnknownUnitRepository unknownRepo;

    public ReviewOpsLoopSummaryService(ReviewImportQueryService imports, ReviewIssueQueryService issues,
                                       ReviewIssueRepository issueRepo,
                                       ReviewIssueUnknownUnitRepository unknownRepo) {
        this.imports = imports;
        this.issues = issues;
        this.issueRepo = issueRepo;
        this.unknownRepo = unknownRepo;
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

        // Up to date = coverage's forward edge reaches today. `nextRecommendedImport` is the earliest
        // still-remaining start when importable work remains, else lastCovered+1; either way it is > today
        // only when nothing importable is outstanding. A concluded-MISSING range is settled, NOT outstanding
        // work, so it must not force "not up to date" — that was a bug that made a MISSING plan permanently
        // stale and lit an inert extend button.
        LocalDate next = health.nextRecommendedImport();
        boolean upToDate = next == null || next.isAfter(referenceDate);

        // "Has the after-ingest refresh run?" — an account with reviews accounted for but a completely empty
        // issue memory (no issues AND no UNKNOWN units) has not been extracted, so its zero change-counts
        // must read as "not yet updated", never as "no change". Read-derived; no durable state.
        boolean anyReviewsAccounted = health.newCount() + health.duplicateCount() > 0;
        boolean issueMemoryReady = !anyReviewsAccounted
                || issueRepo.existsByOrgId(orgId) || unknownRepo.existsByOrgId(orgId);

        return new ReviewOpsLoopSummaryView(
                referenceDate,
                health.lastCoveredDate(),
                health.missingRanges(),
                next,
                upToDate,
                health.newCount(),
                health.duplicateCount(),
                health.failedCount(),
                issueMemoryReady,
                new IssueChangeCountsView(working.size(), needsReview, newlyRaised, surging,
                        persistent, concentrated, improved));
    }
}
