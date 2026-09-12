package com.sellerops.review.triage.feedback;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface TriageCorrectionRepository extends JpaRepository<TriageCorrection, UUID> {

    Optional<TriageCorrection> findByPredictionId(UUID predictionId);

    Optional<TriageCorrection> findByReviewId(UUID reviewId);

    List<TriageCorrection> findByOrgIdAndReviewIdIn(UUID orgId, Collection<UUID> reviewIds);

    /**
     * The review's correction, locked for update.
     *
     * <p>Append-only composes only if {@code tierFrom} names the REAL predecessor. Two concurrent
     * presses would otherwise both read the standing tier and both record leaving it — two rows, one
     * predecessor, an impossible history — and no constraint can catch it, because nothing collides.
     * Same rule and same remedy as {@code ReviewTriageWriter} and {@code ReviewReplyApprovalWriter}.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select c from TriageCorrection c where c.reviewId = :reviewId")
    Optional<TriageCorrection> findByReviewIdForUpdate(@Param("reviewId") UUID reviewId);

    /** Corrections made while the pilot's mark was what was shown, over these reviews. */
    List<TriageCorrection> findByOrgIdAndShownSourceAndReviewIdIn(UUID orgId, TriageShownSource shown,
                                                                  Collection<UUID> reviewIds);

    /**
     * Standing corrections over these reviews — what the read paths and the funnel ask for.
     *
     * <p>A withdrawn correction is not a weaker answer, it is the absence of one: counting it would
     * report a disagreement the seller has taken back.
     */
    List<TriageCorrection> findByOrgIdAndStateAndReviewIdIn(UUID orgId, SellerCorrectionState state,
                                                            Collection<UUID> reviewIds);

    List<TriageCorrection> findByOrgIdAndShownSourceAndStateAndReviewIdIn(
            UUID orgId, TriageShownSource shown, SellerCorrectionState state, Collection<UUID> reviewIds);
}
