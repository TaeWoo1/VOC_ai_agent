package com.sellerops.reviewissue;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ReviewIssueFeedbackRepository extends JpaRepository<ReviewIssueFeedback, UUID> {

    /**
     * The prior effect of a command id within an org — the idempotency lookup, backed by
     * {@code uq_review_issue_feedback_org_command}. Org-scoped like every other reply/issue
     * idempotency key.
     */
    Optional<ReviewIssueFeedback> findByOrgIdAndCommandId(UUID orgId, String commandId);
}
