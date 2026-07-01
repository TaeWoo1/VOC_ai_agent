package com.sellerops.ingest;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.community.Cafe24CommunityArticleRepository;
import com.sellerops.ingest.canonical.CanonicalReview;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.order.OrderDailySummaryRepository;
import com.sellerops.product.ProductRepository;
import com.sellerops.product.ProductService;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewRepository;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * Milestone R1 (dedup repeatability gate) — offline synthetic hardening of the
 * <b>code-property</b> half of the gate for ESM+ (GMARKET) REVIEW ingest. These
 * tests lock what the production key structurally guarantees; they are
 * <b>necessary but not sufficient</b> for {@code dedupKeyConfirmed}, which stays
 * {@code false} until future supervised live multi-export evidence (R2) —
 * synthetic data can never prove ESM's real-export repeatability. Synthetic rows
 * only; no {@code ContentHash}/entity/migration change; no L2/L3 tiering.
 *
 * <p>Covers: multi-tenant (org) and multi-channel store-namespace isolation;
 * null/blank rating stability under v2; the documented edited-body false-split;
 * and the product-identity characterization (SKU-keyed {@code productId} in the
 * key → a stable-SKU display-name rename does NOT split, only a SKU change does).
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class ReviewDedupGateHardeningTest {

    @Autowired ReviewRepository reviews;
    @Autowired InquiryRepository inquiries;
    @Autowired OrderDailySummaryRepository orders;
    @Autowired ProductRepository products;
    @Autowired Cafe24CommunityArticleRepository communityArticles;
    @Autowired ChannelRepository channels;

    private IngestionService service;

    @BeforeEach
    void setUp() {
        service = new IngestionService(reviews, inquiries, orders, new ProductService(products),
                communityArticles, channels);
    }

    private static Instant at(String date) {
        return LocalDate.parse(date).atStartOfDay(ZoneOffset.UTC).toInstant();
    }

    /** Seed a GMARKET (ESM+) channel so the batch resolves to the v2 (rating-folded) key. */
    private UUID seedGmarketChannel() {
        return seedChannel("GMARKET");
    }

    /** Seed a channel with the given (unique) code; the code decides the key version. */
    private UUID seedChannel(String code) {
        Channel ch = new Channel();
        ch.setCode(code);
        ch.setNameKo(code);
        ch.setStatus(ChannelStatus.AVAILABLE);
        ch.setSupportsInquiry(true);
        ch.setSupportsReview(true);
        ch.setSupportsOrder(true);
        ch.setSupportsSales(true);
        ch.setSupportsProduct(true);
        ch.setSortOrder(0);
        return channels.save(ch).getId();
    }

    /** One synthetic ESM+-shaped review; every value is synthetic. */
    private static CanonicalReview review(String product, String sku, Integer rating, String body,
            String date) {
        return new CanonicalReview(product, sku, rating, body, at(date), null, 2);
    }

    // --- Store-namespace isolation (replaces the 5B-waived store fingerprint) --------------------

    @Test
    void identicalReviewContentInTwoOrgsDoesNotCollide() {
        UUID channelId = seedGmarketChannel();
        UUID orgA = UUID.randomUUID();
        UUID orgB = UUID.randomUUID();
        CanonicalReview shared = review("합성-상품", "SKU-합성", 5, "합성-본문", "2026-02-03");

        assertThat(service.ingestReviews(orgA, channelId, List.of(shared)).success()).isEqualTo(1);
        // Byte-identical content in a different tenant must NOT be seen as a duplicate.
        assertThat(service.ingestReviews(orgB, channelId, List.of(shared)).success()).isEqualTo(1);

        assertThat(reviews.findAllByOrgId(orgA)).hasSize(1);
        assertThat(reviews.findAllByOrgId(orgB)).hasSize(1);
    }

    @Test
    void identicalReviewContentInTwoChannelsOfOneOrgDoesNotCollide() {
        UUID org = UUID.randomUUID();
        // Two distinct channels (codes are unique) → two distinct channel_id namespaces.
        UUID channelA = seedChannel("GMARKET");
        UUID channelB = seedChannel("NAVER");
        CanonicalReview shared = review("합성-상품", "SKU-합성", 5, "합성-본문", "2026-02-03");

        assertThat(service.ingestReviews(org, channelA, List.of(shared)).success()).isEqualTo(1);
        assertThat(service.ingestReviews(org, channelB, List.of(shared)).success()).isEqualTo(1);

        // channel_id is part of the key AND the uniqueness scope → two distinct rows.
        assertThat(reviews.findAllByOrgId(org)).hasSize(2);
    }

    // --- Null/blank rating stability (v2 folds rating into the key) ------------------------------

    @Test
    void nullRatingReviewIsStableAcrossReuploadUnderV2() {
        UUID channelId = seedGmarketChannel();
        UUID org = UUID.randomUUID();
        CanonicalReview noRating = review("합성-상품", "SKU-합성", null, "합성-본문", "2026-02-03");

        assertThat(service.ingestReviews(org, channelId, List.of(noRating)).success()).isEqualTo(1);
        // A blank rating must not destabilize the key: re-upload dedups.
        IngestOutcome second = service.ingestReviews(org, channelId, List.of(noRating));
        assertThat(second.success()).isZero();
        assertThat(second.skipped()).isEqualTo(1);
        assertThat(reviews.findAllByOrgId(org)).hasSize(1);
    }

    @Test
    void nullRatingAndPresentRatingAreDistinctUnderV2() {
        UUID channelId = seedGmarketChannel();
        UUID org = UUID.randomUUID();

        IngestOutcome outcome = service.ingestReviews(org, channelId, List.of(
                review("합성-상품", "SKU-합성", null, "합성-본문", "2026-02-03"),
                review("합성-상품", "SKU-합성", 5, "합성-본문", "2026-02-03")));

        // Same product/date/body; rating null vs 5 → v2 keeps them distinct.
        assertThat(outcome.success()).isEqualTo(2);
        assertThat(reviews.findAllByOrgId(org)).hasSize(2);
    }

    // --- Documented false-split: an edited body reads as a new review under single-tier v2 -------

    @Test
    void editedReviewBodySplitsATrueDuplicateUnderV2() {
        UUID channelId = seedGmarketChannel();
        UUID org = UUID.randomUUID();

        // Same product/date/rating; body edited by one character. Because body is a
        // key input (single-tier L1), the edited review gets a different key and both
        // persist — a KNOWN false-split the gate must account for. A future L2-fuzzy
        // tier (deferred) would collapse these; this test pins current behavior.
        IngestOutcome outcome = service.ingestReviews(org, channelId, List.of(
                review("합성-상품", "SKU-합성", 5, "합성-본문", "2026-02-03"),
                review("합성-상품", "SKU-합성", 5, "합성-본문!", "2026-02-03")));

        assertThat(outcome.success()).isEqualTo(2);
        assertThat(reviews.findAllByOrgId(org)).hasSize(2);
    }

    // --- Product identity is the resolved (SKU-keyed) productId, not a raw product string --------

    @Test
    void displayNameRenameWithAStableSkuDoesNotSplit() {
        UUID channelId = seedGmarketChannel();
        UUID org = UUID.randomUUID();

        // Same SKU, same date/rating/body, product display NAME changed. resolveOrCreate
        // finds the product by SKU → same productId → same key → the rename dedups.
        IngestOutcome outcome = service.ingestReviews(org, channelId, List.of(
                review("합성-상품-원래이름", "SKU-공통", 5, "합성-본문", "2026-02-03"),
                review("합성-상품-변경이름", "SKU-공통", 5, "합성-본문", "2026-02-03")));

        assertThat(outcome.success()).isEqualTo(1);
        assertThat(outcome.skipped()).isEqualTo(1);
        assertThat(reviews.findAllByOrgId(org)).hasSize(1);
        // One product row for the shared SKU (the rename did not fork identity).
        assertThat(products.findAllByOrgId(org)).hasSize(1);
    }

    @Test
    void aSkuChangeSplitsBecauseTheResolvedProductIdChanges() {
        UUID channelId = seedGmarketChannel();
        UUID org = UUID.randomUUID();

        // Same name/date/rating/body but a DIFFERENT SKU → different productId → different
        // key → both persist. Product identity in the key follows the SKU-keyed productId.
        IngestOutcome outcome = service.ingestReviews(org, channelId, List.of(
                review("합성-상품", "SKU-A", 5, "합성-본문", "2026-02-03"),
                review("합성-상품", "SKU-B", 5, "합성-본문", "2026-02-03")));

        assertThat(outcome.success()).isEqualTo(2);
        assertThat(reviews.findAllByOrgId(org)).hasSize(2);
        assertThat(products.findAllByOrgId(org)).hasSize(2);
    }

    @Test
    void reviewsPersistWithTheV2KeyVersionStamp() {
        UUID channelId = seedGmarketChannel();
        UUID org = UUID.randomUUID();

        service.ingestReviews(org, channelId, List.of(
                review("합성-상품", "SKU-합성", 5, "합성-본문", "2026-02-03")));

        List<Review> persisted = reviews.findAllByOrgId(org);
        assertThat(persisted).hasSize(1);
        assertThat(persisted.get(0).getDedupKeyVersion()).isEqualTo(2);
        assertThat(persisted.get(0).getContentHash()).isNotNull().hasSize(64);
    }
}
