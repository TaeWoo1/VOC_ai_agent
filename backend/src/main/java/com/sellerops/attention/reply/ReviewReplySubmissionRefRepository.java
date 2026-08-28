package com.sellerops.attention.reply;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ReviewReplySubmissionRefRepository
        extends JpaRepository<ReviewReplySubmissionRef, UUID> {

    /**
     * Resolve a minted binding, org-scoped at the query boundary so a cross-org ref reads as absent
     * rather than as a row someone else owns. The record path looks the binding up to learn which
     * approved (version, fingerprint) an outcome should be attributed to — the client never names
     * them.
     */
    Optional<ReviewReplySubmissionRef> findByOrgIdAndSubmissionRef(UUID orgId, String submissionRef);

    /**
     * Spend the ref for the Local Agent: exactly one UPDATE wins. Returns 0 when the ref was already
     * resolved, unknown, or belongs to another org — the caller treats every 0 as the same refusal.
     */
    @org.springframework.transaction.annotation.Transactional
    @org.springframework.data.jpa.repository.Modifying
    @org.springframework.data.jpa.repository.Query("update ReviewReplySubmissionRef r set r.targetResolvedAt = :now "
            + "where r.orgId = :orgId and r.submissionRef = :ref and r.targetResolvedAt is null")
    int markTargetResolved(@org.springframework.data.repository.query.Param("orgId") UUID orgId,
                           @org.springframework.data.repository.query.Param("ref") String submissionRef,
                           @org.springframework.data.repository.query.Param("now") java.time.Instant now);
}
