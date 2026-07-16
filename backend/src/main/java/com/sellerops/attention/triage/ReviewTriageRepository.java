package com.sellerops.attention.triage;

import jakarta.persistence.LockModeType;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ReviewTriageRepository extends JpaRepository<ReviewTriage, UUID> {

    /**
     * The current decision for one review, org-scoped at the query boundary so a cross-org
     * id reads as absent rather than as a row someone else owns.
     */
    Optional<ReviewTriage> findByOrgIdAndReviewId(UUID orgId, UUID reviewId);

    /**
     * As {@link #findByOrgIdAndReviewId}, but takes a {@code PESSIMISTIC_WRITE} row lock —
     * the write path's read, used only inside {@link ReviewTriageWriter}'s transaction.
     *
     * <p>The lock is the only thing that makes the audit trail's
     * {@code disposition_from} truthful under concurrency: without it two callers both read
     * the same predecessor and both record having transitioned from it, which is an
     * impossible history. Nothing collides in that case (their command ids differ), so no
     * constraint and no retry can detect it — it has to be prevented, not recovered from.
     *
     * <p>MUST be called inside a transaction; a pessimistic lock outside one is meaningless
     * (the lock would be released immediately). It is separate from the unlocked finder
     * rather than replacing it, because the read path resolves dispositions for a whole page
     * and must never take write locks on rows it is only displaying.
     *
     * <p>The first {@code @Lock} in this codebase — see {@link ReviewTriageWriter} for why
     * this write needs serializing where the inquiry writers did not (they transition a row
     * that already exists, guarded by a UNIQUE constraint on the target state; this one
     * carries a from→to chain that must compose).
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select t from ReviewTriage t where t.orgId = :orgId and t.reviewId = :reviewId")
    Optional<ReviewTriage> lockByOrgIdAndReviewId(@Param("orgId") UUID orgId, @Param("reviewId") UUID reviewId);

    /**
     * Decisions for a page of reviews — ONE batch query per drill-down page, never a
     * per-row lookup, matching how {@code IngestedReviewVocItemSource} resolves product
     * names. The id set is bounded by the clamped page size
     * ({@code OperatorAttentionService.MAX_PAGE_SIZE}) and each id hits the unique index on
     * {@code review_id}, so the cost is a page, not the table.
     *
     * <p>The {@code orgId} filter is load-bearing, not tidiness: an id read off a review row
     * is not proof of same-org ownership, so a cross-org id simply resolves to no entry and
     * the row's disposition comes out null.
     */
    List<ReviewTriage> findAllByOrgIdAndReviewIdIn(UUID orgId, Collection<UUID> reviewIds);
}
