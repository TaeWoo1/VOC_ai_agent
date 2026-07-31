package com.sellerops.ingest;

import com.sellerops.community.CommunitySourceKind;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewReplyState;
import com.sellerops.review.ReviewRepository;
import java.time.Instant;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * The single promotion contract shared by the fresh-ingest {@link Cafe24ReviewIssueBridge} and the
 * historical {@code Cafe24ReviewPromotionReconciler}: promote one public board-4 Cafe24 REVIEW into a
 * canonical {@link Review} row with honest CAFE24 provenance, idempotently, without publishing any
 * event (the caller owns event timing so it can batch a single refresh per run).
 *
 * <p>Promotion is keyed by the article natural id {@code cafe24:b<board>:a<articleNo>}: an existing
 * review for {@code (org, channel, externalId)} is a no-op ({@link Outcome#ALREADY_PRESENT}). A
 * non-REVIEW kind, a missing natural id, or a null/blank body are each skipped with a distinct outcome
 * (never a failed save — {@code reviews.body} is NOT NULL and an empty body carries no issue signal).
 * The promoted review is tagged with its true CAFE24 channel and a Cafe24 external id, {@code
 * dedupKeyVersion=V1} (Cafe24 dedups by the stable {@code article_no}), {@code replyState=UNKNOWN}
 * (never inferred from the board reply_status), and {@code productId=null} — it is a genuine review in
 * the channel-neutral store, not a NAVER disguise.
 */
@Component
public class Cafe24ReviewPromoter {

    public enum Outcome {
        PROMOTED,
        ALREADY_PRESENT,
        SKIPPED_NOT_REVIEW,
        SKIPPED_INVALID_IDENTITY,
        SKIPPED_EMPTY_BODY
    }

    private final ReviewRepository reviews;

    public Cafe24ReviewPromoter(ReviewRepository reviews) {
        this.reviews = reviews;
    }

    /** Stable canonical external id for a Cafe24 community article. */
    public static String externalId(int boardNo, long articleNo) {
        return "cafe24:b" + boardNo + ":a" + articleNo;
    }

    /**
     * Promote one Cafe24 community article into a canonical review if eligible and not already present.
     * Runs inside the caller's transaction (no own {@code @Transactional}); existence is checked before
     * insert so no unique-constraint violation is provoked.
     */
    public Outcome promote(UUID orgId, UUID channelId, String sourceKind, int boardNo, long articleNo,
                           String content, Integer rating, Instant sourceCreatedAt) {
        if (CommunitySourceKind.normalize(sourceKind) != CommunitySourceKind.REVIEW) {
            return Outcome.SKIPPED_NOT_REVIEW;
        }
        if (articleNo <= 0) {
            return Outcome.SKIPPED_INVALID_IDENTITY;
        }
        if (content == null || content.isBlank()) {
            return Outcome.SKIPPED_EMPTY_BODY;
        }
        String externalId = externalId(boardNo, articleNo);
        if (reviews.existsByOrgIdAndChannelIdAndExternalId(orgId, channelId, externalId)) {
            return Outcome.ALREADY_PRESENT;
        }
        Review review = new Review();
        review.setOrgId(orgId);
        review.setChannelId(channelId);
        review.setProductId(null); // Cafe24 carries a source product_no, not our product UUID
        review.setBody(content);
        review.setRating(rating);
        review.setNegative(rating != null && rating <= 2);
        review.setReceivedAt(sourceCreatedAt != null ? sourceCreatedAt : Instant.now());
        review.setExternalId(externalId);
        review.setContentHash(null); // dedup is by the stable external id, not a content hash
        review.setDedupKeyVersion(ReviewDedupKey.V1);
        review.setReplyState(ReviewReplyState.UNKNOWN);
        reviews.save(review);
        return Outcome.PROMOTED;
    }
}
