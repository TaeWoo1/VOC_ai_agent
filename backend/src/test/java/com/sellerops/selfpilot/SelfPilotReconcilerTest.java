package com.sellerops.selfpilot;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.common.ApiException;
import com.sellerops.connector.ConnectorCapabilities;
import com.sellerops.connector.ConnectorRegistry;
import com.sellerops.connector.DataType;
import com.sellerops.connector.FetchPage;
import com.sellerops.connector.FetchRequest;
import com.sellerops.connector.MockApiConnector;
import com.sellerops.connector.PullConnector;
import com.sellerops.review.triage.feedback.TriagePredictionRepository;
import com.sellerops.review.triage.pilot.AiTriagePilotService;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import com.sellerops.sync.SyncSchedule;
import com.sellerops.sync.SyncScheduleRepository;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/**
 * Self-Pilot reconciler: creates default schedules only where a REAL connector serves the type and no
 * row exists; runs bounded triage under a per-tick and per-day budget; touches nothing else.
 */
class SelfPilotReconcilerTest {

    private final UUID org = UUID.randomUUID();
    private final SellerAccountRepository accounts = mock(SellerAccountRepository.class);
    private final ChannelRepository channels = mock(ChannelRepository.class);
    private final SyncScheduleRepository schedules = mock(SyncScheduleRepository.class);
    private final AiTriagePilotService pilot = mock(AiTriagePilotService.class);
    private final TriagePredictionRepository predictions = mock(TriagePredictionRepository.class);

    private Channel cafe24;
    private Channel coupang;
    private Channel gmarket;

    /** A stand-in for a real (dedicated) connector: Cafe24 shape — REVIEW/INQUIRY/ORDER_SUMMARY. */
    private static PullConnector dedicated(String code, DataType... types) {
        return new PullConnector() {
            @Override
            public String kind() {
                return "REAL_" + code;
            }

            @Override
            public Set<String> dedicatedChannels() {
                return Set.of(code);
            }

            @Override
            public ConnectorCapabilities capabilities(String channelCode) {
                return new ConnectorCapabilities("API", Set.of(types), java.util.Map.of(), null);
            }

            @Override
            public FetchPage fetch(FetchRequest request) {
                throw new UnsupportedOperationException();
            }
        };
    }

    @BeforeEach
    void setUp() {
        cafe24 = channel("CAFE24");
        coupang = channel("COUPANG");
        gmarket = channel("GMARKET");
        when(schedules.findByOrgIdAndSellerAccountIdAndDataType(any(), any(), any())).thenReturn(Optional.empty());
        when(schedules.save(any())).thenAnswer(inv -> inv.getArgument(0));
    }

    private Channel channel(String code) {
        Channel c = new Channel();
        c.setId(UUID.randomUUID());
        c.setCode(code);
        c.setNameKo(code);
        when(channels.findById(c.getId())).thenReturn(Optional.of(c));
        return c;
    }

    private SellerAccount account(Channel channel, ChannelStatus status, boolean fileUpload) {
        SellerAccount a = new SellerAccount();
        a.setId(UUID.randomUUID());
        a.setOrgId(org);
        a.setChannelId(channel.getId());
        a.setConnectionStatus(status);
        a.setFileUpload(fileUpload);
        return a;
    }

    private static final String LOCAL_DB = "jdbc:postgresql://localhost:5432/sellerops";

    /** ALLOW_LIST properties, the default posture. */
    private static SelfPilotProperties allowList(boolean enabled, String orgIds, String grant, int interval,
                                                 boolean triage, int perTick, int perDay) {
        return new SelfPilotProperties(enabled, "ALLOW_LIST", orgIds, grant, interval, triage, perTick, perDay, LOCAL_DB);
    }

    private SelfPilotProperties props(boolean enabled, boolean triage) {
        return allowList(enabled, enabled ? org.toString() : "", "", 60, triage, 20, 50);
    }

    private final com.sellerops.organization.OrganizationRepository organizations =
            mock(com.sellerops.organization.OrganizationRepository.class);

