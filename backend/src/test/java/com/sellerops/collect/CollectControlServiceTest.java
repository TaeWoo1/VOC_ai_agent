package com.sellerops.collect;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.collect.dto.CapabilityView;
import com.sellerops.collect.dto.ConnectionStatusView;
import com.sellerops.collect.dto.ConnectionTestResultView;
import com.sellerops.collect.dto.CredentialIntakeRequest;
import com.sellerops.collect.dto.SchedulePutRequest;
import com.sellerops.collect.dto.ScheduleView;
import com.sellerops.collect.dto.SyncRunView;
import com.sellerops.common.ApiException;
import com.sellerops.connector.ChannelConnectionStatusRepository;
import com.sellerops.connector.ConnectionVerifier;
import com.sellerops.connector.ConnectorCapabilities;
import com.sellerops.connector.ConnectorCapability;
import com.sellerops.connector.ConnectorCapabilityRepository;
import com.sellerops.connector.ConnectorRegistry;
import com.sellerops.connector.FetchPage;
import com.sellerops.connector.FetchRequest;
import com.sellerops.connector.MockApiConnector;
import com.sellerops.connector.PullConnector;
import com.sellerops.connector.VerifyContext;
import com.sellerops.connector.VerifyOutcome;
import com.sellerops.credential.ConnectorCredentialRepository;
import com.sellerops.credential.CredentialMetadata;
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
import com.sellerops.selleraccount.AccountSessionSlotRepository;
import com.sellerops.selleraccount.AccountSessionSlotService;
import com.sellerops.selleraccount.SellerAccountRepository;
import com.sellerops.sync.SyncJob;
import com.sellerops.sync.SyncJobRepository;
import com.sellerops.sync.SyncCursorRepository;
import com.sellerops.sync.SyncSchedule;
import com.sellerops.sync.SyncScheduleRepository;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.test.context.ActiveProfiles;

