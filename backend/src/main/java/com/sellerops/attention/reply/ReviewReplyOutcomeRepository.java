package com.sellerops.attention.reply;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ReviewReplyOutcomeRepository extends JpaRepository<ReviewReplyOutcome, UUID> {

    /**
     * The prior effect of a command id within an org — the idempotency lookup, backed by
     * {@code uq_review_reply_outcome_org_command}. Org-scoped for the same reason the approval audit
     * key is; see {@link ReviewReplyOutcome}.
     */
    Optional<ReviewReplyOutcome> findByOrgIdAndCommandId(UUID orgId, String commandId);

    /**
     * The outcome recorded against a binding, if any — how "is this {@code submissionRef} spent?" is
     * answered. Backed by {@code uq_review_reply_outcome_submission_ref} (one outcome per binding).
     */
    Optional<ReviewReplyOutcome> findBySubmissionRef(String submissionRef);

    /**
     * The latest outcome recorded for a given approved version of a review — how the prep view shows
     * whether the CURRENT approved reply has been reported. Multiple outcomes can exist for one
     * version across retries (abort → re-mint → submit); the most recent is the one that describes
     * where things stand.
     */
    Optional<ReviewReplyOutcome> findTopByOrgIdAndReviewIdAndRecordedVersionOrderByCreatedAtDesc(
            UUID orgId, UUID reviewId, Integer recordedVersion);
}
