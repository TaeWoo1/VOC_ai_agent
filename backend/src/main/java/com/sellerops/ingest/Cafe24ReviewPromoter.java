package com.sellerops.ingest;

import com.sellerops.community.CommunitySourceKind;
import com.sellerops.product.Product;
import com.sellerops.product.ProductService;
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
 * (never inferred from the board reply_status) — it is a genuine review in the channel-neutral store,
 * not a NAVER disguise.
 *
 * <p><b>Product linkage (2026-08-21, Operator Graph v2).</b> This used to set {@code productId = null}
 * with the note "Cafe24 carries a source product_no, not our product UUID". That was true and it was
 * also an inconsistency: {@code Cafe24InquiryArticleMapper} takes the SAME {@code product_no} and uses
 * it AS the SKU, so within one org the identical key became a product on the inquiry path and was
 * discarded on the review path. Cafe24 reviews therefore counted as unattributable
 * ({@code UNCERTAIN_PRODUCT_UNLINKED}) against products the inquiry path had already created. This is
 * not a new mapping policy — it is the existing one applied consistently. A row with no
 * {@code product_no} still links to nothing, which remains the honest answer for it.
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
    private final ProductService products;

    /** Full production wiring. Explicitly annotated because a second constructor now exists. */
    @org.springframework.beans.factory.annotation.Autowired
    public Cafe24ReviewPromoter(ReviewRepository reviews, ProductService products) {
        this.reviews = reviews;
        this.products = products;
    }

    /**
     * Promotion without product resolution — the shape every caller had before Operator Graph v2.
     *
     * <p>Kept so the tests that exercise promotion itself do not have to stand up a product service.
     * A promoter built this way links nothing, which is exactly what the old behaviour was.
     */
    public Cafe24ReviewPromoter(ReviewRepository reviews) {
        this(reviews, null);
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
        return promote(orgId, channelId, sourceKind, boardNo, articleNo, content, rating,
                sourceCreatedAt, null);
    }

    /**
     * As above, with the article's own {@code product_no} so the promoted review can be attributed.
     *
     * <p>Resolution goes through {@link ProductService#resolveOrCreateWithinTransaction} — the same
     * call {@code IngestionService} makes for every other ingested row — with the product number as the
     * SKU, exactly as the Cafe24 inquiry path already does. A null {@code productNo} links to nothing.
     */
    public Outcome promote(UUID orgId, UUID channelId, String sourceKind, int boardNo, long articleNo,
                           String content, Integer rating, Instant sourceCreatedAt, Long productNo) {
        return promote(orgId, channelId, sourceKind, boardNo, articleNo, content, rating,
                sourceCreatedAt, productNo, null);
    }

    /**
     * As above, carrying how many files the source said were attached — or null when it did not say.
     *
     * <p><b>Null is not zero.</b> It lands as {@code media_count = 0, media_count_observed = false},
     * which is the review saying «nobody counted» rather than «there are none». A number lands as an
     * observation. Nothing about the FILES travels: the count is a length the connector measured at
     * the parse boundary, and no URL or filename exists anywhere on this path to be stored.
     *
     * <p>Written on INSERT only, like every other source fact on a review
     * ({@code IngestionService}'s rule): a re-promotion of an article already promoted returns
     * {@code ALREADY_PRESENT} and changes nothing, so the 134 reviews promoted before this existed
     * keep their unobserved state rather than acquiring a retroactive one.
     */
    public Outcome promote(UUID orgId, UUID channelId, String sourceKind, int boardNo, long articleNo,
                           String content, Integer rating, Instant sourceCreatedAt, Long productNo,
                           Integer attachmentCount) {
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
        review.setProductId(resolveProduct(orgId, productNo));
        review.setBody(content);
        review.setRating(rating);
        review.setNegative(rating != null && rating <= 2);
        review.setReceivedAt(sourceCreatedAt != null ? sourceCreatedAt : Instant.now());
        review.setExternalId(externalId);
        review.setMediaCount(attachmentCount == null ? 0 : attachmentCount);
        review.setMediaCountObserved(attachmentCount != null);
        review.setContentHash(null); // dedup is by the stable external id, not a content hash
        review.setDedupKeyVersion(ReviewDedupKey.V1);
        review.setReplyState(ReviewReplyState.UNKNOWN);
        reviews.save(review);
        return Outcome.PROMOTED;
    }

    /**
     * {@code product_no} → the SellerOps product, or null when the catalogue does not know it.
     *
     * <p><b>Resolve-only.</b> It used to resolve-or-CREATE, and on the canonical demo org promoting 133
     * real board-4 reviews manufactured 24 products whose name and sku were both a bare Cafe24 number —
     * "24", "181", "27". Those are not catalogue entries; they are the absence of one, wearing a
     * product's shape. An Agent reading them says "상품 '181'에 부정 리뷰가 3건" and has told the seller
     * nothing, while Product Knowledge counts them as things the seller sells.
     *
     * <p>Nothing is lost by declining. The article keeps its own {@code product_no}
     * ({@code cafe24_community_articles.product_no}), so a review left unresolved here is relinked for
     * free the moment a real catalogue read lands — which is precisely what the Cafe24 PRODUCT
     * capability is for. An invented row, by contrast, would have to be found and merged.
     *
     * <p>The Cafe24 INQUIRY path still resolve-or-creates through the same key and has produced ~50
     * such placeholders since July. That is the same defect and is deliberately NOT changed here: it
     * would silently unlink existing inquiry attributions, which is a product-owner decision rather
     * than a promotion detail.
     */
    private UUID resolveProduct(UUID orgId, Long productNo) {
        if (products == null || productNo == null || productNo <= 0) {
            return null;
        }
        return products.findBySku(orgId, Long.toString(productNo))
                .map(Product::getId)
                .orElse(null);
    }
}
