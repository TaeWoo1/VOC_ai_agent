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
import com.sellerops.connector.naver.NaverApiConnector;
import com.sellerops.connector.naver.NaverHttpClient;
import com.sellerops.connector.naver.NaverOrdersClient;
import com.sellerops.connector.naver.NaverTokenClient;
import com.sellerops.credential.ConnectorCredentialRepository;
import com.sellerops.credential.CredentialVault;
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
import org.springframework.security.crypto.bcrypt.BCrypt;
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
    @Autowired ConnectorCredentialRepository credentials;

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

    private SyncRunExecutor naverExecutor(NaverHttpClient http, CredentialVault vault) {
        NaverApiConnector naver = new NaverApiConnector(
                new NaverTokenClient(http, java.time.Clock.systemUTC(), "https://fake.naver.test"),
                new NaverOrdersClient(http, java.time.Clock.systemUTC(), "https://fake.naver.test", 100),
                vault);
        ConnectorRegistry registry = new ConnectorRegistry(List.of(naver, mock));
        IngestionService ingestion = new IngestionService(reviews, inquiries, orders, new ProductService(products));
        return new SyncRunExecutor(
                sellerAccounts, channels, registry, ingestion, syncJobs, cursors, connectionStatus);
    }

    @Test
    void naverUnsupportedTypeStopsAtCapabilityGateBeforeAnyFetchOrHttp() {
        // INQUIRY stays unsupported in Slice 1b: the capability gate must record
        // a config failure before fetch — no HTTP, no vault access.
        SellerAccount acc = account("NAVER");
        NaverHttpClient neverCalled = new ThrowingNaverHttpClient();

        SyncJob job = naverExecutor(neverCalled, null)
                .execute(org, acc.getId(), DataType.INQUIRY, "MANUAL");

        assertThat(job.getStatus()).isEqualTo("FAILED");
        assertThat(job.getErrorMessage()).contains("지원되지");
        assertThat(job.getJobType()).isEqualTo("NAVER_API"); // routed to the dedicated connector
        assertThat(inquiries.count()).isZero();
        // A config issue, not a connectivity failure → no health row touched.
        assertThat(connectionStatus.findBySellerAccountId(acc.getId())).isEmpty();
    }

    @Test
    void coupangSkeletonStopsAtCapabilityGateBeforeAnyFetchOrHttp() {
        // Phase 3D-2: the Coupang skeleton advertises no collectable data type,
        // so even with the dedicated connector resolved (flag-on equivalent) a
        // manual ORDER_SUMMARY sync must die at the capability gate — config
        // failure, no fetch, no vault access, no HTTP, no health row.
        SellerAccount acc = account("COUPANG");
        com.sellerops.connector.coupang.CoupangHttpClient neverCalled = (uri, headers) -> {
            throw new AssertionError("must not reach the HTTP boundary");
        };
        com.sellerops.connector.coupang.CoupangApiConnector coupang =
                new com.sellerops.connector.coupang.CoupangApiConnector(neverCalled, null);
        ConnectorRegistry registry = new ConnectorRegistry(List.of(coupang, mock));
        IngestionService ingestion = new IngestionService(reviews, inquiries, orders, new ProductService(products));
        SyncRunExecutor coupangExecutor = new SyncRunExecutor(
                sellerAccounts, channels, registry, ingestion, syncJobs, cursors, connectionStatus);

        SyncJob job = coupangExecutor.execute(org, acc.getId(), DataType.ORDER_SUMMARY, "MANUAL");

        assertThat(job.getStatus()).isEqualTo("FAILED");
        assertThat(job.getErrorMessage()).contains("지원되지");
        assertThat(job.getJobType()).isEqualTo("COUPANG_API"); // routed to the dedicated connector
        assertThat(orders.count()).isZero();
        // A config issue, not a connectivity failure → no health row touched.
        assertThat(connectionStatus.findBySellerAccountId(acc.getId())).isEmpty();
    }

    @Test
    void cafe24SkeletonStopsAtCapabilityGateBeforeAnyFetchOrHttp() {
        // Phase 3D-3: same safe state as the Coupang skeleton — empty
        // capabilities kill a manual sync at the config gate before fetch,
        // so no vault access, no token refresh, no HTTP.
        SellerAccount acc = account("CAFE24");
        com.sellerops.connector.cafe24.Cafe24HttpClient neverCalled = (uri, headers, form) -> {
            throw new AssertionError("must not reach the HTTP boundary");
        };
        com.sellerops.connector.cafe24.Cafe24ApiConnector cafe24 =
                new com.sellerops.connector.cafe24.Cafe24ApiConnector(
                        new com.sellerops.connector.cafe24.Cafe24TokenClient(neverCalled), null);
        ConnectorRegistry registry = new ConnectorRegistry(List.of(cafe24, mock));
        IngestionService ingestion = new IngestionService(reviews, inquiries, orders, new ProductService(products));
        SyncRunExecutor cafe24Executor = new SyncRunExecutor(
                sellerAccounts, channels, registry, ingestion, syncJobs, cursors, connectionStatus);

        SyncJob job = cafe24Executor.execute(org, acc.getId(), DataType.ORDER_SUMMARY, "MANUAL");

        assertThat(job.getStatus()).isEqualTo("FAILED");
        assertThat(job.getErrorMessage()).contains("지원되지");
        assertThat(job.getJobType()).isEqualTo("CAFE24_API"); // routed to the dedicated connector
        assertThat(orders.count()).isZero();
        assertThat(connectionStatus.findBySellerAccountId(acc.getId())).isEmpty();
    }

    @Test
    void esmSkeletonStopsAtCapabilityGateBeforeAnyFetchOrHttp() {
        // Phase 3D-4: same safe state as the other skeletons — empty
        // capabilities kill a manual sync at the config gate before fetch.
        SellerAccount acc = account("GMARKET");
        com.sellerops.connector.esm.EsmHttpClient neverCalled = (uri, headers, jsonBody) -> {
            throw new AssertionError("must not reach the HTTP boundary");
        };
        com.sellerops.connector.esm.EsmApiConnector esm =
                new com.sellerops.connector.esm.EsmApiConnector(neverCalled, null);
        ConnectorRegistry registry = new ConnectorRegistry(List.of(esm, mock));
        IngestionService ingestion = new IngestionService(reviews, inquiries, orders, new ProductService(products));
        SyncRunExecutor esmExecutor = new SyncRunExecutor(
                sellerAccounts, channels, registry, ingestion, syncJobs, cursors, connectionStatus);

        SyncJob job = esmExecutor.execute(org, acc.getId(), DataType.ORDER_SUMMARY, "MANUAL");

        assertThat(job.getStatus()).isEqualTo("FAILED");
        assertThat(job.getErrorMessage()).contains("지원되지");
        assertThat(job.getJobType()).isEqualTo("ESM_API"); // routed to the dedicated connector
        assertThat(orders.count()).isZero();
        assertThat(connectionStatus.findBySellerAccountId(acc.getId())).isEmpty();
    }

    @Test
    void naverOrderSummaryRunsEndToEndThroughExecutor() {
        // Slice 1b: ORDER_SUMMARY is now reachable — manual sync drives the full
        // chain (vault → token → two-call flow → ingestion → cursor → health).
        SellerAccount acc = account("NAVER");
        String masterKey = java.util.Base64.getEncoder().encodeToString(new byte[32]);
        CredentialVault vault = new CredentialVault(
                credentials, new com.fasterxml.jackson.databind.ObjectMapper(), masterKey, "test-key");
        vault.store(org, acc.getId(), "API", "OAUTH2",
                java.util.Map.of("client_id", "cid", "client_secret", BCrypt.gensalt()),
                null, null, null);

        QueueingNaverHttpClient http = new QueueingNaverHttpClient();
        http.responses.add(new NaverHttpClient.Response(200,
                "{\"access_token\":\"tok-1\",\"expires_in\":3000,\"token_type\":\"Bearer\"}", java.util.Map.of()));
        http.responses.add(new NaverHttpClient.Response(200,
                "{\"data\":{\"lastChangeStatuses\":[{\"productOrderId\":\"PO1\",\"orderId\":\"O1\","
                        + "\"productOrderStatus\":\"PAYED\",\"lastChangedType\":\"PAYED\","
                        + "\"lastChangedDate\":\"2026-06-11T22:00:00+09:00\","
                        + "\"paymentDate\":\"2026-06-11T22:00:00+09:00\"}]}}", java.util.Map.of()));
        http.responses.add(new NaverHttpClient.Response(200,
                "{\"data\":[{\"productOrder\":{\"productOrderId\":\"PO1\",\"initialPaymentAmount\":12000}}]}",
                java.util.Map.of()));

        SyncJob job = naverExecutor(http, vault).execute(org, acc.getId(), DataType.ORDER_SUMMARY, "MANUAL");

        assertThat(job.getStatus()).isEqualTo("SUCCESS");
        assertThat(job.getJobType()).isEqualTo("NAVER_API");
        assertThat(job.getSuccessRows()).isEqualTo(1);
        assertThat(orders.count()).isEqualTo(1);
        var summary = orders.findAll().get(0);
        assertThat(summary.getSummaryDate()).isEqualTo(java.time.LocalDate.parse("2026-06-11"));
        assertThat(summary.getOrderCount()).isEqualTo(1);
        assertThat(summary.getSalesAmount()).isEqualTo(12000L);
        assertThat(cursor(acc.getId(), DataType.ORDER_SUMMARY).getCursorValue()).contains("windowFrom");
        assertThat(connectionStatus.findBySellerAccountId(acc.getId()).orElseThrow().getState())
                .isEqualTo("CONNECTED");
    }

    /** All methods refuse — proves a code path can never reach HTTP. */
    private static final class ThrowingNaverHttpClient implements NaverHttpClient {
        @Override
        public Response postForm(java.net.URI uri, java.util.Map<String, String> form) {
            throw new AssertionError("must not reach the HTTP boundary");
        }

        @Override
        public Response get(java.net.URI uri, String bearerToken) {
            throw new AssertionError("must not reach the HTTP boundary");
        }

        @Override
        public Response postJson(java.net.URI uri, String bearerToken, String jsonBody) {
            throw new AssertionError("must not reach the HTTP boundary");
        }
    }

    /** Minimal in-order response queue (the naver test package's fake is package-private). */
    private static final class QueueingNaverHttpClient implements NaverHttpClient {
        final java.util.ArrayDeque<Response> responses = new java.util.ArrayDeque<>();

        @Override
        public Response postForm(java.net.URI uri, java.util.Map<String, String> form) {
            return next();
        }

        @Override
        public Response get(java.net.URI uri, String bearerToken) {
            return next();
        }

        @Override
        public Response postJson(java.net.URI uri, String bearerToken, String jsonBody) {
            return next();
        }

        private Response next() {
            if (responses.isEmpty()) {
                throw new AssertionError("unexpected HTTP call");
            }
            return responses.pop();
        }
    }

    @Test
    void pageGuardExhaustionIsRecordedAsTruncationNotSuccess() {
        SellerAccount acc = account("GMARKET");
        // A connector that never finishes: hasMore stays true forever.
        PullConnector endless = new PullConnector() {
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
                return FetchPage.of(DataType.INQUIRY, List.of(), "0", true, "MOCK_API");
            }
        };
        ConnectorRegistry registry = new ConnectorRegistry(List.of(endless));
        IngestionService ingestion = new IngestionService(reviews, inquiries, orders, new ProductService(products));
        SyncRunExecutor endlessExecutor = new SyncRunExecutor(
                sellerAccounts, channels, registry, ingestion, syncJobs, cursors, connectionStatus);

        SyncJob job = endlessExecutor.execute(org, acc.getId(), DataType.INQUIRY, "MANUAL");

        // The guard ended the loop — that is a truncated run, never a clean SUCCESS.
        assertThat(job.getStatus()).isEqualTo("FAILED");
        assertThat(job.getErrorMessage()).contains("한도");
    }

    @Test
    void pageGuardExhaustionAfterLandedDataIsPartial() {
        SellerAccount acc = account("GMARKET");
        // First page lands 50 real reviews (mock REVIEW total is 60, so the page
        // reports hasMore=true), then the connector never finishes.
        PullConnector endlessAfterData = new PullConnector() {
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
                    return mock.fetch(request);
                }
                return FetchPage.of(DataType.REVIEW, List.of(), request.cursorValue(), true, "MOCK_API");
            }
        };
        ConnectorRegistry registry = new ConnectorRegistry(List.of(endlessAfterData));
        IngestionService ingestion = new IngestionService(reviews, inquiries, orders, new ProductService(products));
        SyncRunExecutor endlessExecutor = new SyncRunExecutor(
                sellerAccounts, channels, registry, ingestion, syncJobs, cursors, connectionStatus);

        SyncJob job = endlessExecutor.execute(org, acc.getId(), DataType.REVIEW, "MANUAL");

        // Landed pages are kept: truncation with data is PARTIAL, not FAILED.
        assertThat(job.getStatus()).isEqualTo("PARTIAL");
        assertThat(job.getErrorMessage()).contains("한도");
        assertThat(reviews.count()).isEqualTo(50);
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
