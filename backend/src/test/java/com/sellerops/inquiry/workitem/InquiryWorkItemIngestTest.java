package com.sellerops.inquiry.workitem;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.community.Cafe24CommunityArticleRepository;
import com.sellerops.ingest.IngestOutcome;
import com.sellerops.ingest.IngestionService;
import com.sellerops.ingest.canonical.CanonicalInquiry;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.order.OrderDailySummaryRepository;
import com.sellerops.product.ProductRepository;
import com.sellerops.product.ProductService;
import com.sellerops.review.ReviewRepository;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
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
 * Connector inquiry ingest → durable OPEN work queue. Verifies exact SellerAccount
 * linkage, one-work-item-and-audit-per-inquiry, duplicate-ingestion safety, the
 * legacy upload path opening no work item, and that buyer PII is never persisted.
 * Hand-{@code new}ed collaborators over H2, matching the repo convention; the
 * work-item writer gets the autowired transaction manager so its atomic write runs.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class InquiryWorkItemIngestTest {

    @Autowired ReviewRepository reviews;
    @Autowired InquiryRepository inquiries;
    @Autowired OrderDailySummaryRepository orders;
    @Autowired ProductRepository products;
    @Autowired Cafe24CommunityArticleRepository communityArticles;
    @Autowired ChannelRepository channels;
    @Autowired SellerAccountRepository sellerAccounts;
    @Autowired InquiryWorkItemRepository workItems;
    @Autowired InquiryWorkItemAuditRepository audits;
    @Autowired PlatformTransactionManager txManager;

    private IngestionService service;
    private final UUID org = UUID.randomUUID();
    private UUID channelId;
    private UUID sellerAccountId;

    @BeforeEach
    void setUp() {
        InquiryWorkItemWriter writer = new InquiryWorkItemWriter(inquiries, workItems, audits, txManager);
        service = new IngestionService(reviews, inquiries, orders, new ProductService(products),
                communityArticles, channels, writer);

        Channel ch = new Channel();
        ch.setCode("GMARKET");
        ch.setNameKo("G마켓");
        ch.setStatus(ChannelStatus.AVAILABLE);
        ch.setSupportsInquiry(true);
        ch.setSupportsReview(true);
        ch.setSupportsOrder(true);
        ch.setSupportsSales(true);
        ch.setSupportsProduct(true);
        ch.setSortOrder(0);
        channels.save(ch);
        channelId = ch.getId();

        SellerAccount acc = new SellerAccount();
        acc.setOrgId(org);
        acc.setChannelId(ch.getId());
        acc.setConnectionStatus(ChannelStatus.CONNECTED);
        acc.setFileUpload(false);
        sellerAccountId = sellerAccounts.save(acc).getId();
    }

    private CanonicalInquiry row(String externalId, int sourceRow) {
        return new CanonicalInquiry("목업 상품", "SKU-1", "구매자-PII", "재고 있나요",
                "UNANSWERED", at("2026-06-27"), externalId, sourceRow, "재고 문의", "미처리");
    }

    private static Instant at(String date) {
        return LocalDate.parse(date).atStartOfDay(ZoneOffset.UTC).toInstant();
    }

    @Test
    void connectorIngestOpensExactlyOneOpenWorkItemLinkedToTheSellerAccount() {
        IngestOutcome outcome = service.ingestInquiries(org, channelId, sellerAccountId, List.of(row("Q-1", 2)));

        assertThat(outcome.success()).isEqualTo(1);
        assertThat(inquiries.findTop50ByOrgIdOrderByReceivedAtDesc(org)).hasSize(1);

        List<InquiryWorkItem> items = workItems.findAll();
        assertThat(items).hasSize(1);
        InquiryWorkItem wi = items.get(0);
        // The connection FK is the exact SellerAccount — never the channel id.
        assertThat(wi.getSellerAccountId()).isEqualTo(sellerAccountId);
        assertThat(wi.getSellerAccountId()).isNotEqualTo(channelId);
        assertThat(wi.getChannelId()).isEqualTo(channelId);
        assertThat(wi.getOrgId()).isEqualTo(org);
        assertThat(wi.getPhase()).isEqualTo(InquiryWorkItemPhase.OPEN);
        assertThat(wi.getInquiryId())
                .isEqualTo(inquiries.findTop50ByOrgIdOrderByReceivedAtDesc(org).get(0).getId());

        // Exactly one immutable WORK_ITEM_OPENED audit, phaseFrom null → phaseTo OPEN.
        List<InquiryWorkItemAudit> trail = audits.findByWorkItemIdOrderByCreatedAtAsc(wi.getId());
        assertThat(trail).hasSize(1);
        InquiryWorkItemAudit opened = trail.get(0);
        assertThat(opened.getEventType()).isEqualTo(InquiryWorkItemEvent.WORK_ITEM_OPENED);
        assertThat(opened.getPhaseFrom()).isNull();
        assertThat(opened.getPhaseTo()).isEqualTo(InquiryWorkItemPhase.OPEN);
        assertThat(opened.getOrgId()).isEqualTo(org);
        assertThat(opened.getCommandId()).isEqualTo("open:" + wi.getInquiryId());
    }

    @Test
    void duplicateConnectorIngestSkipsAndNeverDoublesTheWorkItemOrAudit() {
        service.ingestInquiries(org, channelId, sellerAccountId, List.of(row("Q-DUP", 2)));
        IngestOutcome second =
                service.ingestInquiries(org, channelId, sellerAccountId, List.of(row("Q-DUP", 2)));

        assertThat(second.skipped()).isEqualTo(1);
        assertThat(second.success()).isZero();
        assertThat(inquiries.findTop50ByOrgIdOrderByReceivedAtDesc(org)).hasSize(1);
        assertThat(workItems.findAll()).hasSize(1);
        assertThat(audits.count()).isEqualTo(1);
    }

    @Test
    void legacyUploadPathIngestsTheInquiryButOpensNoWorkItem() {
        // 3-arg (no sellerAccountId) = file-upload/legacy path.
        IngestOutcome outcome = service.ingestInquiries(org, channelId, List.of(row("Q-UP", 2)));

        assertThat(outcome.success()).isEqualTo(1);
        assertThat(inquiries.findTop50ByOrgIdOrderByReceivedAtDesc(org)).hasSize(1);
        assertThat(workItems.findAll()).isEmpty();
        assertThat(audits.count()).isZero();
    }

    @Test
    void connectorIngestPersistsNoBuyerPiiButKeepsTitleAndRawStatus() {
        service.ingestInquiries(org, channelId, sellerAccountId, List.of(row("Q-PII", 2)));

        Inquiry stored = inquiries.findTop50ByOrgIdOrderByReceivedAtDesc(org).get(0);
        assertThat(stored.getAuthor()).isNull();
        assertThat(stored.getTitle()).isEqualTo("재고 문의");
        assertThat(stored.getInformStatus()).isEqualTo("미처리");
        assertThat(stored.getStatus()).isEqualTo("UNANSWERED");
    }
}
