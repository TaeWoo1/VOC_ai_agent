package com.sellerops.attention.reply;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ReviewReplyApprovalAuditRepository
        extends JpaRepository<ReviewReplyApprovalAudit, UUID> {

    /**
     * The prior effect of a command id within an org — the idempotency lookup. Backed by
     * {@code uq_review_reply_approval_audit_org_command}; see {@link ReviewReplyApprovalAudit}
     * on why the key is org-scoped rather than approval-scoped.
     */
    Optional<ReviewReplyApprovalAudit> findByOrgIdAndCommandId(UUID orgId, String commandId);

    /** One review's approval history, oldest first. */
    List<ReviewReplyApprovalAudit> findAllByReviewReplyApprovalIdOrderByCreatedAtAsc(
            UUID reviewReplyApprovalId);
}
