package com.sellerops.connector.coupang;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.collect.CollectControlService;
import com.sellerops.collect.dto.ConnectionStatusView;
import com.sellerops.connector.ChannelConnectionStatus;
import com.sellerops.connector.ChannelConnectionStatusRepository;
import com.sellerops.connector.ConnectorAlert;
import com.sellerops.connector.ConnectorAlertRepository;
import com.sellerops.connector.ConnectorAlertService;
import com.sellerops.credential.ConnectorCredentialRepository;
import com.sellerops.credential.CredentialVault;
import com.sellerops.selleraccount.AccountSessionSlotRepository;
import com.sellerops.selleraccount.AccountSessionSlotService;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import com.sellerops.sync.SyncJobRepository;
import com.sellerops.sync.SyncScheduleRepository;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
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

/**
 * The Coupang credential-expiry alert, driven through the real connection-status read path
 * (no scheduler): reading the status computes the sanitized expiry sub-view AND idempotently
 * upserts the matching alert, reusing the one-unacknowledged-per-type dedup and idempotent ack.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class CoupangCredentialExpiryAlertTest {

    @Autowired SellerAccountRepository sellerAccounts;
    @Autowired ChannelRepository channels;
    @Autowired SyncScheduleRepository schedules;
    @Autowired SyncJobRepository syncJobs;
    @Autowired ChannelConnectionStatusRepository connectionStatus;
    @Autowired ConnectorCredentialRepository credentials;
    @Autowired ConnectorAlertRepository alerts;
    @Autowired AccountSessionSlotRepository accountSlotRepo;

    private final UUID org = UUID.randomUUID();
    private CredentialVault vault;
    private ConnectorAlertService alertService;
    private CollectControlService service;

    @BeforeEach
    void setUp() {
        vault = new CredentialVault(credentials, new ObjectMapper(), randomKeyBase64(), "local-test-1");
        alertService = new ConnectorAlertService(alerts, sellerAccounts, channels);
        // connectionStatus() never touches capabilities/registry/executor/lifecycles — pass null.
        service = new CollectControlService(sellerAccounts, channels, schedules, syncJobs,
                connectionStatus, null, null, null, vault,
                new AccountSessionSlotService(accountSlotRepo), null, null, alertService);
    }

    @Test
    void warn14ReadExposesExpirySubViewAndOpensExpiringAlertOnce() {
        SellerAccount acc = coupangAccount();
        storeCredential(acc, Instant.now().plus(Duration.ofDays(14)));

        ConnectionStatusView view = service.connectionStatus(org, acc.getId());
        assertThat(view.credentialExpiry().state())
                .isEqualTo(CoupangCredentialExpiryStatus.State.WARN_14);
        assertThat(view.credentialExpiry().renewRecommended()).isTrue();

        List<ConnectorAlert> open = alerts.findBySellerAccountIdOrderByCreatedAtDesc(acc.getId());
        assertThat(open).hasSize(1);
        assertThat(open.get(0).getType()).isEqualTo(ConnectorAlertService.TYPE_COUPANG_CREDENTIAL_EXPIRING);
        assertThat(open.get(0).getSeverity()).isEqualTo("WARNING");
        // No secret leaks into the message.
        assertThat(open.get(0).getMessage()).doesNotContain("AK", "SK", "vendor");

        // Reading again must NOT spam a second alert (one-unacked-per-type dedup).
        service.connectionStatus(org, acc.getId());
        assertThat(alerts.findBySellerAccountIdOrderByCreatedAtDesc(acc.getId())).hasSize(1);
    }

    @Test
    void acknowledgedExpiringAlertReopensOnNextRead() {
        SellerAccount acc = coupangAccount();
        storeCredential(acc, Instant.now().plus(Duration.ofDays(7)));

        service.connectionStatus(org, acc.getId());
        ConnectorAlert first = alerts.findBySellerAccountIdOrderByCreatedAtDesc(acc.getId()).get(0);
        // Acknowledge (idempotent) — silences the existing alert.
        alertService.acknowledge(org, first.getId());
        assertThat(alerts.findById(first.getId()).orElseThrow().getAcknowledgedAt()).isNotNull();

        // Still renew-recommended → a fresh occurrence opens again after ack.
        service.connectionStatus(org, acc.getId());
        long unacked = alerts.findBySellerAccountIdOrderByCreatedAtDesc(acc.getId()).stream()
                .filter(a -> a.getType().equals(ConnectorAlertService.TYPE_COUPANG_CREDENTIAL_EXPIRING)
                        && a.getAcknowledgedAt() == null)
                .count();
        assertThat(unacked).isEqualTo(1);
    }

    @Test
    void datePassedAndAuthFailingOpensExpiredCriticalAlert() {
        SellerAccount acc = coupangAccount();
        storeCredential(acc, Instant.now().minus(Duration.ofDays(2)));
        // consecutiveFailures > 0 → authFailing; with the date passed this is EXPIRED (strong).
        saveHealth(acc, 3);

        ConnectionStatusView view = service.connectionStatus(org, acc.getId());
        assertThat(view.credentialExpiry().state())
                .isEqualTo(CoupangCredentialExpiryStatus.State.EXPIRED);

        List<ConnectorAlert> open = alerts.findBySellerAccountIdOrderByCreatedAtDesc(acc.getId());
        assertThat(open).hasSize(1);
        assertThat(open.get(0).getType()).isEqualTo(ConnectorAlertService.TYPE_COUPANG_CREDENTIAL_EXPIRED);
        assertThat(open.get(0).getSeverity()).isEqualTo("CRITICAL");
    }

    @Test
    void datePassedWithoutAuthFailingIsSoftDatePassed_stillExpiringAlert_notExpired() {
        SellerAccount acc = coupangAccount();
        storeCredential(acc, Instant.now().minus(Duration.ofDays(2)));
        // No health row → not auth-failing → DATE_PASSED (soft), which is renew-recommended (EXPIRING),
        // NOT the strong EXPIRED verdict.
        ConnectionStatusView view = service.connectionStatus(org, acc.getId());
        assertThat(view.credentialExpiry().state())
                .isEqualTo(CoupangCredentialExpiryStatus.State.DATE_PASSED);

        List<ConnectorAlert> open = alerts.findBySellerAccountIdOrderByCreatedAtDesc(acc.getId());
        assertThat(open).hasSize(1);
        assertThat(open.get(0).getType()).isEqualTo(ConnectorAlertService.TYPE_COUPANG_CREDENTIAL_EXPIRING);
    }

    @Test
    void healthyFutureExpiryOpensNoAlert() {
        SellerAccount acc = coupangAccount();
        storeCredential(acc, Instant.now().plus(Duration.ofDays(120)));

        ConnectionStatusView view = service.connectionStatus(org, acc.getId());
        assertThat(view.credentialExpiry().state()).isEqualTo(CoupangCredentialExpiryStatus.State.OK);
        assertThat(alerts.findBySellerAccountIdOrderByCreatedAtDesc(acc.getId())).isEmpty();
    }

    @Test
    void unknownExpiryOpensNoAlert() {
        SellerAccount acc = coupangAccount();
        storeCredential(acc, null); // no date on file → UNKNOWN, never an estimate

        ConnectionStatusView view = service.connectionStatus(org, acc.getId());
        assertThat(view.credentialExpiry().state()).isEqualTo(CoupangCredentialExpiryStatus.State.UNKNOWN);
        assertThat(alerts.findBySellerAccountIdOrderByCreatedAtDesc(acc.getId())).isEmpty();
    }

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

    private void storeCredential(SellerAccount acc, Instant expiresAt) {
        vault.store(org, acc.getId(), "API", "HMAC",
                Map.of("access_key", "AK", "secret_key", "SK", "vendor_id", "vendorX"),
                null, expiresAt, null);
    }

    private void saveHealth(SellerAccount acc, int failures) {
        ChannelConnectionStatus h = new ChannelConnectionStatus();
        h.setOrgId(org);
        h.setSellerAccountId(acc.getId());
        h.setState("DEGRADED");
        h.setConsecutiveFailures(failures);
        connectionStatus.save(h);
    }

    private static String randomKeyBase64() {
        byte[] key = new byte[32];
        new SecureRandom().nextBytes(key);
        return Base64.getEncoder().encodeToString(key);
    }
}
