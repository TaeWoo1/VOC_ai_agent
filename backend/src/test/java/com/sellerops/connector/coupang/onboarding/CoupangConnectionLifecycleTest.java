package com.sellerops.connector.coupang.onboarding;

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
 * The Coupang account-level connection state machine — the same two-signal contract as NAVER: CONNECTED
 * is the AND of an explicit credential test (recorded PREPARING) and a subsequent collected order sync.
 * Neither signal alone connects, a rejection recalls the account, and the lifecycle is guarded to Coupang
 * API accounts only.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class CoupangConnectionLifecycleTest {

    @Autowired SellerAccountRepository accounts;
    @Autowired ChannelRepository channels;
    @Autowired PlatformTransactionManager txManager;

    private final UUID org = UUID.randomUUID();
    private CoupangConnectionLifecycle lifecycle;
    private UUID coupangChannelId;

    @BeforeEach
    void setUp() {
        lifecycle = new CoupangConnectionLifecycle(accounts, channels, txManager);
        coupangChannelId = channel("COUPANG").getId();
    }

    @Test
    void testAloneRecordsPreparing_syncAloneStaysPending() {
        SellerAccount tested = account(coupangChannelId, ChannelStatus.PENDING, false);
        lifecycle.onCredentialTestVerified(org, tested.getId());
        assertThat(status(tested)).isEqualTo(ChannelStatus.PREPARING);

        SellerAccount synced = account(coupangChannelId, ChannelStatus.PENDING, false);
        lifecycle.onOrderSyncCollected(org, synced.getId());
        assertThat(status(synced)).isEqualTo(ChannelStatus.PENDING);
    }

    @Test
    void verifiedTestThenCollectedSyncConnects() {
        SellerAccount acc = account(coupangChannelId, ChannelStatus.PENDING, false);

        lifecycle.onCredentialTestVerified(org, acc.getId());
        lifecycle.onOrderSyncCollected(org, acc.getId());

        assertThat(status(acc)).isEqualTo(ChannelStatus.CONNECTED);
    }

    @Test
    void reconnectAfterRejectionReArmsAndRequiresAFreshSync() {
        SellerAccount acc = account(coupangChannelId, ChannelStatus.CONNECTED, false);
        lifecycle.onCredentialRejected(org, acc.getId());
        assertThat(status(acc)).isEqualTo(ChannelStatus.RECONNECT_REQUIRED);

        lifecycle.onCredentialTestVerified(org, acc.getId());
        assertThat(status(acc)).isEqualTo(ChannelStatus.PREPARING);

        lifecycle.onOrderSyncCollected(org, acc.getId());
        assertThat(status(acc)).isEqualTo(ChannelStatus.CONNECTED);
    }

    @Test
    void reprocessingTheSameEventsConverges() {
        SellerAccount acc = account(coupangChannelId, ChannelStatus.PENDING, false);

        lifecycle.onCredentialTestVerified(org, acc.getId());
        lifecycle.onCredentialTestVerified(org, acc.getId());
        assertThat(status(acc)).isEqualTo(ChannelStatus.PREPARING);

        lifecycle.onOrderSyncCollected(org, acc.getId());
        lifecycle.onOrderSyncCollected(org, acc.getId());
        assertThat(status(acc)).isEqualTo(ChannelStatus.CONNECTED);
    }

    @Test
    void nonCoupangAccountIsNeverTouched() {
        UUID naver = channel("NAVER").getId();
        SellerAccount acc = account(naver, ChannelStatus.PREPARING, false);

        lifecycle.onCredentialTestVerified(org, acc.getId());
        lifecycle.onOrderSyncCollected(org, acc.getId());
        lifecycle.onCredentialRejected(org, acc.getId());

        assertThat(status(acc)).isEqualTo(ChannelStatus.PREPARING);
    }

    @Test
    void fileUploadAndCrossOrgAreNoOps() {
        SellerAccount fileUpload = account(coupangChannelId, ChannelStatus.PREPARING, true);
        lifecycle.onOrderSyncCollected(org, fileUpload.getId());
        assertThat(status(fileUpload)).isEqualTo(ChannelStatus.PREPARING);

        SellerAccount other = account(coupangChannelId, ChannelStatus.PREPARING, false);
        lifecycle.onOrderSyncCollected(UUID.randomUUID(), other.getId());
        assertThat(status(other)).isEqualTo(ChannelStatus.PREPARING);
    }

    // --- helpers ---

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
