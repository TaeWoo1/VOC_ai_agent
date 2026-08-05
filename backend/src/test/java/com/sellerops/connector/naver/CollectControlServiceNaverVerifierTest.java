package com.sellerops.connector.naver;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.collect.CollectControlService;
import com.sellerops.collect.SyncRunExecutor;
import com.sellerops.collect.dto.ConnectionTestResultView;
import com.sellerops.connector.ChannelConnectionStatusRepository;
import com.sellerops.connector.ConnectorCapabilityRepository;
import com.sellerops.connector.ConnectorRegistry;
import com.sellerops.connector.naver.onboarding.NaverConnectionLifecycle;
import com.sellerops.credential.ConnectorCredentialRepository;
import com.sellerops.credential.CredentialVault;
import com.sellerops.ingest.IngestionService;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItemAuditRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItemRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItemWriter;
import org.springframework.transaction.PlatformTransactionManager;
import com.sellerops.order.OrderDailySummaryRepository;
import com.sellerops.community.Cafe24CommunityArticleRepository;
import com.sellerops.product.ProductRepository;
import com.sellerops.product.ProductService;
import com.sellerops.review.ReviewRepository;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import com.sellerops.sync.SyncCursorRepository;
import com.sellerops.sync.SyncJobRepository;
import com.sellerops.sync.SyncScheduleRepository;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.security.crypto.bcrypt.BCrypt;
import org.springframework.test.context.ActiveProfiles;

