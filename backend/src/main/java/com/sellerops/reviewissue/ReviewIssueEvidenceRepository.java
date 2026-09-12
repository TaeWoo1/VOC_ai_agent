package com.sellerops.reviewissue;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
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

    /**
     * The issues one product has evidence for, most evidence first — the product specialist's entry
     * point into the issue memory. All-time, like {@code countByOrgIdAndIssueId}: a product question
     * is "무슨 문제가 있었나", and windowing it here would silently answer a different question than the
     * one {@code IssueWindows} already owns for trend.
     */
    @Query("""
            select e.issueId, count(e) from ReviewIssueEvidence e
            where e.orgId = :orgId and e.productId = :productId
            group by e.issueId
            order by count(e) desc, e.issueId asc
            """)
    List<Object[]> issueEvidenceCountsByProduct(@Param("orgId") UUID orgId,
                                                @Param("productId") UUID productId);

    /** Evidence rows this org holds that carry no product link — the unlinked coverage denominator. */
    long countByOrgIdAndProductIdIsNull(UUID orgId);

    /** All evidence rows this org holds — the coverage denominator's other half. */
    long countByOrgId(UUID orgId);

    /** Evidence for one issue, newest first, for the drill-down that renders 대표 고객 표현. */
    List<ReviewIssueEvidence> findByOrgIdAndIssueIdOrderByOccurredOnDesc(UUID orgId, UUID issueId);

    /**
     * The same evidence, capped — for a surface that wants «what else said this», not the whole file.
     *
     * <p>The Decision Workspace opens on ONE review and shows a handful of others that back the same
     * problem. Reading every evidence row to keep three of them would make opening a review cost more
     * the longer the seller has been running, and the issue page — which exists to show them all — is
     * one click away.
     */
    List<ReviewIssueEvidence> findByOrgIdAndIssueIdOrderByOccurredOnDesc(UUID orgId, UUID issueId,
                                                                        Pageable page);

    /**
     * The other direction: which repeated problems ONE review is evidence for.
     *
     * <p>Agent Object v1 — the exact review read answers 「왜 이런 리뷰가 나왔을까」 from this review's own
     * links. Bounded by the row itself (a review holds a handful of opinion units), and org-scoped like
     * every other read here.
     */
    List<ReviewIssueEvidence> findByOrgIdAndReviewId(UUID orgId, UUID reviewId);

    /**
     * {@code [min, max]} of the issue's remaining evidence dates, or an empty list when it has none —
     * re-derived after a retraction, because the issue's stored span only ever widened while nothing
     * could be deleted (Issue Evidence Trust Closure v1).
     */
    @Query("""
            select min(e.occurredOn), max(e.occurredOn) from ReviewIssueEvidence e
            where e.orgId = :orgId and e.issueId = :issueId
            """)
    List<Object[]> evidenceSpanRaw(@Param("orgId") UUID orgId, @Param("issueId") UUID issueId);

    default List<LocalDate> evidenceSpan(UUID orgId, UUID issueId) {
        List<Object[]> rows = evidenceSpanRaw(orgId, issueId);
        if (rows.isEmpty() || rows.get(0)[0] == null) {
            return List.of();
        }
        return List.of((LocalDate) rows.get(0)[0], (LocalDate) rows.get(0)[1]);
    }

    /**
     * Evidence rows in a KST date window for every issue of the org at once — the report's per-period
     * tally (Agentic Report v1). One query per period rather than one per issue.
     *
     * <p><b>Bucketed by the review's Asia/Seoul receipt date, not by {@code occurred_on}.</b>
     * {@code occurred_on} is the review's UTC date by the extraction contract, and every other window in
     * this package is UTC-consistent with it; the report's periods are the seller's calendar (the one the
     * Overview series bucket by), and a review received at 00:30 KST is that day's review, not yesterday's.
     * Measured on the Demo Org, 2026-09-04: 112 REAL reviews and 1,245 inquiries fall on a different day
     * in UTC than in KST. Native, because the conversion is the database's.
     */
    @Query(value = """
            select cast(e.issue_id as varchar), count(*)
            from review_issue_evidence e
            join reviews r on r.id = e.review_id
            where e.org_id = :orgId
              and (r.received_at at time zone 'Asia/Seoul')::date between :fromInclusive and :toInclusive
            group by e.issue_id
            """, nativeQuery = true)
    List<Object[]> issueCountsInWindow(@Param("orgId") UUID orgId,
                                       @Param("fromInclusive") LocalDate fromInclusive,
                                       @Param("toInclusive") LocalDate toInclusive);
}
