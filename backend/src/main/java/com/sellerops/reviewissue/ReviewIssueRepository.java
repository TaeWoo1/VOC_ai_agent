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

    /** Issues by id, org-scoped — the titles behind one review's own evidence links (Agent Object v1). */
    List<ReviewIssue> findByOrgIdAndIdIn(UUID orgId, java.util.Collection<UUID> ids);

    /**
     * Issues whose evidence was last derived by a DIFFERENT extractor version — the ones a full
     * re-extraction must revisit (Issue Evidence Trust Closure v1). Empty once the pass has stamped them.
     */
    List<ReviewIssue> findByOrgIdAndExtractorVersionNot(UUID orgId, String extractorVersion);

    /** Every org that still has such an issue, so a boot pass visits only where there is work. */
    @org.springframework.data.jpa.repository.Query(
            "select distinct i.orgId from ReviewIssue i where i.extractorVersion <> :extractorVersion")
    List<UUID> orgIdsWithExtractorVersionNot(
            @org.springframework.data.repository.query.Param("extractorVersion") String extractorVersion);
}
