package com.sellerops.connector.coupang;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.collect.CollectControlService;
import com.sellerops.collect.dto.CredentialIntakeRequest;
import com.sellerops.collect.dto.CredentialReplaceResultView;
import com.sellerops.connector.ConnectionVerifier;
import com.sellerops.connector.ConnectorCapabilities;
import com.sellerops.connector.ConnectorRegistry;
import com.sellerops.connector.DataType;
import com.sellerops.connector.FetchPage;
import com.sellerops.connector.FetchRequest;
import com.sellerops.connector.PullConnector;
import com.sellerops.connector.UnsupportedScope;
import com.sellerops.connector.VerifyContext;
import com.sellerops.connector.VerifyOutcome;
import com.sellerops.credential.ConnectorCredentialRepository;
import com.sellerops.credential.CredentialVault;
import com.sellerops.credential.DecryptedCredential;
import com.sellerops.order.ChannelOrder;
import com.sellerops.order.ChannelOrderRepository;
import com.sellerops.order.NormalizedOrderStatus;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import com.sellerops.sync.SyncCursor;
import com.sellerops.sync.SyncCursorRepository;
import com.sellerops.sync.SyncSchedule;
import com.sellerops.sync.SyncScheduleRepository;
import java.security.SecureRandom;
import java.time.Instant;
import java.time.LocalDate;
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
import org.springframework.test.context.ActiveProfiles;

