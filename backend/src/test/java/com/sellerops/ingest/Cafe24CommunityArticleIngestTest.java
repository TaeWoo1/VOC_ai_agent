package com.sellerops.ingest;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.channel.ChannelRepository;
import com.sellerops.community.Cafe24CommunityArticle;
import com.sellerops.community.Cafe24CommunityArticleRepository;
import com.sellerops.ingest.canonical.CanonicalCommunityArticle;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.order.OrderDailySummaryRepository;
import com.sellerops.product.ProductRepository;
import com.sellerops.product.ProductService;
import com.sellerops.review.ReviewRepository;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * Cafe24 community article ingestion: natural-key dedupe, insert, hash-guarded
 * no-op vs in-place update, and field normalization — over a real (H2) DB.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class Cafe24CommunityArticleIngestTest {

    @Autowired ReviewRepository reviews;
    @Autowired InquiryRepository inquiries;
    @Autowired OrderDailySummaryRepository orders;
    @Autowired ProductRepository products;
    @Autowired Cafe24CommunityArticleRepository communityArticles;
    @Autowired ChannelRepository channels;

    private IngestionService service;
    private final UUID org = UUID.randomUUID();
    private final UUID channel = UUID.randomUUID();
    private final UUID seller = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        service = new IngestionService(reviews, inquiries, orders, new ProductService(products),
                communityArticles, channels);
    }

    /** A 구매후기 (board 4) review article. */
    private static CanonicalCommunityArticle review(long articleNo, Integer rating, String title,
                                                    String content, String replyStatus, int sourceRow) {
        return new CanonicalCommunityArticle(4, articleNo, "REVIEW", null, title, content, rating,
                replyStatus, null, null, sourceRow);
    }

    @Test
    void insertsNewArticleWithNormalizedFields() {
        IngestOutcome out = service.ingestCommunityArticles(org, channel, seller, List.of(
                new CanonicalCommunityArticle(6, 1001L, "product_inquiry", 77L, "제목",
                        "곡면 가능?", null, "waiting", null, null, 2)));

        assertThat(out.success()).isEqualTo(1);
        assertThat(out.insertedIds()).hasSize(1);

        List<Cafe24CommunityArticle> rows = communityArticles.findAllByOrgId(org);
        assertThat(rows).hasSize(1);
        Cafe24CommunityArticle a = rows.get(0);
        assertThat(a.getBoardNo()).isEqualTo(6);
        assertThat(a.getArticleNo()).isEqualTo(1001L);
        assertThat(a.getSourceKind()).isEqualTo("PRODUCT_INQUIRY");
        assertThat(a.getReplyStatus()).isEqualTo("PENDING");
        assertThat(a.getProductNo()).isEqualTo(77L);
        assertThat(a.getSellerAccountId()).isEqualTo(seller);
        assertThat(a.getSourceHash()).isNotBlank();
        assertThat(a.getCollectedAt()).isNotNull();
    }

    @Test
    void dedupesByNaturalKeyWithinBatch() {
        IngestOutcome out = service.ingestCommunityArticles(org, channel, seller, List.of(
                review(2001L, 5, "좋아요", "만족", "ANSWERED", 2),
                review(2001L, 4, "좋아요(수정)", "그대로", "ANSWERED", 3)));

        assertThat(out.success()).isEqualTo(1);
        assertThat(out.skipped()).isEqualTo(1);
        assertThat(communityArticles.findAllByOrgId(org)).hasSize(1);
    }

    @Test
    void noOpWhenHashUnchanged() {
        CanonicalCommunityArticle row = review(3001L, 5, "제목", "본문", "ANSWERED", 2);
        service.ingestCommunityArticles(org, channel, seller, List.of(row));

        IngestOutcome second = service.ingestCommunityArticles(org, channel, seller, List.of(row));
        assertThat(second.success()).isZero();
        assertThat(second.skipped()).isEqualTo(1);
        assertThat(second.insertedIds()).isEmpty();
        assertThat(communityArticles.findAllByOrgId(org)).hasSize(1);
    }

    @Test
    void updatesInPlaceWhenReplyStatusChanges() {
        service.ingestCommunityArticles(org, channel, seller, List.of(
                review(4001L, null, "문의", "답변 주세요", "PENDING", 2)));

        IngestOutcome second = service.ingestCommunityArticles(org, channel, seller, List.of(
                review(4001L, null, "문의", "답변 주세요", "ANSWERED", 2)));

        assertThat(second.success()).isEqualTo(1);
        assertThat(second.skipped()).isZero();
        assertThat(second.insertedIds()).isEmpty(); // an update, not a new insert
        List<Cafe24CommunityArticle> rows = communityArticles.findAllByOrgId(org);
        assertThat(rows).hasSize(1);
        assertThat(rows.get(0).getReplyStatus()).isEqualTo("ANSWERED");
    }

    @Test
    void updatesInPlaceWhenContentTitleOrRatingChanges() {
        service.ingestCommunityArticles(org, channel, seller, List.of(
                review(5001L, 3, "원래 제목", "원래 본문", "ANSWERED", 2)));

        IngestOutcome second = service.ingestCommunityArticles(org, channel, seller, List.of(
                review(5001L, 5, "수정 제목", "수정 본문", "ANSWERED", 2)));

        assertThat(second.success()).isEqualTo(1);
        List<Cafe24CommunityArticle> rows = communityArticles.findAllByOrgId(org);
        assertThat(rows).hasSize(1);
        Cafe24CommunityArticle a = rows.get(0);
        assertThat(a.getTitle()).isEqualTo("수정 제목");
        assertThat(a.getContent()).isEqualTo("수정 본문");
        assertThat(a.getRating()).isEqualTo(5);
    }

    @Test
    void naturalKeyIncludesSellerAccountSoSameArticleAcrossMallsCoexists() {
        UUID otherSeller = UUID.randomUUID();
        service.ingestCommunityArticles(org, channel, seller, List.of(
                review(6001L, 5, "t", "c", "ANSWERED", 2)));

        IngestOutcome out = service.ingestCommunityArticles(org, channel, otherSeller, List.of(
                review(6001L, 5, "t", "c", "ANSWERED", 2)));

        assertThat(out.success()).isEqualTo(1);
        assertThat(communityArticles.findAllByOrgId(org)).hasSize(2);
    }

    @Test
    void unknownSourceKindAndReplyStatusNormalizeToFallbacks() {
        service.ingestCommunityArticles(org, channel, seller, List.of(
                new CanonicalCommunityArticle(9, 7001L, "mystery", null, "t", "c", null,
                        "weird", null, null, 2)));

        Cafe24CommunityArticle a = communityArticles.findAllByOrgId(org).get(0);
        assertThat(a.getSourceKind()).isEqualTo("OTHER");
        assertThat(a.getReplyStatus()).isEqualTo("UNKNOWN");
    }
}
