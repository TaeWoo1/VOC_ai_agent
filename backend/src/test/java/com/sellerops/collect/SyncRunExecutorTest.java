package com.sellerops.collect;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.connector.ChannelConnectionStatusRepository;
import com.sellerops.connector.ConnectorCapabilities;
import com.sellerops.connector.ConnectorRegistry;
import com.sellerops.connector.DataType;
import com.sellerops.connector.FetchPage;
import com.sellerops.connector.FetchRequest;
import com.sellerops.connector.MockApiConnector;
import com.sellerops.connector.PullConnector;
import com.sellerops.ingest.IngestionService;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.order.OrderDailySummaryRepository;
import com.sellerops.product.ProductRepository;
import com.sellerops.product.ProductService;
import com.sellerops.review.ReviewRepository;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import com.sellerops.sync.SyncCursor;
import com.sellerops.sync.SyncCursorRepository;
import com.sellerops.sync.SyncJob;
import com.sellerops.sync.SyncJobRepository;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * Slice 3 persistence slice: SyncRunExecutor routes mock pages into IngestionService,
 * advances the cursor, records the run, and tracks health — over a real (H2) DB.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class SyncRunExecutorTest {

    @Autowired SellerAccountRepository sellerAccounts;
    @Autowired ChannelRepository channels;
    @Autowired ReviewRepository reviews;
    @Autowired InquiryRepository inquiries;
    @Autowired OrderDailySummaryRepository orders;
    @Autowired ProductRepository products;
    @Autowired SyncJobRepository syncJobs;
    @Autowired SyncCursorRepository cursors;
    @Autowired ChannelConnectionStatusRepository connectionStatus;

    private MockApiConnector mock;
    private SyncRunExecutor executor;
    private final UUID org = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        mock = new MockApiConnector();
        ConnectorRegistry registry = new ConnectorRegistry(List.of(mock));
        IngestionService ingestion = new IngestionService(reviews, inquiries, orders, new ProductService(products));
        executor = new SyncRunExecutor(sellerAccounts, channels, registry, ingestion, syncJobs, cursors, connectionStatus);
    }

    private SellerAccount account(String channelCode) {
        Channel ch = new Channel();
        ch.setCode(channelCode);
        ch.setNameKo(channelCode);
        ch.setStatus(ChannelStatus.AVAILABLE);
        ch.setSupportsInquiry(true);
        ch.setSupportsReview(true);
        ch.setSupportsOrder(true);
        ch.setSupportsSales(true);
        ch.setSupportsProduct(true);
        ch.setSortOrder(0);
        channels.save(ch);

        SellerAccount acc = new SellerAccount();
        acc.setOrgId(org);
        acc.setChannelId(ch.getId());
        acc.setConnectionStatus(ChannelStatus.CONNECTED);
        acc.setFileUpload(false);
        return sellerAccounts.save(acc);
    }

    private SyncCursor cursor(UUID accountId, DataType type) {
        return cursors.findByOrgIdAndSellerAccountIdAndDataTypeAndCursorKey(
                org, accountId, type.name(), SyncRunExecutor.CURSOR_KEY).orElseThrow();
    }

    @Test
    void fullRunPersistsRecordsAndAdvancesCursor() {
        SellerAccount acc = account("GMARKET");

        SyncJob job = executor.execute(org, acc.getId(), DataType.INQUIRY, "MANUAL");

        assertThat(job.getStatus()).isEqualTo("SUCCESS");
        assertThat(job.getSuccessRows()).isEqualTo(45); // mock INQUIRY total
        assertThat(job.getTotalRows()).isEqualTo(45);
        assertThat(job.getSellerAccountId()).isEqualTo(acc.getId());
        assertThat(job.getDataType()).isEqualTo("INQUIRY");
        assertThat(job.getTrigger()).isEqualTo("MANUAL");
        assertThat(job.getJobType()).isEqualTo("MOCK_API");

        assertThat(inquiries.count()).isEqualTo(45);
        assertThat(cursor(acc.getId(), DataType.INQUIRY).getCursorValue()).isEqualTo("45");

        assertThat(sellerAccounts.findById(acc.getId()).orElseThrow().getLastSyncedAt()).isNotNull();
        var health = connectionStatus.findBySellerAccountId(acc.getId()).orElseThrow();
        assertThat(health.getState()).isEqualTo("CONNECTED");
        assertThat(health.getConsecutiveFailures()).isZero();
    }

    @Test
    void rerunOverSameWindowIsIdempotentViaDedup() {
        SellerAccount acc = account("GMARKET");
        executor.execute(org, acc.getId(), DataType.INQUIRY, "MANUAL");

        // Reset the cursor so the connector re-serves the same window.
        SyncCursor c = cursor(acc.getId(), DataType.INQUIRY);
        c.setCursorValue(null);
        cursors.save(c);

        SyncJob rerun = executor.execute(org, acc.getId(), DataType.INQUIRY, "MANUAL");

        assertThat(rerun.getStatus()).isEqualTo("SUCCESS");
        assertThat(rerun.getSuccessRows()).isZero();
        assertThat(rerun.getSkippedRows()).isEqualTo(45); // all duplicates
        assertThat(inquiries.count()).isEqualTo(45); // no new rows
    }

    @Test
    void rerunFromSavedCursorFetchesNothingNew() {
        SellerAccount acc = account("GMARKET");
        executor.execute(org, acc.getId(), DataType.INQUIRY, "MANUAL");

        SyncJob rerun = executor.execute(org, acc.getId(), DataType.INQUIRY, "MANUAL");

        assertThat(rerun.getStatus()).isEqualTo("SUCCESS");
        assertThat(rerun.getTotalRows()).isZero();
        assertThat(inquiries.count()).isEqualTo(45);
    }

    @Test
    void routesOrderSummaryByDataType() {
        SellerAccount acc = account("GMARKET");

        SyncJob job = executor.execute(org, acc.getId(), DataType.ORDER_SUMMARY, "MANUAL");

        assertThat(job.getStatus()).isEqualTo("SUCCESS");
        assertThat(orders.count()).isEqualTo(30); // mock ORDER_SUMMARY total
    }

    @Test
    void rateLimitMidRunIsPartialAndKeepsLandedData() {
        SellerAccount acc = account("GMARKET");
        // REVIEW total is 60; with a page size of 50 the executor fetches offset 0
        // (50 land) then offset 50 — throttle there exercises a genuine mid-run stop.
        mock.setRateLimitAtOffset(50);

        SyncJob job = executor.execute(org, acc.getId(), DataType.REVIEW, "MANUAL");

        assertThat(job.getStatus()).isEqualTo("PARTIAL");
        assertThat(job.isRateLimited()).isTrue();
        assertThat(job.getSuccessRows()).isEqualTo(50);
        assertThat(reviews.count()).isEqualTo(50);
        assertThat(cursor(acc.getId(), DataType.REVIEW).getCursorValue()).isEqualTo("50");
        // Data landed → connection still healthy.
        assertThat(connectionStatus.findBySellerAccountId(acc.getId()).orElseThrow().getState())
                .isEqualTo("CONNECTED");
    }

    @Test
    void rateLimitOnFirstFetchIsFailureWithoutHealthPenalty() {
        SellerAccount acc = account("GMARKET");
        mock.setRateLimitAtOffset(0); // throttled before any data

        SyncJob job = executor.execute(org, acc.getId(), DataType.INQUIRY, "MANUAL");

        assertThat(job.getStatus()).isEqualTo("FAILED");
        assertThat(job.isRateLimited()).isTrue();
        assertThat(inquiries.count()).isZero();
        assertThat(sellerAccounts.findById(acc.getId()).orElseThrow().getLastSyncedAt()).isNull();
        // Throttling is not a connectivity failure: the reason is recorded but the
        // failure counter (which drives DEGRADED escalation) stays untouched.
        var health = connectionStatus.findBySellerAccountId(acc.getId()).orElseThrow();
        assertThat(health.getConsecutiveFailures()).isZero();
        assertThat(health.getState()).isEqualTo("CONNECTED");
        assertThat(health.getLastError()).isNotNull();
    }

    @Test
    void midRunExceptionAfterDataLandedIsPartialNotZeroRowFailure() {
        SellerAccount acc = account("GMARKET");
        // Connector that serves the first REVIEW page (50 land) then throws on the next.
        PullConnector flaky = new PullConnector() {
            @Override
            public String kind() {
                return "MOCK_API";
            }

            @Override
            public ConnectorCapabilities capabilities(String channelCode) {
                return mock.capabilities(channelCode);
            }

            @Override
            public FetchPage fetch(FetchRequest request) {
                if (request.cursorValue() == null) {
                    return mock.fetch(request); // first page lands real records
                }
                throw new RuntimeException("simulated page failure");
            }
        };
        ConnectorRegistry registry = new ConnectorRegistry(List.of(flaky));
        IngestionService ingestion = new IngestionService(reviews, inquiries, orders, new ProductService(products));
        SyncRunExecutor flakyExecutor = new SyncRunExecutor(
                sellerAccounts, channels, registry, ingestion, syncJobs, cursors, connectionStatus);

        SyncJob job = flakyExecutor.execute(org, acc.getId(), DataType.REVIEW, "MANUAL");

        assertThat(job.getStatus()).isEqualTo("PARTIAL"); // earlier page kept, not zero-row FAILED
        assertThat(job.getSuccessRows()).isEqualTo(50);
        assertThat(reviews.count()).isEqualTo(50);
        assertThat(cursor(acc.getId(), DataType.REVIEW).getCursorValue()).isEqualTo("50");
        assertThat(connectionStatus.findBySellerAccountId(acc.getId()).orElseThrow().getState())
                .isEqualTo("CONNECTED");
    }

    @Test
    void unsupportedDataTypeRecordsConfigFailureWithoutTouchingHealth() {
        SellerAccount acc = account("COUPANG"); // mock: reviews unsupported on Coupang

        SyncJob job = executor.execute(org, acc.getId(), DataType.REVIEW, "MANUAL");

        assertThat(job.getStatus()).isEqualTo("FAILED");
        assertThat(job.getErrorMessage()).contains("지원되지");
        assertThat(reviews.count()).isZero();
        // A config issue, not a connectivity failure → no health row touched.
        assertThat(connectionStatus.findBySellerAccountId(acc.getId())).isEmpty();
    }
}
