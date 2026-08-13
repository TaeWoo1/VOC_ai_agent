package com.sellerops.collect;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.collect.dto.AgentCredentialHandoffRequest;
import com.sellerops.collect.dto.AgentCredentialHandoffResultView;
import com.sellerops.collect.dto.ConnectionTestResultView;
import com.sellerops.collect.dto.CredentialIntakeRequest;
import com.sellerops.common.ApiException;
import com.sellerops.connector.ChannelConnectionStatusRepository;
import com.sellerops.connector.ConnectorCapabilityRepository;
import com.sellerops.connector.ConnectorRegistry;
import com.sellerops.connector.MockApiConnector;
import com.sellerops.connector.naver.onboarding.NaverConnectionLifecycle;
import com.sellerops.credential.ConnectorCredentialRepository;
import com.sellerops.credential.CredentialVault;
import com.sellerops.credential.DecryptedCredential;
import com.sellerops.ingest.IngestionService;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItemAuditRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItemRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItemWriter;
import com.sellerops.order.OrderDailySummaryRepository;
import com.sellerops.community.Cafe24CommunityArticleRepository;
import com.sellerops.product.ProductRepository;
import com.sellerops.product.ProductService;
import com.sellerops.review.ReviewRepository;
import com.sellerops.selleraccount.AccountSessionSlotRepository;
import com.sellerops.selleraccount.AccountSessionSlotService;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import com.sellerops.sync.SyncCursorRepository;
import com.sellerops.sync.SyncJobRepository;
import com.sellerops.sync.SyncScheduleRepository;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.PlatformTransactionManager;