    private SelfPilotReconciler reconciler(SelfPilotProperties props, PullConnector... connectors) {
        return new SelfPilotReconciler(props, accounts, channels, new ConnectorRegistry(List.of(connectors)),
                schedules, pilot, predictions, organizations);
    }

    @Test
    void createsOneEnabledScheduleForEachSupportedRoutineTypeOfAConnectedRealAccount() {
        when(accounts.findAllByOrgId(org)).thenReturn(List.of(account(cafe24, ChannelStatus.CONNECTED, false)));
        SelfPilotReconciler r = reconciler(props(true, false),
                dedicated("CAFE24", DataType.REVIEW, DataType.INQUIRY, DataType.ORDER_SUMMARY), new MockApiConnector());

        SelfPilotReconciler.TickReport report = r.tick(Instant.parse("2026-08-18T03:00:00Z"));

        assertThat(report.schedulesCreated()).isEqualTo(3);
        ArgumentCaptor<SyncSchedule> saved = ArgumentCaptor.forClass(SyncSchedule.class);
        verify(schedules, times(3)).save(saved.capture());
        assertThat(saved.getAllValues()).allSatisfy(s -> {
            assertThat(s.isEnabled()).isTrue();
            assertThat(s.getIntervalMinutes()).isEqualTo(60);
            assertThat(s.getCadenceKind()).isEqualTo("INTERVAL");
            assertThat(s.getNextRunAt()).isEqualTo(Instant.parse("2026-08-18T03:00:00Z"));
            assertThat(s.getPausedReason()).isNull();
        });
        assertThat(saved.getAllValues()).extracting(SyncSchedule::getDataType)
                .containsExactlyInAnyOrder("REVIEW", "INQUIRY", "ORDER_SUMMARY");
    }

    @Test
    void neverSchedulesAgainstTheMockConnector() {
        // GMARKET resolves to the generic mock (no dedicated connector) — a schedule there would pour
        // fixture rows into a real org.
        when(accounts.findAllByOrgId(org)).thenReturn(List.of(account(gmarket, ChannelStatus.CONNECTED, false)));
        SelfPilotReconciler r = reconciler(props(true, false), new MockApiConnector());

        assertThat(r.tick(Instant.now()).schedulesCreated()).isZero();
        verify(schedules, never()).save(any());
    }

    @Test
    void skipsUnconnectedAndFileUploadAccountsAndUnsupportedTypes() {
        when(accounts.findAllByOrgId(org)).thenReturn(List.of(
                account(coupang, ChannelStatus.PENDING, false),
                account(coupang, ChannelStatus.RECONNECT_REQUIRED, false),
                account(coupang, ChannelStatus.CONNECTED, true),
                account(coupang, ChannelStatus.CONNECTED, false)));
        // Coupang real connector: INQUIRY + ORDER_SUMMARY only (REVIEW is the seller's seated walk).
        SelfPilotReconciler r = reconciler(props(true, false), dedicated("COUPANG", DataType.INQUIRY, DataType.ORDER_SUMMARY));

        assertThat(r.tick(Instant.now()).schedulesCreated()).isEqualTo(2);
        ArgumentCaptor<SyncSchedule> saved = ArgumentCaptor.forClass(SyncSchedule.class);
        verify(schedules, times(2)).save(saved.capture());
        assertThat(saved.getAllValues()).extracting(SyncSchedule::getDataType)
                .containsExactlyInAnyOrder("INQUIRY", "ORDER_SUMMARY");
    }

