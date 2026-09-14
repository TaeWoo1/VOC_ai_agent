package com.sellerops.ingest;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.community.Cafe24CommunityArticleRepository;
import com.sellerops.ingest.canonical.CanonicalReview;
import com.sellerops.ingest.canonical.ChannelProductRef;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItemAuditRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItemRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItemWriter;
import com.sellerops.order.OrderDailySummaryRepository;
import com.sellerops.product.Product;
import com.sellerops.product.ProductRepository;
import com.sellerops.product.ProductService;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewReplyState;
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
import org.springframework.transaction.PlatformTransactionManager;

/**
 * <b>A review does not need a product catalogue to be a review.</b>
 *
 * <p>These are the properties of the identifier lane ({@link CanonicalReview#productRef()}) as a product
 * decision, not as an implementation: a row nobody's catalogue claims is STORED, it invents nothing, two
 * such rows naming different products stay two different things, and — the one that makes the reconcile
 * boundary safe to cross — linking the row to a product later does not change what it dedups as.
 *
 * <p>Synthetic data only; no channel is called.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class CatalogueIndependentReviewIngestTest {

    @Autowired ReviewRepository reviews;
    @Autowired InquiryRepository inquiries;
    @Autowired OrderDailySummaryRepository orders;
    @Autowired ProductRepository products;
    @Autowired Cafe24CommunityArticleRepository communityArticles;
    @Autowired InquiryWorkItemRepository workItems;
    @Autowired InquiryWorkItemAuditRepository audits;
    @Autowired PlatformTransactionManager txManager;
    @Autowired ChannelRepository channels;

    private IngestionService service;
    private final UUID org = UUID.randomUUID();
    private UUID channelId;

    @BeforeEach
    void setUp() {
        service = new IngestionService(reviews, inquiries, orders, new ProductService(products),
                communityArticles, channels, new InquiryWorkItemWriter(inquiries, workItems, audits, txManager));
        Channel ch = new Channel();
        ch.setCode("COUPANG");
        ch.setNameKo("쿠팡");
        ch.setStatus(ChannelStatus.AVAILABLE);
        ch.setSupportsReview(true);
        ch.setSortOrder(0);
        channelId = channels.save(ch).getId();
    }

    private static Instant at(String date) {
        return LocalDate.parse(date).atStartOfDay(ZoneOffset.UTC).toInstant();
    }

    /** One acquired row: the channel named the product, and this org resolved nothing for it. */
    private static CanonicalReview declaring(String displayId, String name, String body, String optionId) {
        return new CanonicalReview(name, null, 5, body, at("2026-08-11"), null, 1,
                ReviewReplyState.UNKNOWN, null, optionId, 0, true, false,
                ChannelProductRef.of(displayId));
    }

    @Test
    void a_row_no_catalogue_claims_is_stored_with_what_the_channel_said() {
        long productsBefore = products.count();

        IngestOutcome outcome = service.ingestReviews(org, channelId,
                List.of(declaring("77700000001", "무선 이어폰", "소리가 좋아요", "8100000001")));

        assertThat(outcome.success()).isEqualTo(1);
        assertThat(outcome.failed()).isZero();
        Review stored = reviews.findAllByOrgId(org).get(0);
        assertThat(stored.getProductId()).isNull();
        assertThat(stored.getSourceProductRef()).isEqualTo("77700000001");
        assertThat(stored.getSourceProductName()).isEqualTo("무선 이어폰");
        assertThat(stored.getSourceOptionId()).isEqualTo("8100000001");
        // Nothing invented — not from the display id, not from the name, and not the shared bucket.
        assertThat(products.count()).isEqualTo(productsBefore);
    }

    @Test
    void two_unresolved_rows_naming_different_products_stay_two_things() {
        IngestOutcome outcome = service.ingestReviews(org, channelId, List.of(
                declaring("77700000001", "무선 이어폰", "소리가 좋아요", "8100000001"),
                declaring("77700000002", "블루투스 스피커", "소리가 좋아요", "8100000002")));

        // Same body, same date, same rating — only the channel's product id differs, and that is enough.
        assertThat(outcome.success()).isEqualTo(2);
        assertThat(reviews.findAllByOrgId(org)).hasSize(2);
        assertThat(reviews.findAllByOrgId(org).stream().map(Review::getSourceProductRef))
                .containsExactlyInAnyOrder("77700000001", "77700000002");
    }

    @Test
    void re_reading_the_same_unresolved_row_stores_nothing_the_second_time() {
        service.ingestReviews(org, channelId,
                List.of(declaring("77700000001", "무선 이어폰", "소리가 좋아요", "8100000001")));
        IngestOutcome again = service.ingestReviews(org, channelId,
                List.of(declaring("77700000001", "무선 이어폰", "소리가 좋아요", "8100000001")));

        assertThat(again.success()).isZero();
        assertThat(again.skipped()).isEqualTo(1);
        assertThat(reviews.findAllByOrgId(org)).hasSize(1);
    }

    /**
     * <b>The reconcile boundary, and the whole reason the dedup key changed.</b>
     *
     * <p>A catalogue arrives after the reviews did, something links the stored row to a product, and the
     * seller reads the same WING page again. If identity were our resolved product id, the row would hash
     * to something new and be filed a second time — the seller would watch their review count double for
     * connecting an API. It is the channel's id, so it does not.
     */
    @Test
    void linking_a_stored_review_to_a_product_later_does_not_duplicate_it_on_the_next_read() {
        service.ingestReviews(org, channelId,
                List.of(declaring("77700000001", "무선 이어폰", "소리가 좋아요", "8100000001")));
        Review stored = reviews.findAllByOrgId(org).get(0);

        // What a reconcile does: write the link, touch nothing else.
        Product product = new Product();
        product.setOrgId(org);
        product.setName("무선 이어폰");
        product.setSku("SKU-1");
        product.setStatus("ACTIVE");
        products.save(product);
        stored.setProductId(product.getId());
        reviews.save(stored);

        IngestOutcome again = service.ingestReviews(org, channelId,
                List.of(declaring("77700000001", "무선 이어폰", "소리가 좋아요", "8100000001")));

        assertThat(again.success()).isZero();
        assertThat(again.skipped()).isEqualTo(1);
        assertThat(reviews.findAllByOrgId(org)).hasSize(1);
        assertThat(reviews.findAllByOrgId(org).get(0).getProductId()).isEqualTo(product.getId());
    }

    /**
     * A review stored under the pre-V105 formula — keyed on our resolved product id, with no source ref —
     * is recognised by a declaring re-read and not stored twice.
     *
     * <p>This is the migration cost of the key change, paid in one bounded lookup on one lane. Without it
     * the first re-read of an already-collected store would file every one of its 상품평 again.
     */
    @Test
    void a_review_stored_under_the_old_key_is_not_duplicated_by_a_declaring_read() {
        Product product = new Product();
        product.setOrgId(org);
        product.setName("무선 이어폰");
        product.setSku("SKU-1");
        product.setStatus("ACTIVE");
        products.save(product);

        // The old shape: no productRef, resolved by SKU, hashed on the product id.
        service.ingestReviews(org, channelId, List.of(new CanonicalReview(
                "무선 이어폰", "SKU-1", 5, "소리가 좋아요", at("2026-08-11"), null, 1,
                ReviewReplyState.UNKNOWN, null, "8100000001", 0, true, false)));
        assertThat(reviews.findAllByOrgId(org)).hasSize(1);

        IngestOutcome again = service.ingestReviews(org, channelId, List.of(new CanonicalReview(
                "무선 이어폰", "SKU-1", 5, "소리가 좋아요", at("2026-08-11"), null, 1,
                ReviewReplyState.UNKNOWN, null, "8100000001", 0, true, false,
                ChannelProductRef.of("77700000001"))));

        assertThat(again.success()).isZero();
        assertThat(again.skipped()).isEqualTo(1);
        assertThat(reviews.findAllByOrgId(org)).hasSize(1);
    }

    /**
     * The declaring lane never creates a product, even when the caller hands it a SKU this org does not
     * hold. Resolution belongs to the caller; ingest looks up and stops there.
     */
    @Test
    void a_sku_this_org_does_not_hold_creates_no_product_on_the_declaring_lane() {
        long productsBefore = products.count();

        service.ingestReviews(org, channelId, List.of(new CanonicalReview(
                "무선 이어폰", "SKU-NOBODY-HOLDS", 5, "소리가 좋아요", at("2026-08-11"), null, 1,
                ReviewReplyState.UNKNOWN, null, "8100000001", 0, true, false,
                ChannelProductRef.of("77700000001"))));

        assertThat(products.count()).isEqualTo(productsBefore);
        assertThat(reviews.findAllByOrgId(org).get(0).getProductId()).isNull();
    }

    /**
     * The non-declaring lane is untouched: a file upload still resolves-or-creates by name/SKU, and its
     * hash is still built on the resolved product id.
     */
    @Test
    void a_source_that_declares_nothing_still_resolves_or_creates_as_before() {
        long productsBefore = products.count();

        service.ingestReviews(org, channelId, List.of(new CanonicalReview(
                "업로드 상품", "SKU-UPLOAD", 5, "좋아요", at("2026-08-11"), null, 1)));

        assertThat(products.count()).isEqualTo(productsBefore + 1);
        Review stored = reviews.findAllByOrgId(org).get(0);
        assertThat(stored.getProductId()).isNotNull();
        assertThat(stored.getSourceProductRef()).isNull();
        assertThat(stored.getSourceProductName()).isNull();
    }
}
