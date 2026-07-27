package com.sellerops.reviewissue;

import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ReviewIssueUnknownUnitRepository
        extends JpaRepository<ReviewIssueUnknownUnit, UUID> {

    boolean existsByOrgIdAndReviewIdAndUnitOrdinal(UUID orgId, UUID reviewId, int unitOrdinal);

    /** Whether this org has any UNKNOWN unit — half of the "has extraction run at all?" signal. */
    boolean existsByOrgId(UUID orgId);

    /**
     * Pen size by reason. <b>No product surface reads this yet</b> — it exists so the tests and the
     * disposable-backend harness can assert that unattributable units land here with the right reason
     * instead of being forced into the nearest issue.
     *
     * <p>Worth surfacing later: a large {@code NO_ASPECT} count is a finding about the extractor, and
     * an issue list that looked complete while most complaints sat unread would be misleading. Not
     * claimed as done here, because it is not.
     */
    long countByOrgIdAndReason(UUID orgId, UnknownReason reason);
}
