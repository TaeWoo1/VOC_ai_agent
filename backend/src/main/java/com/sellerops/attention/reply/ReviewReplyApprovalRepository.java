package com.sellerops.attention.reply;

import jakarta.persistence.LockModeType;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ReviewReplyApprovalRepository extends JpaRepository<ReviewReplyApproval, UUID> {

    /**
     * The current approval for one review, org-scoped at the query boundary so a cross-org id
     * reads as absent rather than as a row someone else owns.
     */
    Optional<ReviewReplyApproval> findByOrgIdAndReviewId(UUID orgId, UUID reviewId);

    /**
     * As {@link #findByOrgIdAndReviewId}, but takes a {@code PESSIMISTIC_WRITE} row lock — the
     * write path's read, used only inside {@link ReviewReplyApprovalWriter}'s transaction.
     *
     * <p>The lock is the only thing that makes the audit trail's {@code state_from} truthful
     * under concurrency: without it two callers both read the same predecessor and both record
     * having transitioned from it, which is an impossible history. Nothing collides in that
     * case (their command ids differ), so no constraint and no retry can detect it — it has to
     * be prevented, not recovered from. Same arrangement, same reason, as
     * {@code ReviewTriageRepository.lockByOrgIdAndReviewId}.
     *
     * <p>MUST be called inside a transaction; a pessimistic lock outside one is meaningless.
     * It is separate from the unlocked finder rather than replacing it, because the read path
     * displays an approval without wanting to write-lock it.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select a from ReviewReplyApproval a where a.orgId = :orgId and a.reviewId = :reviewId")
    Optional<ReviewReplyApproval> lockByOrgIdAndReviewId(@Param("orgId") UUID orgId,
                                                         @Param("reviewId") UUID reviewId);
}
