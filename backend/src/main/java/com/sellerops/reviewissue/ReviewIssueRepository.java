package com.sellerops.reviewissue;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ReviewIssueRepository extends JpaRepository<ReviewIssue, UUID> {

    /**
     * The issue-memory lookup. Backed by {@code uq_review_issues_signature}, which is what makes
     * attaching a unit to an existing issue an indexed read rather than a similarity search.
     */
    Optional<ReviewIssue> findByOrgIdAndSignatureKey(UUID orgId, String signatureKey);

    /** Every issue an operator should see. Dismissed ones stay stored but are not surfaced. */
    List<ReviewIssue> findByOrgIdAndDismissedFalse(UUID orgId);

    /**
     * Whether this org has any issue at all (dismissed or not). Used to tell "analysis ran and found
     * nothing" apart from "analysis has not run" — an org with reviews but zero issues AND zero UNKNOWN
     * units has not been extracted yet, which must not read as "no change".
     */
    boolean existsByOrgId(UUID orgId);

    /**
     * The dismissed ones, so 중요하지 않음 is undoable. Without a way to read them back, dismissal
     * would be a one-way door: the row survives (deliberately, so it is not recreated and
     * re-announced) but the operator could never reach it again.
     */
    List<ReviewIssue> findByOrgIdAndDismissedTrue(UUID orgId);
}