/**
 * Slice 6: the operator control surface — schedule upsert rules, manual sync,
 * retry, connection status, run history, capabilities, and credential intake —
 * org-scoped, over a real (H2) DB. Controllers are thin delegates and inherit
 * auth from SecurityConfig's anyRequest().authenticated().
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class CollectControlServiceTest {

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
    @Autowired AccountSessionSlotRepository accountSlotRepo;
    @Autowired ConnectorCredentialRepository credentials;

    private MockApiConnector mock;
    private ConnectorRegistry registry;
    private SyncRunExecutor executor;
    private CollectControlService service;
    private final UUID org = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        mock = new MockApiConnector();
        registry = new ConnectorRegistry(List.of(mock));
        IngestionService ingestion = new IngestionService(reviews, inquiries, orders, new ProductService(products), communityArticles, channels, new InquiryWorkItemWriter(inquiries, workItems, audits, txManager));
        com.sellerops.order.ChannelOrderIngestionService orderIngestion =
                new com.sellerops.order.ChannelOrderIngestionService(channelOrders, channelOrderStatusEvents, txManager);
        executor = new SyncRunExecutor(
                sellerAccounts, channels, registry, ingestion, orderIngestion, syncJobs, cursors, connectionStatus);
        service = serviceWith(vaultWithKey(randomKeyBase64()));
    }

    private CollectControlService serviceWith(CredentialVault vault) {
        return new CollectControlService(sellerAccounts, channels, schedules, syncJobs,
                connectionStatus, capabilities, registry, executor, vault,
                new AccountSessionSlotService(accountSlotRepo));
    }

    private CredentialVault vaultWithKey(String masterKeyBase64) {
        return new CredentialVault(credentials, new ObjectMapper(), masterKeyBase64, "local-test-1");
    }

    private static String randomKeyBase64() {
        byte[] key = new byte[32]; // AES-256 master key
        new SecureRandom().nextBytes(key);
        return Base64.getEncoder().encodeToString(key);
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

    @Test
    void putScheduleCreatesAndListsSchedule() {
        SellerAccount acc = account("GMARKET");

        ScheduleView view = service.putSchedule(org, acc.getId(),
                new SchedulePutRequest("INQUIRY", 60, true));

        assertThat(view.dataType()).isEqualTo("INQUIRY");
        assertThat(view.cadenceKind()).isEqualTo("INTERVAL");
        assertThat(view.intervalMinutes()).isEqualTo(60);
        assertThat(view.enabled()).isTrue();
        assertThat(view.nextRunAt()).isNotNull(); // enabling makes it due now
        assertThat(service.listSchedules(org, acc.getId())).hasSize(1);
    }

    @Test
    void putScheduleUpsertsAndDisableClearsNextRun() {
        SellerAccount acc = account("GMARKET");
        service.putSchedule(org, acc.getId(), new SchedulePutRequest("INQUIRY", 60, true));

        ScheduleView disabled = service.putSchedule(org, acc.getId(),
                new SchedulePutRequest("INQUIRY", 360, false));

        assertThat(schedules.count()).isEqualTo(1); // upsert, not a second row
        assertThat(disabled.intervalMinutes()).isEqualTo(360);
        assertThat(disabled.enabled()).isFalse();
        assertThat(disabled.nextRunAt()).isNull(); // can never be claimed by mistake
    }

    @Test
    void duplicateScheduleRowIsRejectedByUniqueConstraint() {
        SellerAccount acc = account("GMARKET");
        service.putSchedule(org, acc.getId(), new SchedulePutRequest("INQUIRY", 60, true));

        // A concurrent PUT that lost the read-then-insert race must fail at the
        // DB, not silently create a second schedule for the same data type.
        SyncSchedule dup = new SyncSchedule();
        dup.setOrgId(org);
        dup.setSellerAccountId(acc.getId());
        dup.setDataType("INQUIRY");
        dup.setCadenceKind("INTERVAL");
        dup.setIntervalMinutes(60);
        assertThatThrownBy(() -> schedules.saveAndFlush(dup))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    void putScheduleRejectsUnsupportedDataTypeForChannel() {
        SellerAccount acc = account("COUPANG"); // mock: REVIEW unsupported on Coupang

        assertThatThrownBy(() -> service.putSchedule(org, acc.getId(),
                new SchedulePutRequest("REVIEW", 60, true)))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("지원되지 않습니다");
        assertThat(schedules.count()).isZero();
    }

    @Test
    void putScheduleRejectsInvalidTypeAndTooShortInterval() {
        SellerAccount acc = account("GMARKET");

        assertThatThrownBy(() -> service.putSchedule(org, acc.getId(),
                new SchedulePutRequest("NOT_A_TYPE", 60, true)))
                .isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> service.putSchedule(org, acc.getId(),
                new SchedulePutRequest("INQUIRY", 5, true)))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("15분");
    }

    @Test
    void putScheduleRejectsFileUploadChannel() {
        SellerAccount acc = account(ConnectorRegistry.FILE_CHANNEL_CODE);

        assertThatThrownBy(() -> service.putSchedule(org, acc.getId(),
                new SchedulePutRequest("INQUIRY", 60, true)))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("파일 업로드");
    }

    @Test
    void manualSyncRunsImmediatelyWithManualTrigger() {
        SellerAccount acc = account("GMARKET");

        SyncRunView run = service.manualSync(org, acc.getId(), "INQUIRY");

        assertThat(run.trigger()).isEqualTo("MANUAL");
        assertThat(run.status()).isEqualTo("SUCCESS");
        assertThat(run.successRows()).isEqualTo(45);
        assertThat(inquiries.count()).isEqualTo(45);
    }

    @Test
    void retryReexecutesFailedRunWithAdvancedAttempt() {
        SellerAccount acc = account("GMARKET");
        mock.setRateLimitAtOffset(0); // first manual run fails on throttle
        SyncRunView failed = service.manualSync(org, acc.getId(), "INQUIRY");
        assertThat(failed.status()).isEqualTo("FAILED");

        mock.setRateLimitAtOffset(null); // throttle window over
        SyncRunView retried = service.retry(org, failed.id());

        assertThat(retried.trigger()).isEqualTo("RETRY");
        assertThat(retried.attempt()).isEqualTo(2);
        assertThat(retried.status()).isEqualTo("SUCCESS");
        assertThat(inquiries.count()).isEqualTo(45);
    }

    @Test
    void retryRejectsSuccessfulAndLegacyUploadRuns() {
        SellerAccount acc = account("GMARKET");
        SyncRunView ok = service.manualSync(org, acc.getId(), "INQUIRY");
        assertThatThrownBy(() -> service.retry(org, ok.id()))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("실패 또는 부분 성공");

        // Legacy upload job: FAILED but with no seller account / data type.
        SyncJob upload = new SyncJob();
        upload.setOrgId(org);
        upload.setJobType("FILE_UPLOAD");
        upload.setStatus("FAILED");
        syncJobs.save(upload);
        assertThatThrownBy(() -> service.retry(org, upload.getId()))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("파일 업로드");
    }

    @Test
    void connectionStatusReflectsHealthAndNextSchedule() {
        SellerAccount acc = account("GMARKET");
        ConnectionStatusView before = service.connectionStatus(org, acc.getId());
        assertThat(before.state()).isEqualTo("NOT_COLLECTED");
        assertThat(before.lastSyncedAt()).isNull();
        assertThat(before.nextScheduledAt()).isNull();

        service.manualSync(org, acc.getId(), "INQUIRY");
        ScheduleView schedule = service.putSchedule(org, acc.getId(),
                new SchedulePutRequest("INQUIRY", 60, true));

        ConnectionStatusView after = service.connectionStatus(org, acc.getId());
        assertThat(after.state()).isEqualTo("CONNECTED");
        assertThat(after.lastSyncedAt()).isNotNull();
        assertThat(after.consecutiveFailures()).isZero();
        assertThat(after.nextScheduledAt()).isEqualTo(schedule.nextRunAt());
    }

    @Test
    void listRunsIsOrgScopedAndIncludesUploadRuns() {
        SellerAccount acc = account("GMARKET");
        service.manualSync(org, acc.getId(), "INQUIRY");

        SyncJob upload = new SyncJob(); // legacy upload row in the same org
        upload.setOrgId(org);
        upload.setJobType("FILE_UPLOAD");
        upload.setStatus("SUCCESS");
        syncJobs.save(upload);

        SyncJob foreign = new SyncJob(); // another org's run must not appear
        foreign.setOrgId(UUID.randomUUID());
        foreign.setJobType("MOCK_API");
        foreign.setStatus("SUCCESS");
        syncJobs.save(foreign);

        List<SyncRunView> runs = service.listRuns(org, null, null, null, null, null);

        assertThat(runs).hasSize(2);
        assertThat(runs).extracting(SyncRunView::trigger).containsExactlyInAnyOrder("MANUAL", "UPLOAD");
    }

    @Test
    void listRunsFiltersBySellerAccountId() {
        SellerAccount a1 = account("GMARKET");
        SellerAccount a2 = account("ELEVENST");
        service.manualSync(org, a1.getId(), "INQUIRY");
        service.manualSync(org, a2.getId(), "ORDER_SUMMARY");

        List<SyncRunView> filtered = service.listRuns(org, a1.getId(), null, null, null, null);

        assertThat(filtered).hasSize(1);
        assertThat(filtered.get(0).sellerAccountId()).isEqualTo(a1.getId());
        assertThat(filtered.get(0).dataType()).isEqualTo("INQUIRY");
    }

    @Test
    void listRunsFiltersByStatusTriggerAndDataType() {
        SellerAccount acc = account("GMARKET");
        mock.setRateLimitAtOffset(0);
        service.manualSync(org, acc.getId(), "INQUIRY"); // FAILED (throttled)
        mock.setRateLimitAtOffset(null);
        service.manualSync(org, acc.getId(), "INQUIRY"); // SUCCESS

        SyncJob upload = new SyncJob(); // legacy upload row, trigger=UPLOAD
        upload.setOrgId(org);
        upload.setJobType("FILE_UPLOAD");
        upload.setStatus("SUCCESS");
        syncJobs.save(upload);

        assertThat(service.listRuns(org, null, null, null, null, "FAILED")).hasSize(1);
        assertThat(service.listRuns(org, null, null, null, "UPLOAD", null)).hasSize(1);
        assertThat(service.listRuns(org, null, null, "INQUIRY", "MANUAL", "SUCCESS")).hasSize(1);
        assertThat(service.listRuns(org, null, acc.getChannelId(), null, null, null)).hasSize(2);
    }

    @Test
    void listRunsNeverReturnsOtherOrgsRunsEvenWithMatchingFilters() {
        SellerAccount acc = account("GMARKET");
        service.manualSync(org, acc.getId(), "INQUIRY");

        assertThat(service.listRuns(UUID.randomUUID(), acc.getId(), null, "INQUIRY", "MANUAL", "SUCCESS"))
                .isEmpty();
        assertThat(service.listRuns(org, acc.getId(), null, "INQUIRY", "MANUAL", "SUCCESS")).hasSize(1);
    }

    @Test
    void crossOrgAccountReadsAsAbsent() {
        SellerAccount acc = account("GMARKET");
        UUID otherOrg = UUID.randomUUID();

        assertThatThrownBy(() -> service.listSchedules(otherOrg, acc.getId())).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> service.manualSync(otherOrg, acc.getId(), "INQUIRY")).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> service.connectionStatus(otherOrg, acc.getId())).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> service.storeCredential(otherOrg, acc.getId(),
                new CredentialIntakeRequest("API", "HMAC", Map.of("k", "v"), null, null), null))
                .isInstanceOf(ApiException.class);
    }

    @Test
    void channelCapabilitiesReturnsReferenceRows() {
        ConnectorCapability cap = new ConnectorCapability();
        cap.setChannelCode("COUPANG");
        cap.setConnectorClass("API");
        cap.setDataType("REVIEW");
        cap.setSupported(false);
        cap.setVerificationStatus("UNSUPPORTED");
        cap.setNotes("공식 API는 리뷰를 제공하지 않습니다.");
        capabilities.save(cap);

        List<CapabilityView> views = service.channelCapabilities("COUPANG");

        assertThat(views).hasSize(1);
        assertThat(views.get(0).supported()).isFalse();
        assertThat(views.get(0).verificationStatus()).isEqualTo("UNSUPPORTED");
        assertThat(service.channelCapabilities("NAVER")).isEmpty();
    }

    @Test
    void storeCredentialReturnsMaskedMetadataOnly() {
        SellerAccount acc = account("GMARKET");
        UUID user = UUID.randomUUID();

        CredentialMetadata masked = service.storeCredential(org, acc.getId(),
                new CredentialIntakeRequest("API", "JWT_HS256",
                        Map.of("master_id", "M-1", "secret_key", "SK-456",
                                "issuer", "iss.example.com", "gmarket_seller_id", "G-1"),
                        null, null), user);

        assertThat(masked.sellerAccountId()).isEqualTo(acc.getId());
        assertThat(masked.toString()).doesNotContain("SK-456");
        var row = credentials.findBySellerAccountId(acc.getId()).orElseThrow();
        assertThat(row.getEncryptedPayload()).isNotEmpty();
        assertThat(row.getCreatedBy()).isEqualTo(user);
    }

    @Test
    void storeCredentialRejectsChannelWithoutApiTemplate() {
        SellerAccount acc = account(ConnectorRegistry.FILE_CHANNEL_CODE);

        assertThatThrownBy(() -> service.storeCredential(org, acc.getId(),
                new CredentialIntakeRequest("API", "API_KEY", Map.of("k", "v"), null, null), null))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("지원하지 않습니다");
        assertThat(credentials.count()).isZero();
    }

    @Test
    void storeCredentialRejectsPayloadViolatingChannelTemplate() {
        SellerAccount acc = account("GMARKET");

        // Missing GMARKET required keys (issuer, gmarket_seller_id) → rejected, nothing stored.
        assertThatThrownBy(() -> service.storeCredential(org, acc.getId(),
                new CredentialIntakeRequest("API", "JWT_HS256",
                        Map.of("master_id", "M-1", "secret_key", "SK-456"), null, null), null))
                .isInstanceOf(ApiException.class);
        assertThat(credentials.count()).isZero();
    }

    @Test
    void credentialGetReturnsMetadataWithoutAnySecretMaterial() throws Exception {
        SellerAccount acc = account("GMARKET");
        service.storeCredential(org, acc.getId(),
                new CredentialIntakeRequest("API", "JWT_HS256",
                        Map.of("master_id", "M-1", "secret_key", "SK-456",
                                "issuer", "iss.example.com", "gmarket_seller_id", "G-1"),
                        "refresh-token-789", null),
                null);

        CredentialMetadata read = service.readCredential(org, acc.getId());

        assertThat(read.sellerAccountId()).isEqualTo(acc.getId());
        assertThat(read.connectorClass()).isEqualTo("API");
        assertThat(read.authType()).isEqualTo("JWT_HS256");
        assertThat(read.encryptionKeyId()).isEqualTo("local-test-1");
        assertThat(read.hasRefreshToken()).isTrue();
        // The API-shaped rendering carries no plaintext, ciphertext, IV, or token.
        String json = new ObjectMapper().writeValueAsString(read);
        assertThat(json).doesNotContain("SK-456", "refresh-token-789",
                "\"iv\"", "\"encryptedPayload\"", "\"refreshTokenEnc\"", "\"refreshToken\"");
    }

    @Test
    void credentialGetWorksWithoutMasterKey() {
        SellerAccount acc = account("GMARKET");
        service.storeCredential(org, acc.getId(),
                new CredentialIntakeRequest("API", "JWT_HS256",
                        Map.of("master_id", "M-1", "secret_key", "SK-456",
                                "issuer", "iss.example.com", "gmarket_seller_id", "G-1"),
                        null, null), null);

        // Metadata reads never decrypt — a keyless deployment can still show status.
        CollectControlService keyless = serviceWith(vaultWithKey(""));
        CredentialMetadata read = keyless.readCredential(org, acc.getId());

        assertThat(read.authType()).isEqualTo("JWT_HS256");
        assertThat(read.hasRefreshToken()).isFalse();
    }

    @Test
    void credentialGetCrossOrgReadsAsAbsent() {
        SellerAccount acc = account("GMARKET");
        service.storeCredential(org, acc.getId(),
                new CredentialIntakeRequest("API", "JWT_HS256",
                        Map.of("master_id", "M-1", "secret_key", "SK-456",
                                "issuer", "iss.example.com", "gmarket_seller_id", "G-1"),
                        null, null), null);

        assertThatThrownBy(() -> service.readCredential(UUID.randomUUID(), acc.getId()))
                .isInstanceOf(ApiException.class);
    }

    // --- test-connection (auth/connectivity only, no collection) ---

    @Test
    void testConnectionCrossOrgReadsAsAbsent() {
        SellerAccount acc = account("COUPANG");

        // Org scoping is enforced before any vault/connector touch.
        assertThatThrownBy(() -> service.testConnection(UUID.randomUUID(), acc.getId()))
                .isInstanceOf(ApiException.class);
    }

    @Test
    void testConnectionUnsupportedForFileUploadChannel() {
        SellerAccount acc = account(ConnectorRegistry.FILE_CHANNEL_CODE);

        ConnectionTestResultView result = service.testConnection(org, acc.getId());

        assertThat(result.status()).isEqualTo("UNSUPPORTED");
        assertThat(result.reasonCode()).isEqualTo("UNSUPPORTED_CHANNEL");
        assertThat(result.checkedAt()).isNotNull();
        assertThat(syncJobs.count()).isZero();
    }

    @Test
    void testConnectionUnsupportedForFileUploadAccount() {
        SellerAccount acc = account("COUPANG");
        acc.setFileUpload(true);
        sellerAccounts.save(acc);

        ConnectionTestResultView result = service.testConnection(org, acc.getId());

        assertThat(result.status()).isEqualTo("UNSUPPORTED");
        assertThat(result.reasonCode()).isEqualTo("UNSUPPORTED_CHANNEL");
    }

    @Test
    void testConnectionNotConfiguredWhenNoCredentialAndOpensNoVault() {
        SellerAccount acc = account("COUPANG"); // API channel, no credential stored

        // A keyless vault proves NOT_CONFIGURED short-circuits before any decrypt:
        // hasCredential needs no master key, and no provider call is made.
        CollectControlService keyless = serviceWith(vaultWithKey(""));
        ConnectionTestResultView result = keyless.testConnection(org, acc.getId());

        assertThat(result.status()).isEqualTo("NOT_CONFIGURED");
        assertThat(result.reasonCode()).isEqualTo("NOT_CONFIGURED");
        assertThat(result.message()).isEqualTo("저장된 연결 정보가 없습니다.");
        assertThat(syncJobs.count()).isZero();
    }

    @Test
    void testConnectionUnsupportedWhenConnectorHasNoVerifier() {
        SellerAccount acc = account("COUPANG");
        service.storeCredential(org, acc.getId(),
                new CredentialIntakeRequest("API", "HMAC",
                        Map.of("access_key", "AK", "secret_key", "SK", "vendor_id", "V1"), null, null),
                null);

        // Connectors OFF → the generic mock resolves; it is not a ConnectionVerifier,
        // so it can never report a verified success — the path is UNSUPPORTED.
        ConnectionTestResultView result = service.testConnection(org, acc.getId());

        assertThat(result.status()).isEqualTo("UNSUPPORTED");
        assertThat(result.reasonCode()).isEqualTo("VERIFY_NOT_IMPLEMENTED");
        assertThat(result.message()).isEqualTo("이 채널의 연결 확인은 아직 제공되지 않습니다.");
        assertThat(syncJobs.count()).isZero();
    }

    @Test
    void testConnectionVerifierSuccessMapsToSafeResult() {
        CredentialVault vault = vaultWithKey(randomKeyBase64());
        SellerAccount acc = account("COUPANG");
        serviceWith(vault).storeCredential(org, acc.getId(),
                new CredentialIntakeRequest("API", "HMAC",
                        Map.of("access_key", "AK", "secret_key", "SK", "vendor_id", "V1"), null, null),
                null);
        CollectControlService svc = serviceWith(
                new ConnectorRegistry(List.of(
                        new FakeVerifyingConnector("COUPANG", VerifyOutcome.success()))),
                vault);

        ConnectionTestResultView result = svc.testConnection(org, acc.getId());

        assertThat(result.status()).isEqualTo("SUCCESS");
        assertThat(result.reasonCode()).isNull();
        assertThat(result.message()).isEqualTo("연결 정보가 확인되었습니다.");
        assertThat(result.checkedAt()).isNotNull();
        assertThat(syncJobs.count()).isZero();
    }

    @Test
    void testConnectionVerifierFailureMapsToFixedSafeMessage() {
        CredentialVault vault = vaultWithKey(randomKeyBase64());
        SellerAccount acc = account("COUPANG");
        serviceWith(vault).storeCredential(org, acc.getId(),
                new CredentialIntakeRequest("API", "HMAC",
                        Map.of("access_key", "AK", "secret_key", "SK", "vendor_id", "V1"), null, null),
                null);
        CollectControlService svc = serviceWith(
                new ConnectorRegistry(List.of(new FakeVerifyingConnector("COUPANG",
                        VerifyOutcome.failed(VerifyOutcome.REASON_INVALID_CREDENTIAL)))),
                vault);

        ConnectionTestResultView result = svc.testConnection(org, acc.getId());

        assertThat(result.status()).isEqualTo("FAILED");
        assertThat(result.reasonCode()).isEqualTo("INVALID_CREDENTIAL");
        // Fixed operator-safe message — never a raw provider string, never a secret.
        assertThat(result.message()).isEqualTo("연결 정보가 유효하지 않습니다.");
        assertThat(result.message()).doesNotContain("SK", "AK", "V1");
        assertThat(syncJobs.count()).isZero();
    }

    private CollectControlService serviceWith(ConnectorRegistry reg, CredentialVault vault) {
        return new CollectControlService(sellerAccounts, channels, schedules, syncJobs,
                connectionStatus, capabilities, reg, executor, vault,
                new AccountSessionSlotService(accountSlotRepo));
    }

    /**
     * Test-only connector that opts into {@link ConnectionVerifier} for one channel
     * and returns a canned outcome with zero network — proves the verify seam maps
     * to a safe result without shipping a real verifier or touching a provider.
     */
    private static final class FakeVerifyingConnector implements PullConnector, ConnectionVerifier {
        private final String channelCode;
        private final VerifyOutcome outcome;

        FakeVerifyingConnector(String channelCode, VerifyOutcome outcome) {
            this.channelCode = channelCode;
            this.outcome = outcome;
        }

        @Override
        public String kind() {
            return "FAKE_VERIFY";
        }

        @Override
        public Set<String> dedicatedChannels() {
            return Set.of(channelCode);
        }

        @Override
        public ConnectorCapabilities capabilities(String code) {
            return new ConnectorCapabilities("API", Set.of(), Map.of(), "");
        }

        @Override
        public FetchPage fetch(FetchRequest request) {
            throw new UnsupportedOperationException("test-connection must never collect");
        }

        @Override
        public VerifyOutcome verifyConnection(VerifyContext context) {
            return outcome;
        }
    }
}
