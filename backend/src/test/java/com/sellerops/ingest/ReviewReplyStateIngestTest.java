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
import com.sellerops.order.OrderDailySummaryRepository;
import com.sellerops.product.ProductRepository;
import com.sellerops.product.ProductService;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewReplyState;
import com.sellerops.review.ReviewRepository;
import jakarta.persistence.EntityManager;
import java.time.Instant;
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
 * Reply state through ingest: it lands on a first import, and — the part that makes the feature
 * real — a DUPLICATE row refreshes it.
 *
 * <p>Dedup skips duplicates, so without the refresh the state would freeze at first import while the
 * SECOND export is exactly where it changes. The refresh is deliberately field-scoped and monotonic;
 * both properties are pinned here, including the negative that a duplicate touches nothing else.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class ReviewReplyStateIngestTest {

    @Autowired ReviewRepository reviews;
    @Autowired InquiryRepository inquiries;
    @Autowired OrderDailySummaryRepository orders;
    @Autowired ProductRepository products;
    @Autowired Cafe24CommunityArticleRepository communityArticles;
    @Autowired ChannelRepository channels;
    @Autowired InquiryWorkItemRepository workItems;
    @Autowired InquiryWorkItemAuditRepository audits;
    @Autowired PlatformTransactionManager txManager;
    @Autowired EntityManager em;

    private IngestionService ingestion;
    private final UUID org = UUID.randomUUID();
    private UUID channelId;

    private static final String ID = "1000000001";
    private static final Instant RECEIVED = Instant.parse("2026-05-05T00:00:00Z");
    private static final Instant REPLIED = Instant.parse("2026-05-07T00:00:00Z");

    @BeforeEach
    void setUp() {
        ingestion = new IngestionService(reviews, inquiries, orders, new ProductService(products),
                communityArticles, channels,
                new InquiryWorkItemWriter(inquiries, workItems, audits, txManager));
        Channel ch = new Channel();
        ch.setCode("NAVER");
        ch.setNameKo("네이버 스마트스토어");
        ch.setStatus(ChannelStatus.AVAILABLE);
        ch.setSortOrder(0);
        channelId = channels.save(ch).getId();
    }

    private CanonicalReview row(ReviewReplyState state, Instant repliedAt) {
        return new CanonicalReview("합성 상품", "SKU-합성-11", 2, "합성 리뷰 본문 - 배송이 늦었습니다.",
                RECEIVED, ID, 2, state, repliedAt);
    }

    /**
     * The stored row, read back through a CLEARED persistence context.
     *
     * <p>Without the flush+clear these tests would be vacuous: {@code @DataJpaTest} runs the whole
     * method in one transaction, so {@code findReview} hands back a MANAGED entity and mutating it
     * would satisfy every assertion even if {@code reviews.save(...)} were deleted. Production is
     * the opposite shape — {@code IngestionService} carries no {@code @Transactional} and its
     * callers are deliberately non-transactional, so the entity is detached and the save is a real
     * merge. Clearing the context is what makes the test exercise the property production depends
     * on.
     */
    private Review stored() {
        em.flush();
        em.clear();
        return reviews.findByOrgIdAndChannelIdAndExternalId(org, channelId, ID).orElseThrow();
    }

    @Test
    void aFirstImportCarriesTheChannelsStatement() {
        IngestOutcome outcome = ingestion.ingestReviews(org, channelId, List.of(row(ReviewReplyState.ANSWERED, REPLIED)));

        assertThat(outcome.success()).isEqualTo(1);
        assertThat(stored().getReplyState()).isEqualTo(ReviewReplyState.ANSWERED);
        assertThat(stored().getRepliedAt()).isEqualTo(REPLIED);
    }

    @Test
    void aSourceThatSaysNothingStoresUnknownRatherThanGuessing() {
        ingestion.ingestReviews(org, channelId, List.of(
                new CanonicalReview("합성 상품", "SKU-합성-11", 2, "합성 리뷰 본문", RECEIVED, ID, 2)));

        assertThat(stored().getReplyState()).isEqualTo(ReviewReplyState.UNKNOWN);
        assertThat(stored().getRepliedAt()).isNull();
    }

    @Test
    void aDuplicateRefreshesPendingIntoAnswered() {
        // THE CASE THE FEATURE EXISTS FOR: the seller answered between two exports.
        ingestion.ingestReviews(org, channelId, List.of(row(ReviewReplyState.PENDING, null)));

        IngestOutcome second = ingestion.ingestReviews(org, channelId, List.of(row(ReviewReplyState.ANSWERED, REPLIED)));

        assertThat(second.success()).isZero();
        assertThat(second.skipped()).isEqualTo(1);   // still a duplicate — dedup semantics unchanged
        assertThat(reviews.findAllByOrgId(org)).hasSize(1);
        assertThat(stored().getReplyState()).isEqualTo(ReviewReplyState.ANSWERED);
        assertThat(stored().getRepliedAt()).isEqualTo(REPLIED);
    }

    @Test
    void aStaleReUploadCanNEVERUnAnswerAReview() {
        // The monotonic rule at the ingest seam. A re-imported older export must not undo an answer:
        // that would re-inflate the queue and re-arm the guided flow against an already-answered
        // review, which is an irreversible public double-post.
        ingestion.ingestReviews(org, channelId, List.of(row(ReviewReplyState.ANSWERED, REPLIED)));

        ingestion.ingestReviews(org, channelId, List.of(row(ReviewReplyState.PENDING, null)));

        assertThat(stored().getReplyState()).isEqualTo(ReviewReplyState.ANSWERED);
        assertThat(stored().getRepliedAt()).isEqualTo(REPLIED);   // and the date it came with survives
    }

    @Test
    void aDuplicateTouchesNOTHINGButReplyState() {
        // Dedup means "we already have this review". A re-export must not be able to rewrite the
        // content we stored the first time, so the refresh is field-scoped by construction.
        ingestion.ingestReviews(org, channelId, List.of(row(ReviewReplyState.PENDING, null)));
        Review before = stored();
        UUID id = before.getId();
        Integer ratingBefore = before.getRating();
        String bodyBefore = before.getBody();
        Instant receivedBefore = before.getReceivedAt();
        String hashBefore = before.getContentHash();
        UUID productBefore = before.getProductId();

        // Same identity (리뷰글번호), everything else deliberately different. Note the product is
        // resolved BEFORE the dedup check, so a new `products` row IS minted for the different
        // 상품번호 — what must not move is anything on the REVIEW.
        ingestion.ingestReviews(org, channelId, List.of(new CanonicalReview(
                "다른 합성 상품", "SKU-합성-99", 5, "완전히 다른 본문",
                Instant.parse("2026-06-01T00:00:00Z"), ID, 2, ReviewReplyState.ANSWERED, REPLIED)));

        Review after = stored();
        assertThat(after.getId()).isEqualTo(id);
        assertThat(after.getRating()).isEqualTo(ratingBefore);
        assertThat(after.getBody()).isEqualTo(bodyBefore);
        assertThat(after.getReceivedAt()).isEqualTo(receivedBefore);
        assertThat(after.getContentHash()).isEqualTo(hashBefore);
        assertThat(after.getExternalId()).isEqualTo(ID);
        assertThat(after.getProductId()).isEqualTo(productBefore);   // the new product did NOT rebind
        assertThat(after.getReplyState()).isEqualTo(ReviewReplyState.ANSWERED);   // …only this moved
    }

    @Test
    void aDuplicateWithNoStatementLeavesTheKnownStateAlone() {
        ingestion.ingestReviews(org, channelId, List.of(row(ReviewReplyState.PENDING, null)));

        ingestion.ingestReviews(org, channelId, List.of(row(ReviewReplyState.UNKNOWN, null)));

        assertThat(stored().getReplyState()).isEqualTo(ReviewReplyState.PENDING);
    }

    @Test
    void twoRowsWithTheSameIdInOneFileCollapseToOneAndTheANSWEREDStatementSTILLWins() {
        // An export that lists the same 리뷰글번호 twice — N first, then Y. The row is inserted once,
        // but the second row's statement must not be thrown away: leaving the review PENDING would
        // keep it in the queue and let the guided flow point at a review that already has a public
        // reply. The monotonic rule does not care which side of a file boundary the two rows sat on.
        IngestOutcome outcome = ingestion.ingestReviews(org, channelId,
                List.of(row(ReviewReplyState.PENDING, null), row(ReviewReplyState.ANSWERED, REPLIED)));

        assertThat(outcome.success()).isEqualTo(1);
        assertThat(outcome.skipped()).isEqualTo(1);
        assertThat(reviews.findAllByOrgId(org)).hasSize(1);
        assertThat(stored().getReplyState()).isEqualTo(ReviewReplyState.ANSWERED);
        assertThat(stored().getRepliedAt()).isEqualTo(REPLIED);
    }

    @Test
    void anInFileDuplicateStillCannotUnAnswer() {
        // …and the rule holds in the other direction within one file too.
        IngestOutcome outcome = ingestion.ingestReviews(org, channelId,
                List.of(row(ReviewReplyState.ANSWERED, REPLIED), row(ReviewReplyState.PENDING, null)));

        assertThat(outcome.success()).isEqualTo(1);
        assertThat(stored().getReplyState()).isEqualTo(ReviewReplyState.ANSWERED);
    }

    @Test
    void aReplyDateThatArrivesAFTERTheStateIsStillLearned() {
        // An export can report ANSWERED with a blank 답글등록일시 and a later one supply it. Gating
        // the date on the state moving would make it permanently unlearnable in exactly that case.
        ingestion.ingestReviews(org, channelId, List.of(row(ReviewReplyState.ANSWERED, null)));
        assertThat(stored().getRepliedAt()).isNull();

        ingestion.ingestReviews(org, channelId, List.of(row(ReviewReplyState.ANSWERED, REPLIED)));

        assertThat(stored().getRepliedAt()).isEqualTo(REPLIED);
        assertThat(stored().getReplyState()).isEqualTo(ReviewReplyState.ANSWERED);
    }
}
