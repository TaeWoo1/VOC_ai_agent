package com.sellerops.review.publish;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ReviewReplyExecutionRepository extends JpaRepository<ReviewReplyExecution, UUID> {

    /** The idempotency lookup, backed by {@code uq_review_reply_execution_org_command}. */
    Optional<ReviewReplyExecution> findByOrgIdAndCommandId(UUID orgId, String commandId);

    /** Where things stand for one approved version of a review — the most recent row. */
    Optional<ReviewReplyExecution> findTopByOrgIdAndReviewIdAndApprovedVersionOrderByCreatedAtDesc(
            UUID orgId, UUID reviewId, Integer approvedVersion);

    /**
     * Whether the API lane already sent (or may have sent) a reply for this review — the
     * per-review double-post guard, backed by {@code uq_review_reply_execution_api_sent}.
     */
    boolean existsByOrgIdAndReviewIdAndLaneAndStatusIn(UUID orgId, UUID reviewId, ReviewExecutionLane lane,
                                                        java.util.Collection<ReviewExecutionStatus> statuses);

    /** The most recent guided observation for one binding. */
    Optional<ReviewReplyExecution> findTopByOrgIdAndSubmissionRefOrderByCreatedAtDesc(UUID orgId,
                                                                                       String submissionRef);
}
