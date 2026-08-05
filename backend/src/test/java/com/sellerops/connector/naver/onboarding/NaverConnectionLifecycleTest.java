package com.sellerops.connector.naver.onboarding;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.PlatformTransactionManager;

/**
 * The NAVER account-level connection state machine. CONNECTED means "an {@code ORDER_SUMMARY} sync
 * collected while the credential stood verified" — the AND of an explicit credential test (recorded as
 * PREPARING) AND a subsequent collected order sync. So neither signal alone connects; a stale
 * historical sync never vouches for a freshly verified credential (a reconnect re-arms and must re-prove
 * data flow); a clearly-invalid credential recalls the account; transient failures never move it; and
 * every transition is idempotent (a settled CONNECTED account is never shaken by a duplicate success).
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class NaverConnectionLifecycleTest {

    @Autowired SellerAccountRepository accounts;
    @Autowired ChannelRepository channels;
    @Autowired PlatformTransactionManager txManager;

    private final UUID org = UUID.randomUUID();
    private NaverConnectionLifecycle lifecycle;
    private UUID naverChannelId;

    @BeforeEach
    void setUp() {
        lifecycle = new NaverConnectionLifecycle(accounts, channels, txManager);
        naverChannelId = channel("NAVER").getId();
    }

    // --- test alone / sync alone never connects -------------------------------------------------

    @Test
    void explicitTestAloneRecordsPreparing_neverConnected() {
        SellerAccount acc = account(naverChannelId, ChannelStatus.PENDING, false);

        lifecycle.onCredentialTestVerified(org, acc.getId());

        // Verified, but no order data has flowed yet under this credential — CONNECTED is not earned.
        assertThat(status(acc)).isEqualTo(ChannelStatus.PREPARING);
    }

    @Test
    void orderSyncAloneNeverConnects_untestedAccountStaysPending() {
        SellerAccount acc = account(naverChannelId, ChannelStatus.PENDING, false);

        lifecycle.onOrderSyncCollected(org, acc.getId());

        // Data flowed, but the operator never explicitly verified the credential — no connect.
        assertThat(status(acc)).isEqualTo(ChannelStatus.PENDING);
    }

    // --- both signals connect; the confirming sync must run AFTER the verification --------------

    @Test
    void verifiedTestThenCollectedSyncConnects() {
        SellerAccount acc = account(naverChannelId, ChannelStatus.PENDING, false);

        lifecycle.onCredentialTestVerified(org, acc.getId());
        assertThat(status(acc)).isEqualTo(ChannelStatus.PREPARING);

        lifecycle.onOrderSyncCollected(org, acc.getId());

        assertThat(status(acc)).isEqualTo(ChannelStatus.CONNECTED);
    }

    @Test
    void syncBeforeVerificationDoesNotCount_confirmingSyncMustFollowTheTest() {
        SellerAccount acc = account(naverChannelId, ChannelStatus.PENDING, false);

        // A sync that collected BEFORE any test holds at PENDING (sync alone).
        lifecycle.onOrderSyncCollected(org, acc.getId());
        assertThat(status(acc)).isEqualTo(ChannelStatus.PENDING);

        // The test records the verification (PREPARING) — the earlier sync does NOT retro-connect it...
        lifecycle.onCredentialTestVerified(org, acc.getId());
        assertThat(status(acc)).isEqualTo(ChannelStatus.PREPARING);

        // ...only a sync that collects AFTER the verification confirms CONNECTED.
        lifecycle.onOrderSyncCollected(org, acc.getId());
        assertThat(status(acc)).isEqualTo(ChannelStatus.CONNECTED);
    }

    // --- H1 regression: a reconnect must re-prove data flow, never ride a pre-rejection sync ----

    @Test
    void reconnectAfterRejectionReArmsAndRequiresAFreshSync_neverStaleHistory() {
        // A connected account whose credential is later rejected → RECONNECT_REQUIRED. It has a rich
        // history of collected order syncs under the OLD credential.
        SellerAccount acc = account(naverChannelId, ChannelStatus.CONNECTED, false);
        lifecycle.onOrderSyncCollected(org, acc.getId()); // (already CONNECTED, no-op) — history exists
        lifecycle.onCredentialRejected(org, acc.getId());
        assertThat(status(acc)).isEqualTo(ChannelStatus.RECONNECT_REQUIRED);

        // Operator rotates the credential and re-tests SUCCESS. This must NOT jump to CONNECTED off the
        // pre-rejection sync history — it re-arms to PREPARING and awaits a fresh sync under the new cred.
        lifecycle.onCredentialTestVerified(org, acc.getId());
        assertThat(status(acc)).isEqualTo(ChannelStatus.PREPARING);

        // A fresh collected sync under the new credential then completes the reconnect.
        lifecycle.onOrderSyncCollected(org, acc.getId());
        assertThat(status(acc)).isEqualTo(ChannelStatus.CONNECTED);
    }

    // --- credential rejection ------------------------------------------------------------------

    @Test
    void clearlyInvalidCredentialRecallsForReconnect_fromEveryState() {
        for (ChannelStatus from : new ChannelStatus[]{
                ChannelStatus.PENDING, ChannelStatus.PREPARING, ChannelStatus.CONNECTED}) {
            SellerAccount acc = account(naverChannelId, from, false);

            lifecycle.onCredentialRejected(org, acc.getId());

            assertThat(status(acc)).as("from %s", from).isEqualTo(ChannelStatus.RECONNECT_REQUIRED);
        }
    }

    // --- CONNECTED is never shaken by a duplicate success --------------------------------------

    @Test
    void connectedAccountIsNeverShakenByDuplicateSuccessEvents() {
        SellerAccount acc = account(naverChannelId, ChannelStatus.CONNECTED, false);

        lifecycle.onCredentialTestVerified(org, acc.getId());
        lifecycle.onOrderSyncCollected(org, acc.getId());
        lifecycle.onCredentialTestVerified(org, acc.getId());

        assertThat(status(acc)).isEqualTo(ChannelStatus.CONNECTED);
    }

    // --- idempotency / reprocessing ------------------------------------------------------------

    @Test
    void reprocessingTheSameEventsConverges() {
        SellerAccount acc = account(naverChannelId, ChannelStatus.PENDING, false);

        // Repeated test-verified events settle at PREPARING (no confirming sync yet).
        lifecycle.onCredentialTestVerified(org, acc.getId());
        lifecycle.onCredentialTestVerified(org, acc.getId());
        assertThat(status(acc)).isEqualTo(ChannelStatus.PREPARING);

        // Repeated sync-collected events settle at CONNECTED once and stay there.
        lifecycle.onOrderSyncCollected(org, acc.getId());
        lifecycle.onOrderSyncCollected(org, acc.getId());
        assertThat(status(acc)).isEqualTo(ChannelStatus.CONNECTED);
    }

    // --- scope guards: NAVER API accounts only -------------------------------------------------

    @Test
    void nonNaverAccountIsNeverTouched() {
        UUID cafe24 = channel("CAFE24").getId();
        SellerAccount acc = account(cafe24, ChannelStatus.PREPARING, false);

        lifecycle.onCredentialTestVerified(org, acc.getId());
        lifecycle.onOrderSyncCollected(org, acc.getId());
        lifecycle.onCredentialRejected(org, acc.getId());

        assertThat(status(acc)).isEqualTo(ChannelStatus.PREPARING);
    }

    @Test
    void fileUploadNaverAccountIsNeverTouched() {
        SellerAccount acc = account(naverChannelId, ChannelStatus.PREPARING, true);

        lifecycle.onCredentialTestVerified(org, acc.getId());
        lifecycle.onOrderSyncCollected(org, acc.getId());

        assertThat(status(acc)).isEqualTo(ChannelStatus.PREPARING);
    }

    @Test
    void crossOrgCallIsANoOp() {
        SellerAccount acc = account(naverChannelId, ChannelStatus.PREPARING, false);

        lifecycle.onOrderSyncCollected(UUID.randomUUID(), acc.getId());

        assertThat(status(acc)).isEqualTo(ChannelStatus.PREPARING);
    }

    // --- helpers -------------------------------------------------------------------------------

    private Channel channel(String code) {
        Channel ch = new Channel();
        ch.setCode(code);
        ch.setNameKo(code);
        ch.setStatus(ChannelStatus.AVAILABLE);
        ch.setSortOrder(0);
        return channels.save(ch);
    }

    private SellerAccount account(UUID channelId, ChannelStatus status, boolean fileUpload) {
        SellerAccount acc = new SellerAccount();
        acc.setOrgId(org);
        acc.setChannelId(channelId);
        acc.setConnectionStatus(status);
        acc.setFileUpload(fileUpload);
        return accounts.save(acc);
    }

    private ChannelStatus status(SellerAccount acc) {
        return accounts.findById(acc.getId()).orElseThrow().getConnectionStatus();
    }
}
