package com.sellerops.ingest;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.ingest.canonical.CanonicalInquiry;
import com.sellerops.ingest.canonical.CanonicalOrderSummary;
import com.sellerops.ingest.canonical.CanonicalReview;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.order.OrderDailySummaryRepository;
import com.sellerops.product.ProductRepository;
import com.sellerops.product.ProductService;
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

@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class IngestionServiceTest {

    @Autowired ReviewRepository reviews;
    @Autowired InquiryRepository inquiries;
    @Autowired OrderDailySummaryRepository orders;
    @Autowired ProductRepository products;

    private IngestionService service;
    private final UUID org = UUID.randomUUID();
    private final UUID channel = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        service = new IngestionService(reviews, inquiries, orders, new ProductService(products));
    }

    private static Instant at(String date) {
        return LocalDate.parse(date).atStartOfDay(ZoneOffset.UTC).toInstant();
    }

    @Test
    void dedupsByExternalIdAcrossBatchAndDb() {
        IngestOutcome counts = service.ingestReviews(org, channel, List.of(
                new CanonicalReview("전선몰딩", "SKU1", 5, "좋아요", at("2026-06-01"), "EXT-1", 2),
                new CanonicalReview("전선몰딩", "SKU1", 4, "괜찮아요", at("2026-06-02"), "EXT-2", 3),
                new CanonicalReview("전선몰딩", "SKU1", 3, "중복", at("2026-06-03"), "EXT-1", 4)));

        assertThat(counts.success()).isEqualTo(2);
        assertThat(counts.skipped()).isEqualTo(1);
        assertThat(reviews.findAllByOrgId(org)).hasSize(2);

        // Re-uploading the same external id is skipped against the DB.
        IngestOutcome second = service.ingestReviews(org, channel, List.of(
                new CanonicalReview("전선몰딩", "SKU1", 5, "좋아요", at("2026-06-01"), "EXT-1", 2)));
        assertThat(second.skipped()).isEqualTo(1);
        assertThat(reviews.findAllByOrgId(org)).hasSize(2);
    }

    @Test
    void dedupsByContentHashWhenNoExternalId() {
        IngestOutcome counts = service.ingestReviews(org, channel, List.of(
                new CanonicalReview("전선몰딩", "SKU1", 2, "접착력 약함", at("2026-06-01"), null, 2),
                new CanonicalReview("전선몰딩", "SKU1", 2, "접착력 약함", at("2026-06-01"), null, 3)));

        assertThat(counts.success()).isEqualTo(1);
        assertThat(counts.skipped()).isEqualTo(1);
        assertThat(reviews.findAllByOrgId(org)).hasSize(1);
        assertThat(reviews.findAllByOrgId(org).get(0).isNegative()).isTrue();
    }

    @Test
    void contentHashDedupIsStableWhenDateMissingAcrossUploads() {
        IngestOutcome first = service.ingestReviews(org, channel, List.of(
                new CanonicalReview("전선몰딩", "SKU1", 5, "날짜 없는 리뷰", null, null, 2)));
        assertThat(first.success()).isEqualTo(1);

        // Second upload of the same dateless row must be recognized as a duplicate.
        IngestOutcome second = service.ingestReviews(org, channel, List.of(
                new CanonicalReview("전선몰딩", "SKU1", 5, "날짜 없는 리뷰", null, null, 2)));
        assertThat(second.success()).isZero();
        assertThat(second.skipped()).isEqualTo(1);
        assertThat(reviews.findAllByOrgId(org)).hasSize(1);
    }

    @Test
    void dedupsInquiriesAndMapsStatus() {
        IngestOutcome counts = service.ingestInquiries(org, channel, List.of(
                new CanonicalInquiry("전선몰딩", "SKU1", "구매자1", "곡면 가능?", "UNANSWERED",
                        at("2026-06-01"), "Q-1", 2),
                new CanonicalInquiry("전선몰딩", "SKU1", "구매자1", "곡면 가능?", "UNANSWERED",
                        at("2026-06-01"), "Q-1", 3)));

        assertThat(counts.success()).isEqualTo(1);
        assertThat(counts.skipped()).isEqualTo(1);
        assertThat(inquiries.findTop50ByOrgIdOrderByReceivedAtDesc(org)).hasSize(1);
        assertThat(inquiries.findTop50ByOrgIdOrderByReceivedAtDesc(org).get(0).getStatus())
                .isEqualTo("UNANSWERED");
    }

    @Test
    void resolvesOrCreatesProductsOnce() {
        service.ingestReviews(org, channel, List.of(
                new CanonicalReview("전선몰딩", "SKU1", 5, "a", at("2026-06-01"), "E1", 2),
                new CanonicalReview("전선몰딩", "SKU1", 5, "b", at("2026-06-02"), "E2", 3)));

        assertThat(products.findAllByOrgId(org)).hasSize(1);
    }

    @Test
    void returnsInsertedIdsForNewlyPersistedRows() {
        IngestOutcome outcome = service.ingestReviews(org, channel, List.of(
                new CanonicalReview("전선몰딩", "SKU1", 5, "새 리뷰 A", at("2026-06-01"), "NEW-1", 2),
                new CanonicalReview("전선몰딩", "SKU1", 4, "새 리뷰 B", at("2026-06-02"), "NEW-2", 3)));

        assertThat(outcome.success()).isEqualTo(2);
        assertThat(outcome.insertedIds()).hasSize(2);
        // The ids are the real persisted review ids.
        assertThat(outcome.insertedIds())
                .containsExactlyInAnyOrderElementsOf(
                        reviews.findAllByOrgId(org).stream().map(r -> r.getId()).toList());
    }

    @Test
    void insertedIdsExcludeDedupSkips() {
        service.ingestReviews(org, channel, List.of(
                new CanonicalReview("전선몰딩", "SKU1", 5, "한 번만", at("2026-06-01"), "DUP-1", 2)));

        // Re-ingesting the same external id inserts nothing → empty insertedIds.
        IngestOutcome second = service.ingestReviews(org, channel, List.of(
                new CanonicalReview("전선몰딩", "SKU1", 5, "한 번만", at("2026-06-01"), "DUP-1", 2)));

        assertThat(second.success()).isZero();
        assertThat(second.skipped()).isEqualTo(1);
        assertThat(second.insertedIds()).isEmpty();
    }

    @Test
    void returnsInsertedIdsForNewlyPersistedInquiries() {
        IngestOutcome outcome = service.ingestInquiries(org, channel, List.of(
                new CanonicalInquiry("전선몰딩", "SKU1", "구매자1", "곡면 가능?", "UNANSWERED",
                        at("2026-06-01"), "QNEW-1", 2)));

        assertThat(outcome.success()).isEqualTo(1);
        assertThat(outcome.insertedIds()).hasSize(1);
        assertThat(outcome.insertedIds().get(0))
                .isEqualTo(inquiries.findTop50ByOrgIdOrderByReceivedAtDesc(org).get(0).getId());
    }

    @Test
    void upsertsOrderSummariesByDate() {
        LocalDate day = LocalDate.parse("2026-06-01");
        IngestOutcome counts = service.ingestOrderSummaries(org, channel, List.of(
                new CanonicalOrderSummary(day, 10, 1000, 2),
                new CanonicalOrderSummary(day, 20, 2000, 3)));

        assertThat(counts.success()).isEqualTo(2);
        var rows = orders.findAllByOrgIdAndSummaryDate(org, day);
        assertThat(rows).hasSize(1);
        assertThat(rows.get(0).getOrderCount()).isEqualTo(20);
        assertThat(rows.get(0).getSalesAmount()).isEqualTo(2000L);
    }
}
