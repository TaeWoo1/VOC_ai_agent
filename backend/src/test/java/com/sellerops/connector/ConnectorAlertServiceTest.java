package com.sellerops.connector;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.connector.dto.ConnectorAlertView;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class ConnectorAlertServiceTest {

    @Autowired ConnectorAlertRepository alerts;
    @Autowired SellerAccountRepository sellerAccounts;
    @Autowired ChannelRepository channels;

    private ConnectorAlertService service;

    private final UUID orgA = UUID.randomUUID();
    private final UUID orgB = UUID.randomUUID();
    private UUID accountA;

    @BeforeEach
    void setUp() {
        service = new ConnectorAlertService(alerts, sellerAccounts, channels);

        Channel channel = new Channel();
        channel.setCode("COUPANG");
        channel.setNameKo("쿠팡");
        channel.setStatus(ChannelStatus.CONNECTED);
        channel.setSortOrder(1);
        channels.save(channel);

        SellerAccount accA = account(orgA, channel.getId(), "쿠팡 본계정");
        accountA = accA.getId();
        SellerAccount accB = account(orgB, channel.getId(), "타사 계정");

        // orgA: an open (newer) alert, an open (older) alert, and an acknowledged (newest) alert.
        save(orgA, accA.getId(), "RATE_LIMITED", "WARNING", "속도 제한", Instant.parse("2026-06-10T00:00:00Z"), null);
        save(orgA, accA.getId(), "AUTH_EXPIRED", "WARNING", "인증 만료", Instant.parse("2026-06-09T00:00:00Z"), null);
        save(orgA, accA.getId(), "REPEATED_FAILURE", "WARNING", "확인됨",
                Instant.parse("2026-06-11T00:00:00Z"), Instant.parse("2026-06-11T01:00:00Z"));
        // orgB: a separate alert that must never leak into orgA's list.
        save(orgB, accB.getId(), "AUTH_EXPIRED", "WARNING", "타사 인증 만료", Instant.parse("2026-06-12T00:00:00Z"), null);
    }

    private SellerAccount account(UUID orgId, UUID channelId, String alias) {
        SellerAccount a = new SellerAccount();
        a.setOrgId(orgId);
        a.setChannelId(channelId);
        a.setAlias(alias);
        a.setConnectionStatus(ChannelStatus.CONNECTED);
        a.setFileUpload(false);
        return sellerAccounts.save(a);
    }

    private void save(UUID orgId, UUID accountId, String type, String severity,
                      String message, Instant createdAt, Instant acknowledgedAt) {
        ConnectorAlert a = new ConnectorAlert();
        a.setOrgId(orgId);
        a.setSellerAccountId(accountId);
        a.setType(type);
        a.setSeverity(severity);
        a.setMessage(message);
        a.setCreatedAt(createdAt);
        a.setAcknowledgedAt(acknowledgedAt);
        alerts.save(a);
    }

    @Test
    void returnsOnlyCallerOrgAlerts() {
        List<ConnectorAlertView> view = service.list(orgA);
        assertThat(view).hasSize(3);
        assertThat(view).noneMatch(v -> v.message().contains("타사"));
    }

    @Test
    void ordersOpenAlertsFirstThenNewest() {
        List<ConnectorAlertView> view = service.list(orgA);
        // Open alerts come first (newest open before older open); the acknowledged
        // one sorts last even though it is the most recent.
        assertThat(view).extracting(ConnectorAlertView::type)
                .containsExactly("RATE_LIMITED", "AUTH_EXPIRED", "REPEATED_FAILURE");
        assertThat(view.get(2).acknowledgedAt()).isNotNull();
    }

    @Test
    void resolvesChannelAndAccountNames() {
        ConnectorAlertView v = service.list(orgA).get(0);
        assertThat(v.channelNameKo()).isEqualTo("쿠팡");
        assertThat(v.accountAlias()).isEqualTo("쿠팡 본계정");
        assertThat(v.sellerAccountId()).isEqualTo(accountA);
    }
}
