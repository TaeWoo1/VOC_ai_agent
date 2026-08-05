package com.sellerops.collect;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.connector.ConnectorRegistry;
import com.sellerops.connector.DataType;
import com.sellerops.connector.MockApiConnector;
import com.sellerops.ingest.IngestionService;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItemAuditRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItemRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItemWriter;
import com.sellerops.order.OrderDailySummaryRepository;
import com.sellerops.product.ProductRepository;
import com.sellerops.product.ProductService;
import com.sellerops.review.ReviewRepository;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import com.sellerops.sync.SyncCursorRepository;
import com.sellerops.sync.SyncJob;
import com.sellerops.sync.SyncJobRepository;
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
 * End-to-end single-flight through {@link SyncRunExecutor} with the {@link SyncRunGate} wired: a
 * normal run still succeeds, and a start that meets an already-in-flight RUNNING run for the same
 * (account, data type) coalesces onto it — no second job, and the connector never re-runs (the shared
 * cursor is left untouched).
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class SyncRunExecutorSingleFlightTest {

    @Autowired SellerAccountRepository sellerAccounts;
    @Autowired ChannelRepository channels;
    @Autowired ReviewRepository reviews;
    @Autowired InquiryRepository inquiries;
    @Autowired OrderDailySummaryRepository orders;
    @Autowired ProductRepository products;
    @Autowired com.sellerops.community.Cafe24CommunityArticleRepository communityArticles;
    @Autowired InquiryWorkItemRepository workItems;
    @Autowired InquiryWorkItemAuditRepository audits;
    @Autowired SyncJobRepository syncJobs;
    @Autowired SyncCursorRepository cursors;
    @Autowired com.sellerops.connector.ChannelConnectionStatusRepository connectionStatus;
    @Autowired com.sellerops.order.ChannelOrderRepository channelOrders;
    @Autowired com.sellerops.order.ChannelOrderStatusEventRepository channelOrderStatusEvents;
    @Autowired PlatformTransactionManager txManager;

    private final UUID org = UUID.randomUUID();
    private SyncRunExecutor executor;

    @BeforeEach
    void setUp() {
        MockApiConnector mock = new MockApiConnector();
        ConnectorRegistry registry = new ConnectorRegistry(List.of(mock));
        IngestionService ingestion = new IngestionService(reviews, inquiries, orders,
                new ProductService(products), communityArticles, channels,
                new InquiryWorkItemWriter(inquiries, workItems, audits, txManager));
        com.sellerops.order.ChannelOrderIngestionService orderIngestion =
                new com.sellerops.order.ChannelOrderIngestionService(channelOrders, channelOrderStatusEvents, txManager);
        SyncRunGate gate = new SyncRunGate(sellerAccounts, syncJobs, txManager, 60);
        executor = new SyncRunExecutor(sellerAccounts, channels, registry, ingestion, orderIngestion,
                syncJobs, cursors, connectionStatus, null, null, null, gate);
    }

    @Test
    void normalRunSucceedsWithTheGateWired() {
        SellerAccount acc = account("GMARKET");

        SyncJob job = executor.execute(org, acc.getId(), DataType.INQUIRY, "MANUAL");

        assertThat(job.getStatus()).isEqualTo("SUCCESS");
        assertThat(job.getSuccessRows()).isEqualTo(45);
        assertThat(inquiries.count()).isEqualTo(45);
    }

    @Test
    void aStartMeetingAnInFlightRunCoalescesInsteadOfDuplicating() {
        SellerAccount acc = account("GMARKET");
        // Simulate a run already in flight for this (account, INQUIRY).
        SyncJob inFlight = running(acc.getId(), DataType.INQUIRY);

        SyncJob returned = executor.execute(org, acc.getId(), DataType.INQUIRY, "MANUAL");

        // Coalesced: the in-flight run is returned; no second job, and the connector never ran.
        assertThat(returned.getId()).isEqualTo(inFlight.getId());
        assertThat(returned.getStatus()).isEqualTo("RUNNING");
        assertThat(syncJobs.findRunningBySellerAccountIdAndDataType(acc.getId(), "INQUIRY")).hasSize(1);
        assertThat(inquiries.count()).isZero(); // connector did not re-run
        assertThat(cursors.findByOrgIdAndSellerAccountIdAndDataTypeAndCursorKey(
                org, acc.getId(), "INQUIRY", SyncRunExecutor.CURSOR_KEY)).isEmpty(); // cursor untouched
    }

    private SyncJob running(UUID accountId, DataType dataType) {
        SyncJob job = new SyncJob();
        job.setOrgId(org);
        job.setSellerAccountId(accountId);
        job.setDataType(dataType.name());
        job.setStatus("RUNNING");
        job.setTrigger("MANUAL");
        job.setJobType("TEST");
        job.setStartedAt(Instant.now());
        return syncJobs.save(job);
    }

    private SellerAccount account(String channelCode) {
        Channel ch = channels.findByCode(channelCode).orElseGet(() -> {
            Channel c = new Channel();
            c.setCode(channelCode);
            c.setNameKo(channelCode);
            c.setStatus(ChannelStatus.AVAILABLE);
            c.setSupportsInquiry(true);
            c.setSupportsReview(true);
            c.setSupportsOrder(true);
            c.setSupportsSales(true);
            c.setSupportsProduct(true);
            c.setSortOrder(0);
            return channels.save(c);
        });
        SellerAccount acc = new SellerAccount();
        acc.setOrgId(org);
        acc.setChannelId(ch.getId());
        acc.setConnectionStatus(ChannelStatus.CONNECTED);
        acc.setFileUpload(false);
        return sellerAccounts.save(acc);
    }
}
