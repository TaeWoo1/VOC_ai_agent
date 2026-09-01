package com.sellerops.collect;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.community.Cafe24CommunityArticleRepository;
import com.sellerops.connector.ChannelConnectionStatusRepository;
import com.sellerops.connector.ConnectorCapabilities;
import com.sellerops.connector.ConnectorRegistry;
import com.sellerops.connector.DataType;
import com.sellerops.connector.FetchPage;
import com.sellerops.connector.FetchRequest;
import com.sellerops.connector.MockApiConnector;
import com.sellerops.connector.PullConnector;
import com.sellerops.credential.CredentialUnavailableException;
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
import java.util.EnumSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.PlatformTransactionManager;

/**
 * <b>Synthetic rows must be unreachable on a deployment a seller can see</b> — Pilot Connection &amp;
 * External Proof Gate v1 §3.
 *
 * <p>What makes this worth a dedicated class is that the failure has no error in it. Nothing throws,
 * nothing logs, no health check goes red: the sync SUCCEEDS, the seller's inquiry count goes up, and
 * the rows carry {@code data_origin = REAL} because that is the column's default and nothing on the
 * ingest path knows the difference. By the time anyone asks whether a row is real, the question can
 * no longer be answered from the database.
 *
 * <p>So these tests assert the ONE thing that stays true whatever else is wrong — <b>no rows</b> —
 * across the three states the brief names, each of which is an ordinary configuration a pilot host
 * will be in:
 *
 * <ol>
 *   <li>the channel's connector is switched off (its bean does not exist);</li>
 *   <li>the connector exists but the credential does not;</li>
 *   <li>the connector exists and does not serve this data type.</li>
 * </ol>
 *
 * <p>The registry here is built the way Spring builds it — {@code mockFallbackEnabled = false} — and
 * the mock is deliberately IN the connector list anyway. Passing because the fixture was left out of
 * the list would prove nothing about a deployment where it is present.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class MockConnectorFenceTest {

    @Autowired SellerAccountRepository sellerAccounts;
    @Autowired ChannelRepository channels;
    @Autowired ReviewRepository reviews;
    @Autowired InquiryRepository inquiries;
    @Autowired OrderDailySummaryRepository orders;
    @Autowired ProductRepository products;
    @Autowired Cafe24CommunityArticleRepository communityArticles;
    @Autowired InquiryWorkItemRepository workItems;
    @Autowired InquiryWorkItemAuditRepository audits;
    @Autowired PlatformTransactionManager txManager;
    @Autowired SyncJobRepository syncJobs;
    @Autowired SyncCursorRepository cursors;
    @Autowired ChannelConnectionStatusRepository connectionStatus;
    @Autowired com.sellerops.order.ChannelOrderRepository channelOrders;
    @Autowired com.sellerops.order.ChannelOrderStatusEventRepository channelOrderStatusEvents;

    private final UUID org = UUID.randomUUID();

    /** A connector dedicated to one channel, whose fetch behaviour the test chooses. */
    private static final class DedicatedConnector implements PullConnector {
        private final String channelCode;
        private final Set<DataType> supported;
        private final RuntimeException failWith;

        DedicatedConnector(String channelCode, Set<DataType> supported, RuntimeException failWith) {
            this.channelCode = channelCode;
            this.supported = supported;
            this.failWith = failWith;
        }

        @Override
        public String kind() {
            return "STUB_" + channelCode;
        }

        @Override
        public Set<String> dedicatedChannels() {
            return Set.of(channelCode);
        }

        @Override
        public ConnectorCapabilities capabilities(String code) {
            return new ConnectorCapabilities("API", supported, Map.of(), "stub");
        }

        @Override
        public FetchPage fetch(FetchRequest request) {
            if (failWith != null) {
                throw failWith;
            }
            throw new AssertionError("this stub must never be asked to fetch: " + request.dataType());
        }
    }

    /** The registry exactly as Spring builds it on a deployment that says nothing. */
    private SyncRunExecutor executorWithProductionRegistry(PullConnector... dedicated) {
        List<com.sellerops.connector.ChannelConnector> all =
                new java.util.ArrayList<>(List.of(new MockApiConnector()));
        all.addAll(List.of(dedicated));
        return executorWith(new ConnectorRegistry(all, false));
    }

    private SyncRunExecutor executorWith(ConnectorRegistry registry) {
        IngestionService ingestion = new IngestionService(reviews, inquiries, orders,
                new ProductService(products), communityArticles, channels,
                new InquiryWorkItemWriter(inquiries, workItems, audits, txManager));
        return new SyncRunExecutor(sellerAccounts, channels, registry, ingestion,
                new com.sellerops.order.ChannelOrderIngestionService(
                        channelOrders, channelOrderStatusEvents, txManager),
                syncJobs, cursors, connectionStatus, null, null, null);
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

    /** Nothing was collected, by any measure a later reader could take. */
    private void assertNothingWasWritten() {
        assertThat(inquiries.count()).as("invented inquiries").isZero();
        assertThat(reviews.count()).as("invented reviews").isZero();
        assertThat(orders.count()).as("invented order summaries").isZero();
        assertThat(workItems.count()).as("work the seller was told they owed").isZero();
    }

    // ── 1. The channel's connector is off ────────────────────────────────────────────────────────

    @Test
    void aChannelWhoseConnectorIsOffCollectsNothing() {
        SellerAccount acc = account("CAFE24");

        SyncJob job = executorWithProductionRegistry().execute(org, acc.getId(), DataType.INQUIRY, "MANUAL");

        assertThat(job.getStatus()).isEqualTo("FAILED");
        assertThat(job.getSuccessRows()).isZero();
        assertNothingWasWritten();
    }

    @Test
    void theSameIsTrueOfReviews_theTypeTheMockIsMostWillingToInvent() {
        SellerAccount acc = account("CAFE24");

        SyncJob job = executorWithProductionRegistry().execute(org, acc.getId(), DataType.REVIEW, "MANUAL");

        assertThat(job.getStatus()).isEqualTo("FAILED");
        assertNothingWasWritten();
    }

    // ── 2. The connector exists; the credential does not ─────────────────────────────────────────

    @Test
    void aConnectorWithNoCredentialFailsWithoutWritingAnything() {
        SellerAccount acc = account("CAFE24");
        SyncRunExecutor executor = executorWithProductionRegistry(new DedicatedConnector(
                "CAFE24", EnumSet.of(DataType.INQUIRY),
                new CredentialUnavailableException(
                        com.sellerops.credential.CredentialKeyStatus.NO_CREDENTIAL, null, "자격 증명이 없습니다.")));

        SyncJob job = executor.execute(org, acc.getId(), DataType.INQUIRY, "MANUAL");

        assertThat(job.getStatus()).isEqualTo("FAILED");
        // The point is not that it failed — it is that a missing credential does not degrade into
        // the offline stand-in. The mock is in the list and served nothing.
        assertThat(job.getJobType()).isNotEqualTo(MockApiConnector.KIND);
        assertNothingWasWritten();
    }

    // ── 3. The connector exists and does not serve this data type ────────────────────────────────

    @Test
    void aDataTypeTheChannelDoesNotServeIsNotServedBySomethingElse() {
        SellerAccount acc = account("CAFE24");
        SyncRunExecutor executor = executorWithProductionRegistry(
                new DedicatedConnector("CAFE24", EnumSet.of(DataType.INQUIRY), null));

        SyncJob job = executor.execute(org, acc.getId(), DataType.REVIEW, "MANUAL");

        assertThat(job.getStatus()).isEqualTo("FAILED");
        assertThat(job.getJobType()).isNotEqualTo(MockApiConnector.KIND);
        assertNothingWasWritten();
    }

    // ── The fixture still works when a fixture asks for it ───────────────────────────────────────

    @Test
    void anExplicitFixtureStillGetsTheMock_soThisIsAFenceAndNotADeletion() {
        SellerAccount acc = account("GMARKET");

        // The explicit-fixture constructor: this caller named every connector by hand.
        SyncJob job = executorWith(new ConnectorRegistry(List.of(new MockApiConnector())))
                .execute(org, acc.getId(), DataType.INQUIRY, "MANUAL");

        assertThat(job.getStatus()).isEqualTo("SUCCESS");
        assertThat(job.getJobType()).isEqualTo(MockApiConnector.KIND);
        assertThat(inquiries.count()).isPositive();
    }
}
