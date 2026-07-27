package com.sellerops.reviewissue;

import com.sellerops.reviewissue.IssueWindows.DateRange;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Assembles the aggregate counts one issue's judgements need. The only layer that touches both the
 * database and {@link IssueWindows}; {@link IssueChangeRules} stays pure and receives nothing but
 * numbers.
 *
 * <p>{@code referenceDate} is always a parameter. That is what makes a weekly report reproducible
 * ("what did this look like on the 18th") and what keeps the judgements testable at their exact
 * boundaries.
 */
@Service
public class ReviewIssueSnapshotService {

    private final ReviewIssueEvidenceRepository evidence;

    public ReviewIssueSnapshotService(ReviewIssueEvidenceRepository evidence) {
        this.evidence = evidence;
    }

    /** Aggregate one issue over every window the four judgements plus improvement need. */
    @Transactional(readOnly = true)
    public IssueWindowSnapshot snapshot(UUID orgId, UUID issueId, LocalDate referenceDate) {
        DateRange newWindow = IssueWindows.trailing(referenceDate,
                ReviewIssueThresholds.NEW_WINDOW_DAYS);
        DateRange surgeWindow = IssueWindows.trailing(referenceDate,
                ReviewIssueThresholds.SURGE_WINDOW_DAYS);
        DateRange surgeBaseline = IssueWindows.precedingBlock(referenceDate,
                ReviewIssueThresholds.SURGE_WINDOW_DAYS, ReviewIssueThresholds.surgeBaselineDays());
        DateRange concentrationWindow = IssueWindows.trailing(referenceDate,
                ReviewIssueThresholds.CONCENTRATION_WINDOW_DAYS);
        DateRange improveWindow = IssueWindows.trailing(referenceDate,
                ReviewIssueThresholds.IMPROVE_WINDOW_WEEKS * 7);
        DateRange improveBaseline = IssueWindows.precedingBlock(referenceDate,
                ReviewIssueThresholds.IMPROVE_WINDOW_WEEKS * 7,
                ReviewIssueThresholds.IMPROVE_BASELINE_WEEKS * 7);
        DateRange persistLookback = IssueWindows.trailing(referenceDate,
                ReviewIssueThresholds.persistLookbackDays());

        List<LocalDate> activeDates = evidence.distinctEvidenceDates(
                orgId, issueId, persistLookback.fromInclusive(), persistLookback.toInclusive());
        int activeWeeks = IssueWindows.activeWeekCount(
                IssueWindows.trailingWeeks(referenceDate, ReviewIssueThresholds.PERSIST_LOOKBACK_WEEKS),
                activeDates);

        long concentrationTotal = count(orgId, issueId, concentrationWindow);
        // Largest product only. The query already excludes unattributed rows, so an issue whose
        // reviews have no product mapping yields 0 here rather than a spurious 100% share.
        List<ProductEvidenceCount> byProduct = evidence.productCounts(
                orgId, issueId, concentrationWindow.fromInclusive(), concentrationWindow.toInclusive());
        long topProduct = byProduct.isEmpty() ? 0L : byProduct.get(0).evidenceCount();

        return new IssueWindowSnapshot(
                count(orgId, issueId, newWindow),
                evidence.existsByOrgIdAndIssueIdAndOccurredOnLessThan(
                        orgId, issueId, newWindow.fromInclusive()),
                count(orgId, issueId, surgeWindow),
                count(orgId, issueId, surgeBaseline),
                activeWeeks,
                concentrationTotal,
                topProduct,
                count(orgId, issueId, improveWindow),
                count(orgId, issueId, improveBaseline));
    }

    /**
     * The issue's dominant product over the concentration window, or null when nothing is
     * attributable. Separate from the snapshot because the snapshot deliberately carries counts only,
     * so that no judgement can reach an identifier.
     */
    @Transactional(readOnly = true)
    public UUID dominantProductId(UUID orgId, UUID issueId, LocalDate referenceDate) {
        DateRange window = IssueWindows.trailing(referenceDate,
                ReviewIssueThresholds.CONCENTRATION_WINDOW_DAYS);
        List<ProductEvidenceCount> byProduct = evidence.productCounts(
                orgId, issueId, window.fromInclusive(), window.toInclusive());
        return byProduct.isEmpty() ? null : byProduct.get(0).productId();
    }

    /** Whether an issue has had no new evidence for the quiet period that permits RESOLVED. */
    @Transactional(readOnly = true)
    public boolean quietLongEnoughToResolve(UUID orgId, UUID issueId, LocalDate referenceDate) {
        DateRange quiet = IssueWindows.trailing(referenceDate,
                ReviewIssueThresholds.RESOLVE_QUIET_WEEKS * 7);
        return count(orgId, issueId, quiet) == 0;
    }

    private long count(UUID orgId, UUID issueId, DateRange range) {
        return evidence.countByOrgIdAndIssueIdAndOccurredOnBetween(
                orgId, issueId, range.fromInclusive(), range.toInclusive());
    }
}