/**
 * The agent credential handoff — the binding, and only the binding.
 *
 * What is under test is the fail-closed order (slot → org → account → channel guard → template → no existing
 * credential → store → verify) and the fact that everything past the binding is the SAME code path the operator's
 * own form already uses. The vault, the validator, and the connector verification have their own tests; nothing
 * here re-proves them, and nothing here may quietly reimplement them.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class AgentCredentialHandoffServiceTest {

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
    @Autowired AccountSessionSlotRepository slotRepo;
    @Autowired ConnectorCredentialRepository credentials;
    @Autowired com.sellerops.connector.ConnectorAlertRepository alerts;

    private static final String ACCESS = "8f2c1ab4d5e6f70819a2b3c4d5e6f708";
    private static final String SECRET = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4";
    private static final String VENDOR = "A00099999";

    private CredentialVault vault;
    private AccountSessionSlotService slots;
    private AgentCredentialHandoffService service;
    private final UUID org = UUID.randomUUID();
    private final UUID actor = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        byte[] key = new byte[32];
        new SecureRandom().nextBytes(key);
        vault = new CredentialVault(credentials, new ObjectMapper(), Base64.getEncoder().encodeToString(key), "local-test-1");
        slots = new AccountSessionSlotService(slotRepo);

        ConnectorRegistry registry = new ConnectorRegistry(List.of(new MockApiConnector()));
        IngestionService ingestion = new IngestionService(reviews, inquiries, orders, new ProductService(products),
                communityArticles, channels, new InquiryWorkItemWriter(inquiries, workItems, audits, txManager));
        com.sellerops.order.ChannelOrderIngestionService orderIngestion =
                new com.sellerops.order.ChannelOrderIngestionService(channelOrders, channelOrderStatusEvents, txManager);
        SyncRunExecutor executor = new SyncRunExecutor(
                sellerAccounts, channels, registry, ingestion, orderIngestion, syncJobs, cursors, connectionStatus);
        CollectControlService collect = new CollectControlService(sellerAccounts, channels, schedules, syncJobs,
                connectionStatus, capabilities, registry, executor, vault, slots,
                new NaverConnectionLifecycle(sellerAccounts, channels, txManager),
                new com.sellerops.connector.coupang.onboarding.CoupangConnectionLifecycle(
                        sellerAccounts, channels, txManager),
                new com.sellerops.connector.ConnectorAlertService(alerts, sellerAccounts, channels));
        service = new AgentCredentialHandoffService(slotRepo, sellerAccounts, channels, vault, collect);
    }

    /**
     * A control service whose connection test throws — the shape `CoupangLiveCallGuard` produces on an unarmed
     * backend. Subclassed rather than mocked because the point is that the REAL store ran first.
     */
    private CollectControlService collectThatFailsVerification() {
        return new CollectControlService(sellerAccounts, channels, schedules, syncJobs,
                connectionStatus, capabilities, new ConnectorRegistry(List.of(new MockApiConnector())),
                new SyncRunExecutor(sellerAccounts, channels, new ConnectorRegistry(List.of(new MockApiConnector())),
                        new IngestionService(reviews, inquiries, orders, new ProductService(products),
                                communityArticles, channels,
                                new InquiryWorkItemWriter(inquiries, workItems, audits, txManager)),
                        new com.sellerops.order.ChannelOrderIngestionService(channelOrders, channelOrderStatusEvents, txManager),
                        syncJobs, cursors, connectionStatus),
                vault, slots,
                new NaverConnectionLifecycle(sellerAccounts, channels, txManager),
                new com.sellerops.connector.coupang.onboarding.CoupangConnectionLifecycle(
                        sellerAccounts, channels, txManager),
                new com.sellerops.connector.ConnectorAlertService(alerts, sellerAccounts, channels)) {
            @Override
            public ConnectionTestResultView testConnection(UUID orgId, UUID sellerAccountId) {
                throw new IllegalStateException("쿠팡 라이브 API 호출이 승인 없이 시도되었습니다.");
            }
        };
    }

    private SellerAccount account(UUID ownerOrg, String channelCode) {
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
        acc.setOrgId(ownerOrg);
        acc.setChannelId(ch.getId());
        acc.setConnectionStatus(ChannelStatus.PENDING);
        acc.setFileUpload(false);
        return sellerAccounts.save(acc);
    }

    private String slotFor(SellerAccount acc) {
        return slots.resolveSlot(acc.getOrgId(), acc.getId(), acc.getChannelId());
    }

    private static AgentCredentialHandoffRequest coupangRequest(String slot) {
        return new AgentCredentialHandoffRequest(slot, "COUPANG",
                Map.of("access_key", ACCESS, "secret_key", SECRET, "vendor_id", VENDOR));
    }

    @Test
    void storesTheHandedOffSecretsThroughTheExistingVaultAndRunsTheConnectionCheck() {
        SellerAccount acc = account(org, "COUPANG");

        AgentCredentialHandoffResultView result = service.handOff(org, actor, coupangRequest(slotFor(acc)));

        assertThat(result.stored()).isTrue();
        // The mock connector is not a ConnectionVerifier, so the check resolves UNSUPPORTED rather than a
        // fabricated success — which is the honest answer, and the one the agent must be able to see.
        assertThat(result.connectionStatus()).isEqualTo("UNSUPPORTED");
        // Stored for real, and readable only through the run-time open.
        DecryptedCredential stored = vault.open(org, acc.getId());
        assertThat(stored.secrets()).containsExactlyInAnyOrderEntriesOf(
                Map.of("access_key", ACCESS, "secret_key", SECRET, "vendor_id", VENDOR));
        // Never an estimate: no expiry was measured, so none is stored.
        assertThat(stored.tokenExpiresAt()).isNull();
        // Server-derived, never client-claimed.
        assertThat(stored.connectorClass()).isEqualTo("API");
        assertThat(stored.authType()).isEqualTo("HMAC");
    }

    @Test
    void anUnknownSlotIsNotFound() {
        assertThatThrownBy(() -> service.handOff(org, actor, coupangRequest("0123456789abcdef01234567")))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("UNKNOWN_ACCOUNT_SLOT");
    }

    @Test
    void aSlotFromAnotherOrgReadsExactlyLikeAnAbsentOne() {
        SellerAccount foreign = account(UUID.randomUUID(), "COUPANG");
        String slot = slotFor(foreign);

        // Same exception, same message: the endpoint cannot be used to learn whether a slot is real.
        assertThatThrownBy(() -> service.handOff(org, actor, coupangRequest(slot)))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("UNKNOWN_ACCOUNT_SLOT");
        assertThat(vault.hasCredential(foreign.getOrgId(), foreign.getId())).isFalse();
    }

    @Test
    void aDeclaredChannelThatDisagreesWithTheAccountIsRefusedBeforeTheVaultIsTouched() {
        SellerAccount naver = account(org, "NAVER");

        assertThatThrownBy(() -> service.handOff(org, actor, coupangRequest(slotFor(naver))))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("CHANNEL_MISMATCH");
        assertThat(vault.hasCredential(org, naver.getId())).isFalse();
    }

    @Test
    void aFileUploadAccountHasNoApiConnectionToStore() {
        SellerAccount acc = account(org, "COUPANG");
        acc.setFileUpload(true);
        sellerAccounts.save(acc);

        assertThatThrownBy(() -> service.handOff(org, actor, coupangRequest(slotFor(acc))))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("UNSUPPORTED_CHANNEL");
        assertThat(vault.hasCredential(org, acc.getId())).isFalse();
    }

    @Test
    void itNeverOverwritesAnExistingCredential() {
        SellerAccount acc = account(org, "COUPANG");
        // The seller already has a working credential, entered by hand or by an earlier handoff.
        vault.store(org, acc.getId(), "API", "HMAC",
                Map.of("access_key", "old-access", "secret_key", "old-secret", "vendor_id", "A00000001"),
                null, null, actor);

        assertThatThrownBy(() -> service.handOff(org, actor, coupangRequest(slotFor(acc))))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("CREDENTIAL_ALREADY_STORED");
        // Replacing a working credential is a different operation with rollback (`/credentials/replace`). The
        // handoff must not be the one path that can destroy one with no way back.
        assertThat(vault.open(org, acc.getId()).secrets()).containsEntry("access_key", "old-access");
    }

    @Test
    void anUnknownSecretKeyIsRejectedByTheEXISTINGValidator() {
        SellerAccount acc = account(org, "COUPANG");
        AgentCredentialHandoffRequest bad = new AgentCredentialHandoffRequest(slotFor(acc), "COUPANG",
                Map.of("access_key", ACCESS, "secret_key", SECRET, "vendor_id", VENDOR, "smuggled", "x"));

        assertThatThrownBy(() -> service.handOff(org, actor, bad)).isInstanceOf(ApiException.class);
        assertThat(vault.hasCredential(org, acc.getId())).isFalse();
    }

    @Test
    void aMissingRequiredFieldIsRejectedAndNothingIsStored() {
        SellerAccount acc = account(org, "COUPANG");
        AgentCredentialHandoffRequest partial = new AgentCredentialHandoffRequest(slotFor(acc), "COUPANG",
                Map.of("access_key", ACCESS, "secret_key", SECRET));

        assertThatThrownBy(() -> service.handOff(org, actor, partial)).isInstanceOf(ApiException.class);
        assertThat(vault.hasCredential(org, acc.getId())).isFalse();
    }

    @Test
    void aVerificationThatTHROWSStillReportsTheCredentialAsStored() {
        // The store commits on its own; the verification that follows can throw for reasons that have nothing to
        // do with the credential (CoupangLiveCallGuard refusing an unarmed backend, a provider fault, transport).
        // Letting that propagate made the agent print STORE_FAILED — "nothing is stored" — which is the opposite
        // of the truth in the ONE state the operator cannot retry out of: the read is one-shot and a second
        // handoff is refused with CREDENTIAL_ALREADY_STORED.
        SellerAccount acc = account(org, "COUPANG");
        AgentCredentialHandoffService throwing = new AgentCredentialHandoffService(
                slotRepo, sellerAccounts, channels, vault, collectThatFailsVerification());

        AgentCredentialHandoffResultView result = throwing.handOff(org, actor, coupangRequest(slotFor(acc)));

        assertThat(result.stored()).isTrue();
        assertThat(result.connectionStatus()).isEqualTo("UNVERIFIED");
        assertThat(result.connectionReason()).isEqualTo("VERIFY_ERROR");
        // And the credential really is there — the report matches reality in both directions.
        assertThat(vault.hasCredential(org, acc.getId())).isTrue();
    }

    @Test
    void theRequestObjectCannotPutASecretInALogLine() {
        // A request DTO reaches a log or a stack trace far more easily than a vault does.
        String rendered = coupangRequest("0123456789abcdef01234567").toString();
        assertThat(rendered).doesNotContain(ACCESS).doesNotContain(SECRET).doesNotContain(VENDOR);
        assertThat(rendered).contains("masked");
        // …and the intake DTO it is folded into has the same property.
        assertThat(new CredentialIntakeRequest("API", "HMAC", Map.of("access_key", ACCESS), null, null).toString())
                .doesNotContain(ACCESS);
    }

    @Test
    void theResultViewCarriesNoValueOnAnyPath() {
        SellerAccount acc = account(org, "COUPANG");
        AgentCredentialHandoffResultView result = service.handOff(org, actor, coupangRequest(slotFor(acc)));
        String rendered = result.toString();
        assertThat(rendered).doesNotContain(ACCESS).doesNotContain(SECRET).doesNotContain(VENDOR);
        // …and it does not leak the seller-account id the opaque slot stood in for, either.
        assertThat(rendered).doesNotContain(acc.getId().toString());
    }
}
