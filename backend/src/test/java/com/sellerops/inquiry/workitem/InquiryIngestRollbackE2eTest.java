package com.sellerops.inquiry.workitem;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.sellerops.channel.ChannelRepository;
import com.sellerops.community.Cafe24CommunityArticleRepository;
import com.sellerops.ingest.IngestOutcome;
import com.sellerops.ingest.IngestionService;
import com.sellerops.ingest.canonical.CanonicalInquiry;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.order.OrderDailySummaryRepository;
import com.sellerops.product.ProductRepository;
import com.sellerops.product.ProductService;
import com.sellerops.review.ReviewRepository;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * End-to-end proof of atomicity through the real entry point {@link
 * IngestionService#ingestInquiries(UUID, UUID, UUID, List)}: when the audit write
 * fails, the whole unit — Inquiry + WorkItem + Audit — rolls back, so a connector
 * ingest can never leave a half-written work item behind. The row is reported as
 * {@code failed}, not thrown, matching the per-row ingest contract.
 *
 * <p>Runs {@code NOT_SUPPORTED} so no ambient {@code @DataJpaTest} transaction masks
 * the writer's own transaction; the rollback is real and observable afterwards.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class InquiryIngestRollbackE2eTest {

    @Autowired ReviewRepository reviews;
    @Autowired InquiryRepository inquiries;
    @Autowired OrderDailySummaryRepository orders;
    @Autowired ProductRepository products;
    @Autowired Cafe24CommunityArticleRepository communityArticles;
    @Autowired ChannelRepository channels;
    @Autowired InquiryWorkItemRepository workItems;
    @Autowired PlatformTransactionManager txManager;

    @Test
    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    void auditFailureRollsBackInquiryAndWorkItemThroughIngestInquiries() {
        UUID org = UUID.randomUUID();
        UUID channelId = UUID.randomUUID();
        UUID sellerAccountId = UUID.randomUUID();

        // The audit write is the last step; make it fail to force a full rollback.
        InquiryWorkItemAuditRepository failingAudits = mock(InquiryWorkItemAuditRepository.class);
        when(failingAudits.save(any())).thenThrow(new RuntimeException("audit write boom"));

        InquiryWorkItemWriter writer =
                new InquiryWorkItemWriter(inquiries, workItems, failingAudits, txManager);
        IngestionService service = new IngestionService(reviews, inquiries, orders,
                new ProductService(products), communityArticles, channels, writer);

        IngestOutcome outcome = service.ingestInquiries(org, channelId, sellerAccountId, List.of(
                new CanonicalInquiry("상품", "SKU-1", "구매자-PII", "재고 있나요", "UNANSWERED",
                        Instant.parse("2026-06-27T00:00:00Z"), "Q-RB", 2, "재고 문의", "미처리")));

        // Row reported failed (not thrown), and nothing durable survived the rollback.
        assertThat(outcome.failed()).isEqualTo(1);
        assertThat(outcome.success()).isZero();
        assertThat(inquiries.findTop50ByOrgIdOrderByReceivedAtDesc(org)).isEmpty();
        assertThat(workItems.countByOrgIdAndPhase(org, InquiryWorkItemPhase.OPEN)).isZero();
    }
}