    @Test
    void anExistingRowIsTheOperatorsAndIsNeverTouched() {
        SellerAccount acc = account(cafe24, ChannelStatus.CONNECTED, false);
        when(accounts.findAllByOrgId(org)).thenReturn(List.of(acc));
        SyncSchedule off = new SyncSchedule();
        off.setEnabled(false); // operator-disabled (or auth-paused) — either way, not ours to flip
        when(schedules.findByOrgIdAndSellerAccountIdAndDataType(org, acc.getId(), "REVIEW")).thenReturn(Optional.of(off));
        SelfPilotReconciler r = reconciler(props(true, false), dedicated("CAFE24", DataType.REVIEW, DataType.INQUIRY));

        assertThat(r.tick(Instant.now()).schedulesCreated()).isEqualTo(1);
        assertThat(off.isEnabled()).isFalse();
        // Idempotent: a second tick over the same state creates nothing new once rows exist.
        when(schedules.findByOrgIdAndSellerAccountIdAndDataType(any(), any(), eq("INQUIRY")))
                .thenReturn(Optional.of(new SyncSchedule()));
        assertThat(r.tick(Instant.now()).schedulesCreated()).isZero();
    }

    @Test
    void aConcurrentInsertOfTheSameRowIsSkippedAndTheTickContinues() {
        // Independent review: two ticks/instances can both pass the isPresent() check; the unique index makes
        // the loser throw. That must skip ONE row, not abandon the rest of the org for the tick.
        SellerAccount acc = account(cafe24, ChannelStatus.CONNECTED, false);
        when(accounts.findAllByOrgId(org)).thenReturn(List.of(acc));
        when(schedules.save(any())).thenAnswer(inv -> {
            SyncSchedule s = inv.getArgument(0);
            if ("REVIEW".equals(s.getDataType())) {
                throw new org.springframework.dao.DataIntegrityViolationException("uq_sync_schedules_account_data_type");
            }
            return s;
        });
        SelfPilotReconciler r = reconciler(props(true, false),
                dedicated("CAFE24", DataType.REVIEW, DataType.INQUIRY, DataType.ORDER_SUMMARY));

        SelfPilotReconciler.TickReport report = r.tick(Instant.now());

        assertThat(report.schedulesCreated()).isEqualTo(2); // INQUIRY + ORDER_SUMMARY still created
        verify(schedules, times(3)).save(any());
    }

    @Test
    void disabledOrUnlistedOrgDoesNothingAtAll() {
        when(accounts.findAllByOrgId(any())).thenReturn(List.of(account(cafe24, ChannelStatus.CONNECTED, false)));
        assertThat(reconciler(props(false, true), dedicated("CAFE24", DataType.REVIEW)).tick(Instant.now()))
                .isEqualTo(new SelfPilotReconciler.TickReport(0, 0, 0));
        // enabled but no org listed → fail closed
        SelfPilotProperties noOrg = allowList(true, "", "", 60, true, 20, 50);
        assertThat(reconciler(noOrg, dedicated("CAFE24", DataType.REVIEW)).tick(Instant.now()))
                .isEqualTo(new SelfPilotReconciler.TickReport(0, 0, 0));
        verify(schedules, never()).save(any());
        verify(pilot, never()).run(any(), any(), anyInt());
    }

    // ── bounded automatic triage ──

    @Test
    void triageRunsOncePerContractChannelWithinPerTickAndPerDayBudget() {
        SellerAccount a1 = account(cafe24, ChannelStatus.CONNECTED, false);
        SellerAccount a2 = account(cafe24, ChannelStatus.CONNECTED, false); // same channel: same pending set
        SellerAccount a3 = account(coupang, ChannelStatus.CONNECTED, false);
        SellerAccount a4 = account(gmarket, ChannelStatus.CONNECTED, false); // outside the triage contract
        when(accounts.findAllByOrgId(org)).thenReturn(List.of(a1, a2, a3, a4));
        when(pilot.isEnabledFor(org)).thenReturn(true);
        when(predictions.countByOrgIdAndPredictedAtGreaterThanEqual(eq(org), any())).thenReturn(35L); // 50 - 35 = 15 left
        when(pilot.run(eq(org), eq(a1.getId()), anyInt()))
                .thenReturn(new AiTriagePilotService.RunResult("v", 15, 15, 3, 0, 0, 100));
        SelfPilotReconciler r = reconciler(props(true, true), dedicated("CAFE24", DataType.REVIEW));

        SelfPilotReconciler.TickReport report = r.tick(Instant.parse("2026-08-18T03:00:00Z"));

        // Cafe24 got min(perTick=20, remaining=15) = 15; that exhausted the day, so Coupang was skipped
        // for budget; the second Cafe24 account and GMARKET were never candidates.
        verify(pilot).run(org, a1.getId(), 15);
        verify(pilot, never()).run(eq(org), eq(a2.getId()), anyInt());
        verify(pilot, never()).run(eq(org), eq(a3.getId()), anyInt());
        verify(pilot, never()).run(eq(org), eq(a4.getId()), anyInt());
        assertThat(report.triageClassified()).isEqualTo(15);
        assertThat(report.triageSkippedBudget()).isEqualTo(1);
    }

