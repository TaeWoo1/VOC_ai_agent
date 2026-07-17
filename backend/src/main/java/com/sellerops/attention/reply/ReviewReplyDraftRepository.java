package com.sellerops.attention.reply;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ReviewReplyDraftRepository extends JpaRepository<ReviewReplyDraft, UUID> {

    /**
     * The current (highest-version) draft for a review, if any — the read every request makes,
     * backed by {@code idx_review_reply_draft_latest}.
     *
     * <p>Not org-scoped, and deliberately so: unlike a client-supplied id, {@code reviewId}
     * reaches this repository only after {@code ReviewReplyService} has already resolved the
     * review org-scoped via {@code findByIdAndOrgId}. Adding an org filter here would imply
     * this is the authorization boundary, when the boundary is upstream and must stay
     * upstream — a caller who skipped it would be equally wrong with or without the filter.
     */
    Optional<ReviewReplyDraft> findTopByReviewIdOrderByVersionDesc(UUID reviewId);

    /** One exact version — how an approval's bound body is re-served. */
    Optional<ReviewReplyDraft> findByReviewIdAndVersion(UUID reviewId, int version);

    long countByReviewId(UUID reviewId);
}
