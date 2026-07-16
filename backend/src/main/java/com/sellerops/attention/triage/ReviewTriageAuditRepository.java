package com.sellerops.attention.triage;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ReviewTriageAuditRepository extends JpaRepository<ReviewTriageAudit, UUID> {

    /**
     * The prior effect of a command id within an org — the idempotency lookup. Backed by
     * {@code uq_review_triage_audit_org_command}; see {@link ReviewTriageAudit} on why the
     * key is org-scoped rather than triage-scoped.
     */
    Optional<ReviewTriageAudit> findByOrgIdAndCommandId(UUID orgId, String commandId);

    /** One review's decision history, oldest first. */
    List<ReviewTriageAudit> findAllByReviewTriageIdOrderByCreatedAtAsc(UUID reviewTriageId);
}