/**
 * Atomic guided-renewal credential replacement with rollback — the key no-dup / no-loss proofs.
 * A stub {@link ConnectionVerifier} stands in for the real Coupang connect/order probe so the test
 * is fully offline; what it proves is the replacement mechanism itself:
 * <ul>
 *   <li>SUCCESS → the NEW secrets + new expiry are stored; the account row, collected orders, and
 *       sync cursors are untouched; a paused schedule resumes and an operator-disabled one stays off.</li>
 *   <li>FAILURE → the captured OLD credential (secrets + its expiry) is restored (rollback); the new
 *       secrets are discarded; account / orders / cursors are untouched.</li>
 * </ul>
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class CoupangCredentialReplaceTest {

    @Autowired SellerAccountRepository sellerAccounts;
    @Autowired ChannelRepository channels;
    @Autowired SyncScheduleRepository schedules;
    @Autowired ConnectorCredentialRepository credentials;
    @Autowired ChannelOrderRepository channelOrders;
    @Autowired SyncCursorRepository cursors;

    private final UUID org = UUID.randomUUID();
    private final UUID actor = UUID.randomUUID();
    private final Instant oldExpiry = Instant.parse("2026-09-01T00:00:00Z");
    private final Instant newExpiry = Instant.parse("2027-03-01T00:00:00Z");

    private CredentialVault vault;
    private StubCoupangVerifier verifier;
    private CollectControlService service;

    @BeforeEach
    void setUp() {
        vault = new CredentialVault(credentials, new ObjectMapper(), randomKeyBase64(), "local-test-1");
        verifier = new StubCoupangVerifier();
        ConnectorRegistry registry = new ConnectorRegistry(List.of(verifier));
        // replaceCredential touches sellerAccounts / channels / schedules / vault / registry only.
        service = new CollectControlService(sellerAccounts, channels, schedules, null,
                null, null, registry, null, vault, null, null, null, null);
    }

    @Test
    void successStoresNewCredentialKeepsOrdersCursorsAndResumesPausedSchedule() {
        SellerAccount acc = coupangAccount();
        storeOld(acc);
        seedOrder(acc);
        seedCursor(acc);
        SyncSchedule paused = seedSchedule(acc, "ORDER_SUMMARY", false, "CREDENTIAL_EXPIRED");
        SyncSchedule operatorOff = seedSchedule(acc, "REVIEW", false, null);

        verifier.outcome = VerifyOutcome.success();
        CredentialReplaceResultView result = service.replaceCredential(org, acc.getId(), newRequest(), actor);

        assertThat(result.status()).isEqualTo("SUCCESS");
        assertThat(result.reasonCode()).isNull();
        assertThat(result.tokenExpiresAt()).isEqualTo(newExpiry);

        // NEW credential is on file (secrets + new expiry).
        DecryptedCredential stored = vault.open(org, acc.getId());
        assertThat(stored.secrets().get("access_key")).isEqualTo("AK-NEW");
        assertThat(stored.tokenExpiresAt()).isEqualTo(newExpiry);

        // Orders + cursors untouched (no dup, no loss).
        assertThat(channelOrders.count()).isEqualTo(1);
        assertThat(channelOrders.findAll().get(0).getExternalOrderId()).isEqualTo("ORDER-1");
        assertThat(cursors.count()).isEqualTo(1);
        assertThat(cursors.findAll().get(0).getCursorValue()).isEqualTo("cursor-abc");

        // Account row untouched (only the credential row changed).
        assertThat(sellerAccounts.findById(acc.getId()).orElseThrow().getConnectionStatus())
                .isEqualTo(ChannelStatus.CONNECTED);

        // Paused schedule resumed; operator-disabled one left off.
        assertThat(schedules.findById(paused.getId()).orElseThrow().isEnabled()).isTrue();
        assertThat(schedules.findById(paused.getId()).orElseThrow().getPausedReason()).isNull();
        assertThat(schedules.findById(operatorOff.getId()).orElseThrow().isEnabled()).isFalse();
    }

    @Test
    void failureRestoresOldCredentialAndDiscardsNew_ordersCursorsUntouched() {
        SellerAccount acc = coupangAccount();
        storeOld(acc);
        seedOrder(acc);
        seedCursor(acc);
        SyncSchedule paused = seedSchedule(acc, "ORDER_SUMMARY", false, "CREDENTIAL_EXPIRED");

        verifier.outcome = VerifyOutcome.failed(VerifyOutcome.REASON_INVALID_CREDENTIAL);
        CredentialReplaceResultView result = service.replaceCredential(org, acc.getId(), newRequest(), actor);

        assertThat(result.status()).isEqualTo("FAILED");
        assertThat(result.reasonCode()).isEqualTo(VerifyOutcome.REASON_INVALID_CREDENTIAL);
        assertThat(result.message()).doesNotContain("AK", "SK");

        // ROLLBACK: the OLD credential (secrets + its expiry) is restored; the new one is discarded.
        DecryptedCredential stored = vault.open(org, acc.getId());
        assertThat(stored.secrets().get("access_key")).isEqualTo("AK-OLD");
        assertThat(stored.tokenExpiresAt()).isEqualTo(oldExpiry);
        assertThat(result.tokenExpiresAt()).isEqualTo(oldExpiry);

        // Orders + cursors + account untouched throughout.
        assertThat(channelOrders.count()).isEqualTo(1);
        assertThat(cursors.count()).isEqualTo(1);
        assertThat(sellerAccounts.findById(acc.getId()).orElseThrow().getConnectionStatus())
                .isEqualTo(ChannelStatus.CONNECTED);

        // A failed renewal must NOT resume a paused schedule.
        assertThat(schedules.findById(paused.getId()).orElseThrow().isEnabled()).isFalse();
    }

    @Test
    void noExistingCredentialIsSafeFailureNotAStore() {
        SellerAccount acc = coupangAccount(); // no credential on file
        verifier.outcome = VerifyOutcome.success();

        CredentialReplaceResultView result = service.replaceCredential(org, acc.getId(), newRequest(), actor);

        assertThat(result.status()).isEqualTo("FAILED");
        assertThat(result.reasonCode()).isEqualTo("NO_EXISTING_CREDENTIAL");
        assertThat(vault.hasCredential(org, acc.getId())).isFalse(); // nothing was stored
    }

    // --- fixtures ---

    private SellerAccount coupangAccount() {
        Channel ch = channels.findByCode("COUPANG").orElseGet(() -> {
            Channel c = new Channel();
            c.setCode("COUPANG");
            c.setNameKo("쿠팡");
            c.setStatus(ChannelStatus.AVAILABLE);
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

    private void storeOld(SellerAccount acc) {
        vault.store(org, acc.getId(), "API", "HMAC",
                Map.of("access_key", "AK-OLD", "secret_key", "SK-OLD", "vendor_id", "vendorX"),
                null, oldExpiry, actor);
    }

    private CredentialIntakeRequest newRequest() {
        return new CredentialIntakeRequest("API", "HMAC",
                Map.of("access_key", "AK-NEW", "secret_key", "SK-NEW", "vendor_id", "vendorX"),
                null, newExpiry);
    }

    private void seedOrder(SellerAccount acc) {
        ChannelOrder o = new ChannelOrder();
        o.setOrgId(org);
        o.setSellerAccountId(acc.getId());
        o.setChannelId(acc.getChannelId());
        o.setExternalOrderId("ORDER-1");
        o.setRawStatusCode("PAYED");
        o.setNormalizedStatus(NormalizedOrderStatus.PAID);
        o.setPaymentAmount(10000L);
        o.setSummaryDate(LocalDate.parse("2026-08-01"));
        o.setFirstSeenAt(Instant.now());
        o.setLastSeenAt(Instant.now());
        channelOrders.save(o);
    }

    private void seedCursor(SellerAccount acc) {
        SyncCursor c = new SyncCursor();
        c.setOrgId(org);
        c.setSellerAccountId(acc.getId());
        c.setDataType("ORDER_SUMMARY");
        c.setCursorKey("createdAt");
        c.setCursorValue("cursor-abc");
        cursors.save(c);
    }

    private SyncSchedule seedSchedule(SellerAccount acc, String dataType, boolean enabled, String pausedReason) {
        SyncSchedule s = new SyncSchedule();
        s.setOrgId(org);
        s.setSellerAccountId(acc.getId());
        s.setDataType(dataType);
        s.setCadenceKind("INTERVAL");
        s.setIntervalMinutes(60);
        s.setEnabled(enabled);
        s.setPausedReason(pausedReason);
        return schedules.save(s);
    }

    private static String randomKeyBase64() {
        byte[] key = new byte[32];
        new SecureRandom().nextBytes(key);
        return Base64.getEncoder().encodeToString(key);
    }

    /** A COUPANG-dedicated verifier whose outcome the test controls; it never makes a real call. */
    private static final class StubCoupangVerifier implements PullConnector, ConnectionVerifier {
        private VerifyOutcome outcome = VerifyOutcome.success();

        @Override
        public String kind() {
            return "COUPANG_API_STUB";
        }

        @Override
        public Set<String> dedicatedChannels() {
            return Set.of("COUPANG");
        }

        @Override
        public ConnectorCapabilities capabilities(String channelCode) {
            return new ConnectorCapabilities("API", Set.of(DataType.ORDER_SUMMARY),
                    Map.of(DataType.ORDER_SUMMARY, "CONFIRMED"), "stub");
        }

        @Override
        public List<UnsupportedScope> unsupportedScopes(String channelCode) {
            return List.of();
        }

        @Override
        public FetchPage fetch(FetchRequest request) {
            throw new UnsupportedOperationException("stub does not collect");
        }

        @Override
        public VerifyOutcome verifyConnection(VerifyContext context) {
            return outcome;
        }
    }
}