/**
 * Service-level proof that a real {@link NaverApiConnector} (not a fake verifier)
 * plugs into {@link CollectControlService#testConnection} and returns a safe
 * SUCCESS via a token mint plus a single read-only order-access probe — no order
 * ingestion, no sync job, no persisted cursor, and zero real network (the fake
 * HTTP boundary serves the token and the probe's last-changed page). Lives in the
 * naver test package to reuse {@link FakeNaverHttpClient} without widening its
 * visibility, keeping the generic CollectControlServiceTest clean.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class CollectControlServiceNaverVerifierTest {

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
    @Autowired com.sellerops.order.ChannelOrderRepository channelOrders;
    @Autowired com.sellerops.order.ChannelOrderStatusEventRepository channelOrderStatusEvents;
    @Autowired SyncJobRepository syncJobs;
    @Autowired SyncCursorRepository cursors;
    @Autowired ChannelConnectionStatusRepository connectionStatus;
    @Autowired SyncScheduleRepository schedules;
    @Autowired ConnectorCapabilityRepository capabilities;
    @Autowired ConnectorCredentialRepository credentials;
    @Autowired com.sellerops.selleraccount.AccountSessionSlotRepository accountSlotRepo;

    private final UUID org = UUID.randomUUID();
    private final String clientSecret = BCrypt.gensalt(); // Naver secrets are bcrypt salts
    private final FakeNaverHttpClient http = new FakeNaverHttpClient();
    private final Clock clock = Clock.fixed(Instant.parse("2026-06-12T00:00:00Z"), ZoneOffset.UTC);

    private CredentialVault vault;
    private CollectControlService service;

    @BeforeEach
    void setUp() {
        vault = new CredentialVault(credentials, new ObjectMapper(), randomKeyBase64(), "local-test-1");
        NaverApiConnector naver = new NaverApiConnector(
                new NaverTokenClient(http, clock, "https://fake.naver.test"),
                new NaverOrdersClient(http, clock, "https://fake.naver.test", 100),
                vault);
        ConnectorRegistry registry = new ConnectorRegistry(List.of(naver));
        IngestionService ingestion =
                new IngestionService(reviews, inquiries, orders, new ProductService(products), communityArticles, channels, new InquiryWorkItemWriter(inquiries, workItems, audits, txManager));
        com.sellerops.order.ChannelOrderIngestionService orderIngestion =
                new com.sellerops.order.ChannelOrderIngestionService(channelOrders, channelOrderStatusEvents, txManager);
        SyncRunExecutor executor = new SyncRunExecutor(
                sellerAccounts, channels, registry, ingestion, orderIngestion, syncJobs, cursors, connectionStatus);
        NaverConnectionLifecycle naverLifecycle = new NaverConnectionLifecycle(
                sellerAccounts, channels, txManager);
        service = new CollectControlService(sellerAccounts, channels, schedules, syncJobs,
                connectionStatus, capabilities, registry, executor, vault,
                new com.sellerops.selleraccount.AccountSessionSlotService(accountSlotRepo),
                naverLifecycle,
                new com.sellerops.connector.coupang.onboarding.CoupangConnectionLifecycle(
                        sellerAccounts, channels, txManager));
    }

    @Test
    void testConnectionSucceedsViaRealNaverVerifierWithoutCollecting() {
        SellerAccount acc = naverAccount();
        // A canary token + secret: neither may appear in the result DTO.
        vault.store(org, acc.getId(), "API", "OAUTH2",
                Map.of("client_id", "test-client-id", "client_secret", clientSecret), null, null, null);
        http.enqueue(FakeNaverHttpClient.tokenOk("naver-access-token-CANARY", 3000));
        http.enqueue(FakeNaverHttpClient.tokenOk("naver-probe-token-CANARY", 3000));
        http.enqueue(FakeNaverHttpClient.ok("{\"data\":{\"lastChangeStatuses\":[]}}"));

        ConnectionTestResultView result = service.testConnection(org, acc.getId());

        assertThat(result.status()).isEqualTo("SUCCESS");
        assertThat(result.reasonCode()).isNull();
        assertThat(result.message()).isEqualTo("연결 정보가 확인되었습니다.");
        assertThat(result.checkedAt()).isNotNull();

        // Token proof + a single read-only order-access GET — never a detail POST.
        assertThat(http.sent).hasSize(3);
        assertThat(http.sent.get(0).method()).isEqualTo("POST_FORM");
        assertThat(http.sent.get(2).method()).isEqualTo("GET");

        // No sync job, no ingestion / data persistence.
        assertThat(syncJobs.count()).isZero();
        assertThat(reviews.count()).isZero();
        assertThat(inquiries.count()).isZero();
        assertThat(orders.count()).isZero();

        // The response carries no token, no secret, no provider body. Only the
        // String fields could carry one (sellerAccountId is a UUID, checkedAt an
        // Instant); assert the canary token and the secret appear in none of them.
        String surfaced = result.status() + "|" + result.message() + "|" + result.reasonCode();
        assertThat(surfaced).doesNotContain("naver-access-token-CANARY", clientSecret,
                "access_token", "client_secret");
    }

    @Test
    void testConnectionOnPendingAccountRecordsPreparing_notYetConnected() {
        // A fresh (PENDING) account: a verified test records the credential test success as PREPARING,
        // but CONNECTED is withheld until the first order sync — test alone never connects.
        SellerAccount acc = naverAccount(ChannelStatus.PENDING);
        vault.store(org, acc.getId(), "API", "OAUTH2",
                Map.of("client_id", "test-client-id", "client_secret", clientSecret), null, null, null);
        http.enqueue(FakeNaverHttpClient.tokenOk("naver-access-token", 3000));
        http.enqueue(FakeNaverHttpClient.tokenOk("naver-probe-token", 3000));
        http.enqueue(FakeNaverHttpClient.ok("{\"data\":{\"lastChangeStatuses\":[]}}"));

        ConnectionTestResultView result = service.testConnection(org, acc.getId());

        assertThat(result.status()).isEqualTo("SUCCESS");
        assertThat(sellerAccounts.findById(acc.getId()).orElseThrow().getConnectionStatus())
                .isEqualTo(ChannelStatus.PREPARING);
        assertThat(syncJobs.count()).isZero();
    }

    @Test
    void testConnectionWithInvalidCredentialRecallsForReconnect() {
        SellerAccount acc = naverAccount(ChannelStatus.PENDING);
        vault.store(org, acc.getId(), "API", "OAUTH2",
                Map.of("client_id", "test-client-id", "client_secret", clientSecret), null, null, null);
        // A 401 → the token endpoint rejected the credential (an authentication failure).
        http.enqueue(new NaverHttpClient.Response(401, "{\"code\":\"UNAUTHORIZED\"}", Map.of()));

        ConnectionTestResultView result = service.testConnection(org, acc.getId());

        assertThat(result.status()).isEqualTo("FAILED");
        assertThat(result.reasonCode()).isEqualTo("INVALID_CREDENTIAL");
        assertThat(sellerAccounts.findById(acc.getId()).orElseThrow().getConnectionStatus())
                .isEqualTo(ChannelStatus.RECONNECT_REQUIRED);
    }

    @Test
    void testConnectionWithValidCredentialButDeniedOrderAccessDoesNotRecallForReconnect() {
        // The credential is valid (token accepted) but the order endpoint refuses (403).
        // This is NOT a credential failure: the account must NOT be recalled to
        // RECONNECT_REQUIRED, and the operator gets an actionable order-access reason
        // instead of the old INVALID_CREDENTIAL misdiagnosis or a silent PREPARING.
        SellerAccount acc = naverAccount(ChannelStatus.PENDING);
        vault.store(org, acc.getId(), "API", "OAUTH2",
                Map.of("client_id", "test-client-id", "client_secret", clientSecret), null, null, null);
        http.enqueue(FakeNaverHttpClient.tokenOk("naver-access-token", 3000));
        http.enqueue(FakeNaverHttpClient.tokenOk("naver-probe-token", 3000));
        http.enqueue(new NaverHttpClient.Response(403,
                "{\"code\":\"GW.FORBIDDEN\",\"message\":\"권한이 없습니다\"}", Map.of()));

        ConnectionTestResultView result = service.testConnection(org, acc.getId());

        assertThat(result.status()).isEqualTo("FAILED");
        assertThat(result.reasonCode()).isEqualTo("ORDER_ACCESS_DENIED");
        assertThat(result.message()).contains("주문 API");
        // Credential is fine → status must not move to RECONNECT_REQUIRED (nor PREPARING).
        assertThat(sellerAccounts.findById(acc.getId()).orElseThrow().getConnectionStatus())
                .isEqualTo(ChannelStatus.PENDING);
    }

    @Test
    void testConnectionWithTransientProviderErrorLeavesStatusUnchanged() {
        SellerAccount acc = naverAccount(ChannelStatus.PENDING);
        vault.store(org, acc.getId(), "API", "OAUTH2",
                Map.of("client_id", "test-client-id", "client_secret", clientSecret), null, null, null);
        // A network failure → provider-unavailable (transient), never a credential verdict.
        http.enqueueNetworkFailure();

        ConnectionTestResultView result = service.testConnection(org, acc.getId());

        assertThat(result.status()).isEqualTo("FAILED");
        // A transient failure must not move the connection status.
        assertThat(sellerAccounts.findById(acc.getId()).orElseThrow().getConnectionStatus())
                .isEqualTo(ChannelStatus.PENDING);
    }

    private SellerAccount naverAccount() {
        return naverAccount(ChannelStatus.CONNECTED);
    }

    private SellerAccount naverAccount(ChannelStatus status) {
        Channel ch = channels.findByCode("NAVER").orElseGet(() -> {
            Channel c = new Channel();
            c.setCode("NAVER");
            c.setNameKo("네이버");
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
        acc.setConnectionStatus(status);
        acc.setFileUpload(false);
        return sellerAccounts.save(acc);
    }

    private static String randomKeyBase64() {
        byte[] key = new byte[32]; // AES-256 master key
        new SecureRandom().nextBytes(key);
        return Base64.getEncoder().encodeToString(key);
    }
}
