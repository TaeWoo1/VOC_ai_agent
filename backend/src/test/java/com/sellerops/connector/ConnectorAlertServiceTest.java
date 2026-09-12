package com.sellerops.connector;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sellerops.channel.Channel;
import com.sellerops.common.ApiException;
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
    @Autowired com.sellerops.sync.SyncJobRepository syncJobs;

    private ConnectorAlertService service;

    private final UUID orgA = UUID.randomUUID();
    private final UUID orgB = UUID.randomUUID();
    private UUID accountA;
    private UUID openAlertA;
    private UUID acknowledgedAlertA;
    private UUID alertB;

    @BeforeEach
    void setUp() {
        service = new ConnectorAlertService(alerts, sellerAccounts, channels, syncJobs);

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
        openAlertA = save(orgA, accA.getId(), "RATE_LIMITED", "WARNING", "속도 제한",
                Instant.parse("2026-06-10T00:00:00Z"), null);
        save(orgA, accA.getId(), "AUTH_EXPIRED", "WARNING", "인증 만료", Instant.parse("2026-06-09T00:00:00Z"), null);
        acknowledgedAlertA = save(orgA, accA.getId(), "REPEATED_FAILURE", "WARNING", "확인됨",
                Instant.parse("2026-06-11T00:00:00Z"), Instant.parse("2026-06-11T01:00:00Z"));
        // orgB: a separate alert that must never leak into orgA's list.
        alertB = save(orgB, accB.getId(), "AUTH_EXPIRED", "WARNING", "타사 인증 만료",
                Instant.parse("2026-06-12T00:00:00Z"), null);
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

    private UUID save(UUID orgId, UUID accountId, String type, String severity,
                      String message, Instant createdAt, Instant acknowledgedAt) {
        ConnectorAlert a = new ConnectorAlert();
        a.setOrgId(orgId);
        a.setSellerAccountId(accountId);
        a.setType(type);
        a.setSeverity(severity);
        a.setMessage(message);
        a.setCreatedAt(createdAt);
        a.setAcknowledgedAt(acknowledgedAt);
        return alerts.save(a).getId();
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

    @Test
    void acknowledgeSetsTimestampAndEnrichesNames() {
        ConnectorAlertView v = service.acknowledge(orgA, openAlertA);
        assertThat(v.id()).isEqualTo(openAlertA);
        assertThat(v.acknowledgedAt()).isNotNull();
        assertThat(v.channelNameKo()).isEqualTo("쿠팡");
        assertThat(v.accountAlias()).isEqualTo("쿠팡 본계정");
        assertThat(alerts.findById(openAlertA).orElseThrow().getAcknowledgedAt()).isNotNull();
    }

    @Test
    void acknowledgeCrossOrgIsNotFoundAndLeavesRowUntouched() {
        assertThatThrownBy(() -> service.acknowledge(orgA, alertB))
                .isInstanceOf(ApiException.class);
        // orgB's alert must stay open — orgA cannot acknowledge it.
        assertThat(alerts.findById(alertB).orElseThrow().getAcknowledgedAt()).isNull();
    }

    @Test
    void acknowledgeIsIdempotentAndKeepsFirstTimestamp() {
        Instant first = service.acknowledge(orgA, openAlertA).acknowledgedAt();
        Instant second = service.acknowledge(orgA, openAlertA).acknowledgedAt();
        assertThat(second).isEqualTo(first);
    }

    @Test
    void acknowledgeAlreadyAcknowledgedKeepsOriginalTimestamp() {
        Instant original = Instant.parse("2026-06-11T01:00:00Z");
        ConnectorAlertView v = service.acknowledge(orgA, acknowledgedAlertA);
        assertThat(v.acknowledgedAt()).isEqualTo(original);
    }

    // ---- recovery: a failure a later success disproves ----------------------------------------

    private void syncRun(UUID orgId, UUID accountId, String status, Instant finishedAt) {
        com.sellerops.sync.SyncJob job = new com.sellerops.sync.SyncJob();
        job.setOrgId(orgId);
        job.setSellerAccountId(accountId);
        job.setDataType("REVIEW");
        job.setJobType("SCHEDULED");
        job.setStatus(status);
        job.setFinishedAt(finishedAt);
        syncJobs.save(job);
    }

    private ConnectorAlertView viewOf(UUID alertId) {
        return service.list(orgA).stream().filter(v -> v.id().equals(alertId)).findFirst().orElseThrow();
    }

    /**
     * <b>A failure that a later successful collection disproves is no longer a current problem.</b>
     *
     * <p>Measured on the live org: three alerts raised 2026-08-18..23 were still counted as
     * 「연결 문제 3건」 while every channel was CONNECTED with zero consecutive failures and had
     * collected successfully on 09-05 and 09-08. The badge was reporting a condition that had ended
     * three weeks earlier.
     */
    @Test
    void aLaterSuccessfulSyncEndsTheAlertsClaimOnThePresent() {
        syncRun(orgA, accountA, "SUCCESS", Instant.parse("2026-06-12T00:00:00Z"));

        ConnectorAlertView view = viewOf(openAlertA);
        assertThat(view.recoveredAt()).isEqualTo(Instant.parse("2026-06-12T00:00:00Z"));
        assertThat(view.active()).isFalse();
    }

    /**
     * <b>A newer alert is not blinded by an older one on the same account</b> — the bug the live org
     * caught.
     *
     * <p>The first implementation asked for the EARLIEST success after the OLDEST alert on the page
     * and compared that single timestamp against every alert. Here the older alert (06-09) is followed
     * by a success on 06-09T12:00, which predates the newer alert (06-10) — so the newer one read as
     * never recovered even though the account collected successfully again afterwards. On the demo org
     * that left Coupang counted as a current connection problem while it had collected on 09-12.
     */
    @Test
    void aNewerAlertIsJudgedByItsOwnTimeline() {
        // A success between the two alerts, and another after both.
        syncRun(orgA, accountA, "SUCCESS", Instant.parse("2026-06-09T12:00:00Z"));
        syncRun(orgA, accountA, "SUCCESS", Instant.parse("2026-06-20T00:00:00Z"));

        // openAlertA was raised 06-10 — after the first success, before the second.
        ConnectorAlertView view = viewOf(openAlertA);
        assertThat(view.recoveredAt()).isEqualTo(Instant.parse("2026-06-20T00:00:00Z"));
        assertThat(view.active()).isFalse();
    }

    /**
     * <b>The row is never touched.</b> History is the point of an alert log — what changes is only
     * whether the alert counts as current, and {@code acknowledgedAt} keeps meaning 「a person saw
     * this」 rather than quietly becoming 「it fixed itself」.
     */
    @Test
    void recoveryIsDerivedAndLeavesTheRecordAsItWasWritten() {
        syncRun(orgA, accountA, "SUCCESS", Instant.parse("2026-06-12T00:00:00Z"));
        service.list(orgA);

        ConnectorAlert stored = alerts.findById(openAlertA).orElseThrow();
        assertThat(stored.getAcknowledgedAt()).isNull();
        assertThat(service.list(orgA)).extracting(ConnectorAlertView::id).contains(openAlertA);
    }

    /**
     * A success that predates the alert is what was happening BEFORE things broke — it is not
     * evidence that anything resolved.
     */
    @Test
    void aSuccessFromBeforeTheFailureProvesNothing() {
        syncRun(orgA, accountA, "SUCCESS", Instant.parse("2026-06-01T00:00:00Z"));

        assertThat(viewOf(openAlertA).recoveredAt()).isNull();
        assertThat(viewOf(openAlertA).active()).isTrue();
    }

    /** A run that failed is not recovery, however recent. */
    @Test
    void aLaterFailedRunIsNotRecovery() {
        syncRun(orgA, accountA, "FAILED", Instant.parse("2026-06-20T00:00:00Z"));

        assertThat(viewOf(openAlertA).recoveredAt()).isNull();
        assertThat(viewOf(openAlertA).active()).isTrue();
    }

    /**
     * <b>PARTIAL counts.</b> A run that brought some rows back reached the channel and was answered,
     * so the condition a failure alert reports — that collection is not getting through — has ended.
     */
    @Test
    void aPartialRunCountsAsCollectionGettingThrough() {
        syncRun(orgA, accountA, "PARTIAL", Instant.parse("2026-06-12T00:00:00Z"));

        assertThat(viewOf(openAlertA).recoveredAt()).isEqualTo(Instant.parse("2026-06-12T00:00:00Z"));
    }

    /**
     * <b>A credential expiring next month is not refuted by a sync that worked today.</b> Expiry
     * warnings are statements about a future date and keep their own lifecycle.
     */
    @Test
    void aCredentialExpiryWarningIsNotDisprovedByASuccessfulSync() {
        UUID expiring = save(orgA, accountA, ConnectorAlertService.TYPE_COUPANG_CREDENTIAL_EXPIRING,
                "WARNING", "곧 만료", Instant.parse("2026-06-10T00:00:00Z"), null);
        syncRun(orgA, accountA, "SUCCESS", Instant.parse("2026-06-12T00:00:00Z"));

        assertThat(viewOf(expiring).recoveredAt()).isNull();
        assertThat(viewOf(expiring).active()).isTrue();
    }

    /** An already-acknowledged alert is not re-described as recovered; it was already not current. */
    @Test
    void anAcknowledgedAlertIsLeftAlone() {
        syncRun(orgA, accountA, "SUCCESS", Instant.parse("2026-06-12T00:00:00Z"));

        assertThat(viewOf(acknowledgedAlertA).recoveredAt()).isNull();
        assertThat(viewOf(acknowledgedAlertA).active()).isFalse();
    }
}
