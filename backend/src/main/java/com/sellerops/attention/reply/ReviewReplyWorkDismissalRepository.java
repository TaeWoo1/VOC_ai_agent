package com.sellerops.attention.reply;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ReviewReplyWorkDismissalRepository
        extends JpaRepository<ReviewReplyWorkDismissal, UUID> {

    /**
     * The prior effect of a command id within an org — the idempotency lookup, backed by
     * {@code uq_review_reply_work_dismissal_org_command}. Org-scoped like every other reply-work
     * idempotency key; see {@link ReviewReplyWorkDismissal}.
     */
    Optional<ReviewReplyWorkDismissal> findByOrgIdAndCommandId(UUID orgId, String commandId);
}
