package com.sellerops.attention.reply;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

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

    /**
     * Which of these reviews have any draft — ONE batch query per drill-down page, never a
     * per-row lookup, matching how {@code IngestedReviewVocItemSource} resolves product names
     * and dispositions. The id set is bounded by the clamped page size and each id hits
     * {@code idx_review_reply_draft_latest}, so the cost is a page, not the table.
     *
     * <p>Returns ids rather than rows: the caller needs to know THAT work exists, and the
     * drill-down is metadata-only — pulling bodies back to compute a boolean would drag the
     * one thing that surface must not carry through it.
     *
     * <p>The {@code orgId} filter is load-bearing, not tidiness: an id read off a review row is
     * not proof of same-org ownership, so a cross-org id simply resolves to no entry.
     */
    @Query("select distinct d.reviewId from ReviewReplyDraft d "
            + "where d.orgId = :orgId and d.reviewId in :reviewIds")
    List<UUID> findReviewIdsWithDraft(@Param("orgId") UUID orgId,
                                      @Param("reviewIds") Collection<UUID> reviewIds);
}
