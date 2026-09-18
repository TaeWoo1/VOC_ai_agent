package com.sellerops.operationscase;

import com.sellerops.inquiry.Inquiry;
import com.sellerops.review.Review;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/**
 * Every read is org-scoped in the query itself. An OperationsCase names customers' inquiries and reviews; a read
 * that crossed organisations would put one seller's customers on another seller's screen or into another seller's
 * investigation. {@code OperationsCaseSafetyFenceTest} asserts every declaration here takes an org.
 */
public interface OperationsCaseRepository extends JpaRepository<OperationsCase, UUID> {

    /** Has this exact observed state already been processed — whatever became of the case afterwards? */
    Optional<OperationsCase> findByOrgIdAndSubjectKindAndSubjectIdAndSignature(
            UUID orgId, OperationsSubjectKind subjectKind, UUID subjectId, String signature);

    /** The single open case for a subject — {@code uq_proactive_case_open_subject} guarantees at most one. */
    Optional<OperationsCase> findByOrgIdAndSubjectKindAndSubjectIdAndStatus(
            UUID orgId, OperationsSubjectKind subjectKind, UUID subjectId, OperationsCaseStatus status);

    Optional<OperationsCase> findByIdAndOrgId(UUID id, UUID orgId);

    List<OperationsCase> findByOrgIdAndResponsibilityIdAndStatusOrderByCreatedAtAsc(
            UUID orgId, UUID responsibilityId, OperationsCaseStatus status, Pageable page);

    List<OperationsCase> findByOrgIdAndResponsibilityIdAndCaseKindAndStatusOrderByCreatedAtDesc(
            UUID orgId, UUID responsibilityId, OperationsCaseKind caseKind, OperationsCaseStatus status,
            Pageable page);

    long countByOrgIdAndResponsibilityIdAndCaseKindAndStatus(
            UUID orgId, UUID responsibilityId, OperationsCaseKind caseKind, OperationsCaseStatus status);

    List<OperationsCase> findByOrgIdAndResponsibilityIdAndDispositionAndCreatedAtGreaterThanEqualOrderByCreatedAtDesc(
            UUID orgId, UUID responsibilityId, CaseDisposition disposition, Instant since, Pageable page);

    long countByOrgIdAndResponsibilityIdAndDispositionAndCreatedAtGreaterThanEqual(
            UUID orgId, UUID responsibilityId, CaseDisposition disposition, Instant since);

    /** Everything Reviewnary looked at in a window, whatever it concluded — the 「확인했습니다」 count. */
    long countByOrgIdAndResponsibilityIdAndCaseKindAndCreatedAtGreaterThanEqual(
            UUID orgId, UUID responsibilityId, OperationsCaseKind caseKind, Instant since);

    long countByOrgIdAndResponsibilityIdAndPreparedActionAndCreatedAtGreaterThanEqual(
            UUID orgId, UUID responsibilityId, CasePreparedAction preparedAction, Instant since);

    List<OperationsCase> findByOrgIdAndResponsibilityIdAndStatusAndNotifiedAtIsNull(
            UUID orgId, UUID responsibilityId, OperationsCaseStatus status);

    /** Recent cases of the same kind on the same product — the investigator's «recent similar cases» tool. */
    List<OperationsCase> findTop3ByOrgIdAndSubjectKindAndProductIdAndIdNotOrderByCreatedAtDesc(
            UUID orgId, OperationsSubjectKind subjectKind, UUID productId, UUID excludedCaseId);

    // ── candidates: rows already collected, in this responsibility's scope ────────────────────────────────────

    @Query("""
            select i from Inquiry i
            where i.orgId = :orgId and i.sellerAccountId = :accountId
              and i.dataOrigin = com.sellerops.common.DataOrigin.REAL
              and i.createdAt > :since
            order by i.createdAt asc, i.id asc
            """)
    List<Inquiry> inquiryCandidates(@Param("orgId") UUID orgId, @Param("accountId") UUID accountId,
                                    @Param("since") Instant since, Pageable page);

    @Query("""
            select r from Review r
            where r.orgId = :orgId and r.channelId = :channelId
              and r.dataOrigin = com.sellerops.common.DataOrigin.REAL
              and r.createdAt > :since
            order by r.createdAt asc, r.id asc
            """)
    List<Review> reviewCandidates(@Param("orgId") UUID orgId, @Param("channelId") UUID channelId,
                                  @Param("since") Instant since, Pageable page);

