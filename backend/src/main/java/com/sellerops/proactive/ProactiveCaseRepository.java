package com.sellerops.proactive;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/**
 * Every read here is org-scoped in the query itself, not by a filter a caller might forget. A
 * proactive case names an inquiry, a review and a product; a read that crossed orgs would put one
 * seller's customers on another seller's screen, and {@code ProactiveSafetyFenceTest} asserts that no
 * method on this interface takes a subject without also taking an org.
 */
public interface ProactiveCaseRepository extends JpaRepository<ProactiveCase, UUID> {

    /** The exact investigation, if it has already been done against this source state. */
    Optional<ProactiveCase> findByOrgIdAndSubjectKindAndSubjectIdAndSignature(
            UUID orgId, ProactiveSubjectKind subjectKind, UUID subjectId, String signature);

    /** The single open case for a subject — the partial unique index guarantees at most one. */
    Optional<ProactiveCase> findByOrgIdAndSubjectKindAndSubjectIdAndStatus(
            UUID orgId, ProactiveSubjectKind subjectKind, UUID subjectId, ProactiveCaseStatus status);

    /**
     * One org's open cases, most urgent first — the list surface's read.
     *
     * <p>Ordered by the priority's stored name rather than by a rank column: HIGH sorts before NORMAL
     * alphabetically, and pinning the order in SQL to an accident of spelling is exactly the kind of
     * thing that breaks when a third priority arrives. The service re-sorts by
     * {@link ProactivePriority#rank()}, which is the declared order; this ORDER BY is only so a
     * bounded page is stable.
     */
    @Query("select c from ProactiveCase c where c.orgId = :orgId and c.status = :status "
            + "order by c.priority asc, c.createdAt desc, c.id asc")
    List<ProactiveCase> findOpen(@Param("orgId") UUID orgId,
                                 @Param("status") ProactiveCaseStatus status,
                                 Pageable pageable);

    /** Every open case for the reconciler to re-derive. Bounded by the caller. */
    @Query("select c from ProactiveCase c where c.orgId = :orgId and c.status = :status "
            + "order by c.createdAt asc, c.id asc")
    List<ProactiveCase> findForReconcile(@Param("orgId") UUID orgId,
                                         @Param("status") ProactiveCaseStatus status,
                                         Pageable pageable);

    long countByOrgIdAndStatus(UUID orgId, ProactiveCaseStatus status);

    long countByOrgIdAndStatusAndPriority(UUID orgId, ProactiveCaseStatus status, ProactivePriority priority);

    /** Org-scoped by id — the detail read. Never {@code findById} alone. */
    Optional<ProactiveCase> findByIdAndOrgId(UUID id, UUID orgId);

    /**
     * The two ends of the retention measure, for cases the seller actually acted on.
     *
     * <p>Timestamps rather than a computed interval, and bounded by the caller. A SQL interval
     * arithmetic expression would tie this read to one dialect for a number the caller can work out
     * from two columns; and an unbounded read of every case an org ever had is not a metric, it is a
     * table scan wearing one.
     */
    @Query("select c.createdAt, c.actedAt from ProactiveCase c "
            + "where c.orgId = :orgId and c.actedAt is not null order by c.actedAt desc")
    List<Object[]> actedTimestamps(@Param("orgId") UUID orgId, Pageable pageable);

    long countByOrgIdAndSurfacedAtIsNotNull(UUID orgId);

    long countByOrgIdAndOpenedAtIsNotNull(UUID orgId);

    long countByOrgIdAndPreparedAction(UUID orgId, ProactivePreparedAction preparedAction);

    long countByOrgIdAndCloseReason(UUID orgId, ProactiveCloseReason closeReason);
}
