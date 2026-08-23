package com.sellerops.selfpilot;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.connector.ChannelConnectionStatusRepository;
import com.sellerops.connector.ConnectorAlertRepository;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import com.sellerops.sync.SyncSchedule;
import com.sellerops.sync.SyncScheduleRepository;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.PlatformTransactionManager;

/**
 * Reconnecting resumes what the SYSTEM paused, and only that.
 *
 * <p>The distinction is carried by {@code paused_reason}: a schedule the auth failure stopped has one,
 * and a schedule an operator turned off has none. Nothing else separates them — both rows read
 * {@code enabled = false}.
 *
 * <p>It matters beyond tidiness. A bounded live proof of ONE data type needs the account's other
 * schedules held off, or its request counts and its logs are mixed with a routine sweep that happened
 * to tick. Reconnecting is what starts that sweep, and the operator's pause has to be the thing that
 * survives it — which was a sentence in a javadoc and is now a test.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class SellerAccountReauthServiceTest {

    @Autowired SellerAccountRepository accounts;
    @Autowired SyncScheduleRepository schedules;
    @Autowired ChannelConnectionStatusRepository health;
    @Autowired ConnectorAlertRepository alerts;
    @Autowired ChannelRepository channels;
    @Autowired PlatformTransactionManager txManager;

    private SellerAccountReauthService service;
    private final UUID org = UUID.randomUUID();
    private UUID accountId;

    @BeforeEach
    void setUp() {
        service = new SellerAccountReauthService(accounts, schedules, health, alerts, txManager);

        Channel channel = new Channel();
        channel.setCode("NAVER-" + UUID.randomUUID().toString().substring(0, 8));
        channel.setNameKo("네이버");
        channel.setStatus(ChannelStatus.AVAILABLE);
        channel.setSupportsInquiry(true);
        channel.setSupportsReview(true);
        channel.setSupportsOrder(true);
        channel.setSupportsSales(true);
        channel.setSupportsProduct(true);
        channel.setSortOrder(0);
        channels.save(channel);

        SellerAccount account = new SellerAccount();
        account.setOrgId(org);
        account.setChannelId(channel.getId());
        account.setConnectionStatus(ChannelStatus.CONNECTED);
        account.setFileUpload(false);
        accountId = accounts.save(account).getId();
    }

    private SyncSchedule schedule(String dataType, boolean enabled, String pausedReason) {
        SyncSchedule schedule = new SyncSchedule();
        schedule.setOrgId(org);
        schedule.setSellerAccountId(accountId);
        schedule.setDataType(dataType);
        schedule.setCadenceKind("INTERVAL");
        schedule.setIntervalMinutes(60);
        schedule.setEnabled(enabled);
        schedule.setPausedReason(pausedReason);
        return schedules.save(schedule);
    }

    private SyncSchedule reload(UUID id) {
        return schedules.findById(id).orElseThrow();
    }

    @Test
    @DisplayName("an auth failure pauses the running schedules and says why, on the row")
    void anAuthFailurePausesWithAReason() {
        SyncSchedule running = schedule("ORDER_SUMMARY", true, null);

        service.markReconnectRequired(org, accountId, "네이버 인증이 더 이상 유효하지 않습니다.");

        SyncSchedule after = reload(running.getId());
        assertThat(after.isEnabled()).isFalse();
        assertThat(after.getPausedReason()).isEqualTo(SellerAccountReauthService.PAUSED_REASON_AUTH);
        assertThat(after.getNextRunAt()).isNull();
        assertThat(accounts.findById(accountId).orElseThrow().getConnectionStatus())
                .isEqualTo(ChannelStatus.RECONNECT_REQUIRED);
    }

    @Test
    @DisplayName("reconnecting resumes what the auth failure stopped")
    void reconnectingResumesTheSystemPause() {
        SyncSchedule systemPaused =
                schedule("ORDER_SUMMARY", false, SellerAccountReauthService.PAUSED_REASON_AUTH);

        service.onReconnected(org, accountId);

        SyncSchedule after = reload(systemPaused.getId());
        assertThat(after.isEnabled()).isTrue();
        assertThat(after.getPausedReason()).isNull();
        assertThat(after.getNextRunAt()).isNotNull();
    }

    @Test
    @DisplayName("reconnecting does NOT resume a schedule the operator turned off")
    void anOperatorPauseSurvivesAReconnect() {
        // The two rows are indistinguishable except for the reason: both are enabled = false.
        SyncSchedule operatorPaused = schedule("PRODUCT", false, null);
        SyncSchedule systemPaused =
                schedule("ORDER_SUMMARY", false, SellerAccountReauthService.PAUSED_REASON_AUTH);

        service.onReconnected(org, accountId);

        assertThat(reload(operatorPaused.getId()).isEnabled())
                .as("an operator's decision is not undone by a credential being fixed")
                .isFalse();
        assertThat(reload(operatorPaused.getId()).getNextRunAt()).isNull();
        // ...and the system pause next to it still resumed, so this is a distinction and not a freeze.
        assertThat(reload(systemPaused.getId()).isEnabled()).isTrue();
    }

    @Test
    @DisplayName("both calls are safe to make twice")
    void theTransitionsAreIdempotent() {
        SyncSchedule running = schedule("ORDER_SUMMARY", true, null);

        service.markReconnectRequired(org, accountId, "rejected");
        service.markReconnectRequired(org, accountId, "rejected");
        assertThat(alerts.findBySellerAccountIdAndTypeIn(accountId,
                java.util.List.of(SellerAccountReauthService.ALERT_TYPE_AUTH_EXPIRED))).hasSize(1);

        service.onReconnected(org, accountId);
        service.onReconnected(org, accountId);
        assertThat(reload(running.getId()).isEnabled()).isTrue();
    }
}