    /**
     * When this responsibility first READ a source completely — the boundary between what was already there when
     * the job was handed over (owned by the existing screens) and what arrived after it (the responsibility's).
     */
    @Query("""
            select min(s.observedAt) from ResponsibilityRunSource s, ResponsibilityRun r
            where r.id = s.runId and r.responsibilityId = :responsibilityId and s.orgId = :orgId
              and s.sellerAccountId = :accountId and s.dataType = :dataType
              and s.completeness in (com.sellerops.responsibility.SourceCompleteness.COMPLETE,
                                     com.sellerops.responsibility.SourceCompleteness.BOUNDED)
            """)
    Instant firstSettledObservation(@Param("orgId") UUID orgId, @Param("responsibilityId") UUID responsibilityId,
                                    @Param("accountId") UUID accountId, @Param("dataType") String dataType);

    // ── canonical truth the reconciler and the investigator read ────────────────────────────────────────────

    @Query("""
            select count(t) > 0 from ReviewTriage t
            where t.orgId = :orgId and t.reviewId = :reviewId and t.decidedAt >= :since
            """)
    boolean reviewDecidedSince(@Param("orgId") UUID orgId, @Param("reviewId") UUID reviewId,
                               @Param("since") Instant since);

    /**
     * Did the connector's answered-elsewhere reconciliation complete this work item? That path writes an audit row whose
     * actor is the ingest connector and whose phase moves to COMPLETED ({@code InquiryWorkItemWriter}); a COMPLETED
     * phase without one came from the seller's own workflow.
     */
    @Query("""
            select count(a) > 0 from InquiryWorkItemAudit a
            where a.orgId = :orgId and a.workItemId = :workItemId and a.actor = :actor
              and a.phaseTo = com.sellerops.inquiry.workitem.InquiryWorkItemPhase.COMPLETED
            """)
    boolean completedByActor(@Param("orgId") UUID orgId, @Param("workItemId") UUID workItemId,
                             @Param("actor") String actor);

    @Query("""
            select t.disposition, count(t) from ReviewTriage t, Review r
            where r.id = t.reviewId and t.orgId = :orgId and r.orgId = :orgId and r.productId = :productId
            group by t.disposition
            """)
    List<Object[]> reviewDecisionsForProduct(@Param("orgId") UUID orgId, @Param("productId") UUID productId);

    @Query("""
            select d.authorKind, count(d) from InquiryReplyDraft d, InquiryWorkItem w, Inquiry i
            where d.workItemId = w.id and w.inquiryId = i.id
              and d.orgId = :orgId and i.orgId = :orgId and i.productId = :productId
            group by d.authorKind
            """)
    List<Object[]> inquiryDraftAuthorsForProduct(@Param("orgId") UUID orgId, @Param("productId") UUID productId);

    /**
     * The individual review judgements this seller recorded on a product, newest first — the decisions themselves,
     * where {@link #reviewDecisionsForProduct} only counts them. Evidence for the next investigation; nothing reads
     * these to change a threshold or a policy.
     */
    @Query("""
            select t.disposition, t.decidedAt from ReviewTriage t, Review r
            where r.id = t.reviewId and t.orgId = :orgId and r.orgId = :orgId and r.productId = :productId
            order by t.decidedAt desc
            """)
    List<Object[]> recentReviewDecisionsForProduct(@Param("orgId") UUID orgId, @Param("productId") UUID productId,
                                                   Pageable page);

    /**
     * Where the seller disagreed with the system's own judgement and said so, newest first. Only
     * {@code STANDING} corrections are read: a withdrawn one is a trail entry, not this company's word.
     */
    @Query("""
            select c.shownTier, c.correctedTier, c.correctedAt from TriageCorrection c, Review r
            where r.id = c.reviewId and c.orgId = :orgId and r.orgId = :orgId and r.productId = :productId
              and c.state = com.sellerops.review.triage.feedback.SellerCorrectionState.STANDING
            order by c.correctedAt desc
            """)
    List<Object[]> recentTriageCorrectionsForProduct(@Param("orgId") UUID orgId, @Param("productId") UUID productId,
                                                     Pageable page);

    @Query("""
            select c from OperationsCase c
            where c.orgId = :orgId and c.responsibilityId in :responsibilityIds and c.status = :status
            """)
    List<OperationsCase> findOpenForResponsibilities(@Param("orgId") UUID orgId,
                                                     @Param("responsibilityIds") Collection<UUID> responsibilityIds,
                                                     @Param("status") OperationsCaseStatus status);
}
