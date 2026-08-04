package com.sellerops.selleraccount;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.connector.naver.onboarding.NaverConnectionLifecycle;
import com.sellerops.selleraccount.dto.ApiChannelRequest;
import com.sellerops.selleraccount.dto.SellerAccountResponse;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.PlatformTransactionManager;

/**
 * Service-level find-or-create behavior for the one-API-account-per-(org, channel) rule. The DB
 * enforcement (the partial unique index {@code uq_seller_accounts_api_org_channel}) is Postgres-only and
 * proven in {@link SellerAccountUniquenessPostgresProofIT}; the H2 test DB has no filtered indexes and
 * Flyway is disabled there, so here we pin the behavior that does not depend on the index: a repeated
 * connection start returns the SAME account (via the PESSIMISTIC_WRITE channel lock + findFirst),
 * distinct channels stay separate, and a constrained account still advances through the connection
 * lifecycle.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class SellerAccountUniquenessTest {

    @Autowired SellerAccountRepository accounts;
    @Autowired ChannelRepository channels;
    @Autowired PlatformTransactionManager txManager;

    private final UUID org = UUID.randomUUID();
    private SellerAccountService service;
    private NaverConnectionLifecycle lifecycle;

    @BeforeEach
    void setUp() {
        service = new SellerAccountService(accounts, channels);
        lifecycle = new NaverConnectionLifecycle(accounts, channels, txManager);
    }

    @Test
    void repeatedApiChannelStartReturnsTheSameAccount() {
        Channel ch = channel("NAVER");
        ApiChannelRequest req = new ApiChannelRequest(ch.getId(), null);

        SellerAccountResponse first = service.registerApiChannel(org, req);
        SellerAccountResponse second = service.registerApiChannel(org, req);

        // findFirst re-reads and returns the first account rather than inserting a second. This pins the
        // sequential half of the graceful "race returns the same account" path; the concurrent half (the
        // PESSIMISTIC_WRITE channel lock actually serializing two racers) is proven in the Postgres IT —
        // a single-transaction @DataJpaTest cannot exercise a real lock.
        assertThat(second.id()).isEqualTo(first.id());
        assertThat(accounts.findAllByOrgId(org)).hasSize(1);
    }

    @Test
    void apiStartsOnDifferentChannelsCreateDistinctAccounts() {
        UUID naver = service.registerApiChannel(org, new ApiChannelRequest(channel("NAVER").getId(), null)).id();
        UUID cafe24 = service.registerApiChannel(org, new ApiChannelRequest(channel("CAFE24").getId(), null)).id();

        assertThat(naver).isNotEqualTo(cafe24);
        assertThat(accounts.findAllByOrgId(org)).hasSize(2);
    }

    @Test
    void registeredAccountStillAdvancesPendingToPreparingToConnected() {
        Channel ch = channel("NAVER");
        UUID accountId = service.registerApiChannel(org, new ApiChannelRequest(ch.getId(), null)).id();
        assertThat(status(accountId)).isEqualTo(ChannelStatus.PENDING);

        lifecycle.onCredentialTestVerified(org, accountId);
        assertThat(status(accountId)).isEqualTo(ChannelStatus.PREPARING);

        lifecycle.onOrderSyncCollected(org, accountId);
        assertThat(status(accountId)).isEqualTo(ChannelStatus.CONNECTED);
    }

    private Channel channel(String code) {
        Channel ch = new Channel();
        ch.setCode(code);
        ch.setNameKo(code);
        ch.setStatus(ChannelStatus.AVAILABLE);
        ch.setSortOrder(0);
        return channels.save(ch);
    }

    private ChannelStatus status(UUID accountId) {
        return accounts.findById(accountId).orElseThrow().getConnectionStatus();
    }
}
