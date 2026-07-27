package com.sellerops.reviewissue;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ReviewIssueEvidenceRepository extends JpaRepository<ReviewIssueEvidence, UUID> {

    /** Idempotency check for re-extraction over an already-processed review. */
    boolean existsByOrgIdAndIssueIdAndReviewIdAndUnitOrdinal(
            UUID orgId, UUID issueId, UUID reviewId, int unitOrdinal);

    /** Window count. Both bounds inclusive — window arithmetic is entirely in whole days. */
    long countByOrgIdAndIssueIdAndOccurredOnBetween(
            UUID orgId, UUID issueId, LocalDate fromInclusive, LocalDate toInclusive);

    /**
     * All-time evidence count. A separate method rather than a {@code between(LocalDate.MIN, MAX)}
     * call: {@code LocalDate.MIN} is year -999999999, which is outside what a Postgres {@code date}
     * can hold, so the "obvious" unbounded range would fail at the driver.
     */
    long countByOrgIdAndIssueId(UUID orgId, UUID issueId);

    /**
     * Whether any evidence predates a date. This is the fact the NEW judgement rests on: without it,
     * an old issue returning after a quiet spell would be announced as one the seller has never seen.
     */
    boolean existsByOrgIdAndIssueIdAndOccurredOnLessThan(UUID orgId, UUID issueId, LocalDate date);

    /**
     * Distinct evidence dates in a window, for counting how many WEEKS were active. Returned as
     * dates rather than a computed week number so the week boundaries live in Java next to the
     * threshold that reads them — a {@code date_trunc} in SQL would put half of the persistence rule
     * in the database and half in {@link ReviewIssueThresholds}.
     */
    @Query("""
            select distinct e.occurredOn from ReviewIssueEvidence e
            where e.orgId = :orgId and e.issueId = :issueId
              and e.occurredOn between :fromInclusive and :toInclusive
            """)
    List<LocalDate> distinctEvidenceDates(@Param("orgId") UUID orgId,
                                          @Param("issueId") UUID issueId,
                                          @Param("fromInclusive") LocalDate fromInclusive,
                                          @Param("toInclusive") LocalDate toInclusive);

    /**
     * Per-product evidence counts in a window, largest first. Unattributed rows are excluded — see
     * {@link ProductEvidenceCount}.
     */
    @Query("""
            select new com.sellerops.reviewissue.ProductEvidenceCount(e.productId, count(e))
            from ReviewIssueEvidence e
            where e.orgId = :orgId and e.issueId = :issueId
              and e.occurredOn between :fromInclusive and :toInclusive
              and e.productId is not null
            group by e.productId
            order by count(e) desc
            """)
    List<ProductEvidenceCount> productCounts(@Param("orgId") UUID orgId,
                                             @Param("issueId") UUID issueId,
                                             @Param("fromInclusive") LocalDate fromInclusive,
                                             @Param("toInclusive") LocalDate toInclusive);

    /** Evidence for one issue, newest first, for the drill-down that renders 대표 고객 표현. */
    List<ReviewIssueEvidence> findByOrgIdAndIssueIdOrderByOccurredOnDesc(UUID orgId, UUID issueId);
}
