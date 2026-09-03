package com.sellerops.review.draft;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/** Read the citations of one review draft version, in the order they were shown to the drafter. */
public interface ReviewDraftEvidenceRepository extends JpaRepository<ReviewDraftEvidence, UUID> {

    List<ReviewDraftEvidence> findByOrgIdAndReviewIdAndDraftVersionOrderByOrdinalAsc(
            UUID orgId, UUID reviewId, int draftVersion);
}
