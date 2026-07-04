package com.sellerops.ingest;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.community.Cafe24CommunityArticleRepository;
import com.sellerops.ingest.canonical.CanonicalReview;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItemAuditRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItemRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItemWriter;
import org.springframework.transaction.PlatformTransactionManager;
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
 * End-to-end proof of the channel-gated content_hash v2 / dedup_key_version behavior on H2.
 * The GMARKET (ESM+) channel uses v2 (rating is part of identity) so two reviews that differ
 * ONLY in rating are distinct; every other channel stays on v1 (rating ignored) byte-for-byte.
 * Synthetic data only.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class ReviewDedupKeyVersionIngestTest {

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

    @BeforeEach
    void setUp() {
        service = new IngestionService(reviews, inquiries, orders, new ProductService(products),
                communityArticles, channels, new InquiryWorkItemWriter(inquiries, workItems, audits, txManager));
    }

    private static Instant at(String date) {
        return LocalDate.parse(date).atStartOfDay(ZoneOffset.UTC).toInstant();
    }

    /** Same product/date/body, ratings 5 vs 2, no external id. */
    private static List<CanonicalReview> twoRowsDifferingOnlyInRating() {
        return List.of(
                new CanonicalReview("합성-상품", "SKU-합성", 5, "합성-본문", at("2026-02-03"), null, 2),
                new CanonicalReview("합성-상품", "SKU-합성", 2, "합성-본문", at("2026-02-03"), null, 3));
    }

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

    @Test
    void gmarketV2TreatsDifferentRatingsAsDistinctReviews() {
        UUID channelId = seedChannel("GMARKET");

        IngestOutcome first = service.ingestReviews(org, channelId, twoRowsDifferingOnlyInRating());
        assertThat(first.success()).isEqualTo(2); // rating is in the v2 key → NOT merged
        assertThat(first.skipped()).isZero();

        List<Review> persisted = reviews.findAllByOrgId(org);
        assertThat(persisted).hasSize(2);
        assertThat(persisted).allSatisfy(r -> assertThat(r.getDedupKeyVersion()).isEqualTo(2));

        // Re-ingesting the identical rows still dedups (same ratings → same v2 keys).
        IngestOutcome second = service.ingestReviews(org, channelId, twoRowsDifferingOnlyInRating());
        assertThat(second.success()).isZero();
        assertThat(second.skipped()).isEqualTo(2);
        assertThat(reviews.findAllByOrgId(org)).hasSize(2);
    }

    @Test
    void nonGmarketStaysV1SoDifferentRatingsStillDedup() {
        UUID channelId = seedChannel("NAVER");

        IngestOutcome outcome = service.ingestReviews(org, channelId, twoRowsDifferingOnlyInRating());
        assertThat(outcome.success()).isEqualTo(1); // rating ignored in v1 → second row is a duplicate
        assertThat(outcome.skipped()).isEqualTo(1);

        List<Review> persisted = reviews.findAllByOrgId(org);
        assertThat(persisted).hasSize(1);
        assertThat(persisted.get(0).getDedupKeyVersion()).isEqualTo(1);
    }

    @Test
    void unknownChannelIdFallsBackToV1() {
        // A channelId with no Channel row resolves to no code → v1 (safe default).
        UUID channelId = UUID.randomUUID();

        IngestOutcome outcome = service.ingestReviews(org, channelId, twoRowsDifferingOnlyInRating());
        assertThat(outcome.success()).isEqualTo(1);
        assertThat(outcome.skipped()).isEqualTo(1);
        assertThat(reviews.findAllByOrgId(org).get(0).getDedupKeyVersion()).isEqualTo(1);
    }
}