    @Test
    void triageBudgetIsMeteredFromPredictionsSoARestartCannotResetIt() {
        SellerAccount a1 = account(cafe24, ChannelStatus.CONNECTED, false);
        when(accounts.findAllByOrgId(org)).thenReturn(List.of(a1));
        when(pilot.isEnabledFor(org)).thenReturn(true);
        when(predictions.countByOrgIdAndPredictedAtGreaterThanEqual(eq(org), any())).thenReturn(50L); // day spent
        SelfPilotReconciler r = reconciler(props(true, true), dedicated("CAFE24", DataType.REVIEW));

        SelfPilotReconciler.TickReport report = r.tick(Instant.now());

        verify(pilot, never()).run(any(), any(), anyInt());
        assertThat(report.triageSkippedBudget()).isEqualTo(1);
        // The day boundary is KST midnight, passed to the meter.
        ArgumentCaptor<Instant> since = ArgumentCaptor.forClass(Instant.class);
        verify(predictions).countByOrgIdAndPredictedAtGreaterThanEqual(eq(org), since.capture());
        assertThat(since.getValue().atZone(SelfPilotReconciler.KST).toLocalTime()).isEqualTo(java.time.LocalTime.MIDNIGHT);
    }

    @Test
    void aBusyOrRefusedPilotRunIsSkippedNotRetried() {
        SellerAccount a1 = account(cafe24, ChannelStatus.CONNECTED, false);
        when(accounts.findAllByOrgId(org)).thenReturn(List.of(a1));
        when(pilot.isEnabledFor(org)).thenReturn(true);
        when(predictions.countByOrgIdAndPredictedAtGreaterThanEqual(eq(org), any())).thenReturn(0L);
        when(pilot.run(eq(org), eq(a1.getId()), anyInt())).thenThrow(ApiException.conflict("이미 실행 중"));
        SelfPilotReconciler r = reconciler(props(true, true), dedicated("CAFE24", DataType.REVIEW));

        SelfPilotReconciler.TickReport report = r.tick(Instant.now());

        verify(pilot, times(1)).run(eq(org), eq(a1.getId()), anyInt());
        assertThat(report.triageSkippedBudget()).isEqualTo(1);
        assertThat(report.triageClassified()).isZero();
    }

    @Test
    void triageIsOffWhenThePilotIsOffForTheOrgEvenIfAutoIsOn() {
        when(accounts.findAllByOrgId(org)).thenReturn(List.of(account(cafe24, ChannelStatus.CONNECTED, false)));
        when(pilot.isEnabledFor(org)).thenReturn(false);
        reconciler(props(true, true), dedicated("CAFE24", DataType.REVIEW)).tick(Instant.now());
        verify(pilot, never()).run(any(), any(), anyInt());
    }

    // ── properties ──

