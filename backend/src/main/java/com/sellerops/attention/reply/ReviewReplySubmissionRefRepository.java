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
}