    @Test
    void readGrantMustHaveTheSprShapeOrTheBackendRefusesToStart() {
        assertThatThrownBy(() -> allowList(true, "", "apr-abc123", 60, false, 20, 200))
                .isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> allowList(true, "", "spr-xyz", 60, false, 20, 200))
                .isInstanceOf(IllegalStateException.class);
        SelfPilotProperties ok = allowList(true, "", " spr-0123456789abcdef ", 5, false, 0, 0);
        assertThat(ok.readGrantId()).isEqualTo("spr-0123456789abcdef");
        assertThat(ok.defaultIntervalMinutes()).isEqualTo(15); // floor
        assertThat(ok.triagePerTick()).isEqualTo(20);
        assertThat(ok.triagePerDay()).isEqualTo(200);
        assertThat(allowList(false, "", "", 60, false, 20, 200).readGrantId()).isEmpty();
    }

    @Test
    void triageAutoRequiresTheMasterSwitch() {
        assertThat(allowList(false, "", "", 60, true, 20, 200).triageAutoEnabled()).isFalse();
        assertThat(allowList(true, "", "", 60, true, 20, 200).triageAutoEnabled()).isTrue();
    }

    // ── LOCAL_SINGLE_USER scope (browser-only new user: no org UUID env) ──

    private static SelfPilotProperties localSingleUser(String db) {
        return new SelfPilotProperties(true, "LOCAL_SINGLE_USER", "", "", 60, false, 20, 50, db);
    }

    @Test
    void localSingleUserActsForEveryOrgInTheDatabaseWithoutAnAllowList() {
        com.sellerops.organization.Organization o1 = new com.sellerops.organization.Organization();
        o1.setId(org);
        com.sellerops.organization.Organization o2 = new com.sellerops.organization.Organization();
        o2.setId(UUID.randomUUID());
        when(organizations.findAll()).thenReturn(List.of(o1, o2));
        when(accounts.findAllByOrgId(org)).thenReturn(List.of(account(cafe24, ChannelStatus.CONNECTED, false)));
        when(accounts.findAllByOrgId(o2.getId())).thenReturn(List.of(account(coupang, ChannelStatus.CONNECTED, false)));
        SelfPilotReconciler r = reconciler(localSingleUser(LOCAL_DB),
                dedicated("CAFE24", DataType.REVIEW), dedicated("COUPANG", DataType.INQUIRY));

        assertThat(r.targetOrgIds()).containsExactlyInAnyOrder(org, o2.getId());
        assertThat(r.tick(Instant.now()).schedulesCreated()).isEqualTo(2);
        assertThat(localSingleUser(LOCAL_DB).isEnabledFor(UUID.randomUUID())).isTrue();
    }

    @Test
    void localSingleUserRefusesToBootAgainstANonLoopbackDatabase() {
        assertThatThrownBy(() -> localSingleUser("jdbc:postgresql://db.internal.example:5432/sellerops"))
                .isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> localSingleUser("")).isInstanceOf(IllegalStateException.class);
        // Loopback spellings and in-memory H2 are local by construction.
        for (String ok : new String[] {LOCAL_DB, "jdbc:postgresql://127.0.0.1/sellerops",
                "jdbc:postgresql://[::1]:5432/x", "jdbc:h2:mem:testdb"}) {
            assertThat(SelfPilotProperties.isLoopbackDatabase(ok)).as(ok).isTrue();
        }
        assertThat(SelfPilotProperties.isLoopbackDatabase("jdbc:postgresql://localhost.evil.com/x")).isFalse();
        // The fence only bites when the scope is actually used: ALLOW_LIST against a remote DB is fine, and a
        // disabled runtime never refuses to boot.
        assertThat(new SelfPilotProperties(true, "ALLOW_LIST", "", "", 60, false, 20, 50,
                "jdbc:postgresql://db.internal.example:5432/sellerops").scope()).isEqualTo(SelfPilotProperties.Scope.ALLOW_LIST);
        assertThat(new SelfPilotProperties(false, "LOCAL_SINGLE_USER", "", "", 60, false, 20, 50,
                "jdbc:postgresql://db.internal.example:5432/sellerops").actsForAllOrgs()).isFalse();
        assertThatThrownBy(() -> new SelfPilotProperties(true, "EVERYONE", "", "", 60, false, 20, 50, LOCAL_DB))
                .isInstanceOf(IllegalStateException.class);
    }

    @SuppressWarnings("unused")
    private static List<SyncSchedule> none() {
        return new ArrayList<>();
    }
}
