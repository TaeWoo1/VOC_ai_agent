package com.sellerops.collect;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.connector.ChannelConnectionStatusRepository;
import com.sellerops.connector.ConnectorAlert;
import com.sellerops.connector.ConnectorAlertRepository;
import com.sellerops.connector.ConnectorCapabilities;
import com.sellerops.connector.ConnectorRegistry;
import com.sellerops.connector.DataType;
import com.sellerops.connector.FetchPage;
import com.sellerops.connector.FetchRequest;
import com.sellerops.connector.MockApiConnector;
import com.sellerops.connector.PullConnector;
import com.sellerops.ingest.IngestionService;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.order.OrderDailySummaryRepository;
import com.sellerops.community.Cafe24CommunityArticleRepository;
import com.sellerops.product.ProductRepository;
import com.sellerops.product.ProductService;
import com.sellerops.review.ReviewRepository;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import com.sellerops.sync.SyncCursorRepository;
import com.sellerops.sync.SyncJob;
import com.sellerops.sync.SyncJobRepository;
import com.sellerops.sync.SyncSchedule;
import com.sellerops.sync.SyncScheduleRepository;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * Slice 4: claiming due schedules, outcome-aware rescheduling (cadence /
 * rate-limit delay / bounded backoff), DEGRADED escalation, and alert rows —
 * over a real (H2) DB. Time is passed in, never read from the wall clock.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class SyncScheduleRunnerTest {

    private static final int CADENCE_MINUTES = 60;

    @Autowired SellerAccountRepository sellerAccounts;
    @Autowired ChannelRepository channels;
    @Autowired ReviewRepository reviews;
    @Autowired InquiryRepository inquiries;
    @Autowired OrderDailySummaryRepository orders;
    @Autowired ProductRepository products;
    @Autowired Cafe24CommunityArticleRepository communityArticles;
    @Autowired SyncJobRepository syncJobs;
    @Autowired SyncCursorRepository cursors;
    @Autowired ChannelConnectionStatusRepository connectionStatus;
    @Autowired SyncScheduleRepository schedules;
    @Autowired ConnectorAlertRepository alerts;

    private MockApiConnector mock;
    private SyncScheduleRunner runner;
    private final UUID org = UUID.randomUUID();
    /** Captured once; all cadence/backoff assertions derive from this parameter. */
    private final Instant now = Instant.now();

    @BeforeEach
    void setUp() {
        mock = new MockApiConnector();
        runner = runnerWith(mock);
    }

    private SyncScheduleRunner runnerWith(PullConnector connector) {
        ConnectorRegistry registry = new ConnectorRegistry(List.of(connector));
        IngestionService ingestion = new IngestionService(reviews, inquiries, orders, new ProductService(products), communityArticles, channels);
        SyncRunExecutor executor = new SyncRunExecutor(
                sellerAccounts, channels, registry, ingestion, syncJobs, cursors, connectionStatus);
        return new SyncScheduleRunner(
                new SyncScheduleClaimer(schedules), executor, schedules, syncJobs, connectionStatus, alerts);
    }

    private SellerAccount account(String channelCode) {
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
        acc.setOrgId(org);
        acc.setChannelId(ch.getId());
        acc.setConnectionStatus(ChannelStatus.CONNECTED);
        acc.setFileUpload(false);
        return sellerAccounts.save(acc);
    }

    private SyncSchedule intervalSchedule(SellerAccount acc, DataType type, Instant nextRunAt, boolean enabled) {
        SyncSchedule s = new SyncSchedule();
        s.setOrgId(org);
        s.setSellerAccountId(acc.getId());
        s.setDataType(type.name());
        s.setCadenceKind("INTERVAL");
        s.setIntervalMinutes(CADENCE_MINUTES);
        s.setEnabled(enabled);
        s.setNextRunAt(nextRunAt);
        return schedules.save(s);
    }

    private SyncSchedule reload(SyncSchedule s) {
        return schedules.findById(s.getId()).orElseThrow();
    }

    private List<ConnectorAlert> alertsOfType(UUID sellerAccountId, String type) {
        return alerts.findBySellerAccountIdOrderByCreatedAtDesc(sellerAccountId).stream()
                .filter(a -> a.getType().equals(type))
                .toList();
    }

    /** Connector whose every fetch fails — drives the backoff/escalation paths. */
    private PullConnector alwaysFailing() {
        return new PullConnector() {
            @Override
            public String kind() {
                return "MOCK_API";
            }

            @Override
            public ConnectorCapabilities capabilities(String channelCode) {
                return mock.capabilities(channelCode);
            }

            @Override
            public FetchPage fetch(FetchRequest request) {
                throw new RuntimeException("simulated connector outage");
            }
        };
    }

    @Test
    void dueEnabledScheduleExecutesOnceWithScheduledTrigger() {
        SellerAccount acc = account("GMARKET");
        intervalSchedule(acc, DataType.INQUIRY, now, true);

        List<SyncJob> jobs = runner.runDueSchedules(now, SyncScheduler.BATCH_LIMIT);

        assertThat(jobs).hasSize(1);
        assertThat(jobs.get(0).getTrigger()).isEqualTo("SCHEDULED");
        assertThat(jobs.get(0).getStatus()).isEqualTo("SUCCESS");
        assertThat(inquiries.count()).isEqualTo(45); // mock INQUIRY total

        // Claimed forward — a second tick at the same instant runs nothing.
        assertThat(runner.runDueSchedules(now, SyncScheduler.BATCH_LIMIT)).isEmpty();
        assertThat(syncJobs.count()).isEqualTo(1);
    }

    @Test
    void disabledScheduleIsIgnored() {
        SellerAccount acc = account("GMARKET");
        intervalSchedule(acc, DataType.INQUIRY, now, false);

        assertThat(runner.runDueSchedules(now, SyncScheduler.BATCH_LIMIT)).isEmpty();
        assertThat(syncJobs.count()).isZero();
    }

    @Test
    void futureScheduleIsIgnored() {
        SellerAccount acc = account("GMARKET");
        intervalSchedule(acc, DataType.INQUIRY, now.plus(Duration.ofMinutes(10)), true);

        assertThat(runner.runDueSchedules(now, SyncScheduler.BATCH_LIMIT)).isEmpty();
        assertThat(syncJobs.count()).isZero();
    }

    @Test
    void successfulRunUpdatesLastRunAtAndNextRunAtByCadence() {
        SellerAccount acc = account("GMARKET");
        SyncSchedule s = intervalSchedule(acc, DataType.INQUIRY, now, true);

        runner.runDueSchedules(now, SyncScheduler.BATCH_LIMIT);

        SyncSchedule after = reload(s);
        assertThat(after.isEnabled()).isTrue();
        assertThat(after.getLastRunAt()).isEqualTo(now);
        assertThat(after.getNextRunAt()).isEqualTo(now.plus(Duration.ofMinutes(CADENCE_MINUTES)));
    }

    @Test
    void failedRunUsesBoundedBackoffThenFallsBackToCadence() {
        SellerAccount acc = account("GMARKET");
        SyncSchedule s = intervalSchedule(acc, DataType.INQUIRY, now, true);
        SyncScheduleRunner failingRunner = runnerWith(alwaysFailing());

        // Attempt 1 → +1m
        failingRunner.runDueSchedules(now, SyncScheduler.BATCH_LIMIT);
        Instant retry1 = now.plus(Duration.ofMinutes(1));
        assertThat(reload(s).getNextRunAt()).isEqualTo(retry1);
        assertThat(reload(s).isEnabled()).isTrue();

        // Attempt 2 → +5m
        failingRunner.runDueSchedules(retry1, SyncScheduler.BATCH_LIMIT);
        Instant retry2 = retry1.plus(Duration.ofMinutes(5));
        assertThat(reload(s).getNextRunAt()).isEqualTo(retry2);

        // Attempt 3 → +25m
        failingRunner.runDueSchedules(retry2, SyncScheduler.BATCH_LIMIT);
        Instant retry3 = retry2.plus(Duration.ofMinutes(25));
        assertThat(reload(s).getNextRunAt()).isEqualTo(retry3);

        // Attempt 4 = max → accelerated retries stop; back to the normal cadence.
        failingRunner.runDueSchedules(retry3, SyncScheduler.BATCH_LIMIT);
        assertThat(reload(s).getNextRunAt()).isEqualTo(retry3.plus(Duration.ofMinutes(CADENCE_MINUTES)));

        // Each failed attempt recorded its planned retry on the job row.
        assertThat(syncJobs.count()).isEqualTo(4);
        assertThat(syncJobs.findAll()).allMatch(j -> "FAILED".equals(j.getStatus()));
    }

    @Test
    void repeatedFailuresEscalateToDegradedWithSingleAlert() {
        SellerAccount acc = account("GMARKET");
        intervalSchedule(acc, DataType.INQUIRY, now, true);
        SyncScheduleRunner failingRunner = runnerWith(alwaysFailing());

        failingRunner.runDueSchedules(now, SyncScheduler.BATCH_LIMIT);
        Instant t2 = now.plus(Duration.ofMinutes(1));
        failingRunner.runDueSchedules(t2, SyncScheduler.BATCH_LIMIT);
        // Two failures: not yet degraded, no alert.
        assertThat(connectionStatus.findBySellerAccountId(acc.getId()).orElseThrow().getState())
                .isEqualTo("CONNECTED");
        assertThat(alertsOfType(acc.getId(), "REPEATED_FAILURE")).isEmpty();

        // Third consecutive failure crosses the threshold.
        Instant t3 = t2.plus(Duration.ofMinutes(5));
        failingRunner.runDueSchedules(t3, SyncScheduler.BATCH_LIMIT);
        var health = connectionStatus.findBySellerAccountId(acc.getId()).orElseThrow();
        assertThat(health.getState()).isEqualTo("DEGRADED");
        assertThat(health.getConsecutiveFailures()).isEqualTo(3);
        List<ConnectorAlert> raised = alertsOfType(acc.getId(), "REPEATED_FAILURE");
        assertThat(raised).hasSize(1);
        assertThat(raised.get(0).getSeverity()).isEqualTo("WARNING");
        assertThat(raised.get(0).getSyncJobId()).isNotNull();

        // A fourth failure does not spam a second alert (already DEGRADED).
        Instant t4 = t3.plus(Duration.ofMinutes(25));
        failingRunner.runDueSchedules(t4, SyncScheduler.BATCH_LIMIT);
        assertThat(alertsOfType(acc.getId(), "REPEATED_FAILURE")).hasSize(1);
    }

    @Test
    void rateLimitedRunDefersRetryAndDoesNotImmediatelyRerun() {
        SellerAccount acc = account("GMARKET");
        SyncSchedule s = intervalSchedule(acc, DataType.INQUIRY, now, true);
        mock.setRateLimitAtOffset(0); // throttled before any data

        List<SyncJob> jobs = runner.runDueSchedules(now, SyncScheduler.BATCH_LIMIT);

        assertThat(jobs).hasSize(1);
        SyncJob job = jobs.get(0);
        assertThat(job.isRateLimited()).isTrue();
        // The mock's 5s retry-after hint is below the safety floor → floor wins.
        Instant deferred = now.plus(SyncScheduleRunner.MIN_RATE_LIMIT_DELAY);
        assertThat(reload(s).getNextRunAt()).isEqualTo(deferred);
        assertThat(job.getNextRetryAt()).isEqualTo(deferred);

        // No hammering: the schedule is no longer due now.
        assertThat(runner.runDueSchedules(now, SyncScheduler.BATCH_LIMIT)).isEmpty();
        assertThat(syncJobs.count()).isEqualTo(1);
    }

    @Test
    void repeatedRateLimitKeepsSingleAlertAndNeverEscalatesToDegraded() {
        SellerAccount acc = account("GMARKET");
        intervalSchedule(acc, DataType.INQUIRY, now, true);
        mock.setRateLimitAtOffset(0);

        runner.runDueSchedules(now, SyncScheduler.BATCH_LIMIT);
        assertThat(alertsOfType(acc.getId(), "RATE_LIMITED")).hasSize(1);

        // Still throttled at each deferred time — past the would-be DEGRADED
        // threshold: no duplicate open alert, and throttling alone never degrades.
        Instant t = now;
        for (int i = 0; i < 3; i++) {
            t = t.plus(SyncScheduleRunner.MIN_RATE_LIMIT_DELAY);
            runner.runDueSchedules(t, SyncScheduler.BATCH_LIMIT);
        }
        assertThat(syncJobs.count()).isEqualTo(4);
        assertThat(alertsOfType(acc.getId(), "RATE_LIMITED")).hasSize(1);
        assertThat(alertsOfType(acc.getId(), "REPEATED_FAILURE")).isEmpty();
        var health = connectionStatus.findBySellerAccountId(acc.getId()).orElseThrow();
        assertThat(health.getState()).isEqualTo("CONNECTED");
        assertThat(health.getConsecutiveFailures()).isZero();
    }

    @Test
    void midRunOperatorDisableIsNotOverwrittenByRunner() {
        SellerAccount acc = account("GMARKET");
        SyncSchedule s = intervalSchedule(acc, DataType.INQUIRY, now, true);

        // Connector that simulates an operator disabling the schedule while the
        // run is in flight — the runner must not resurrect it with a stale write.
        PullConnector editDuringRun = new PullConnector() {
            @Override
            public String kind() {
                return "MOCK_API";
            }

            @Override
            public ConnectorCapabilities capabilities(String channelCode) {
                return mock.capabilities(channelCode);
            }

            @Override
            public FetchPage fetch(FetchRequest request) {
                SyncSchedule live = schedules.findById(s.getId()).orElseThrow();
                live.setEnabled(false);
                live.setNextRunAt(null);
                schedules.save(live);
                return mock.fetch(request);
            }
        };

        runnerWith(editDuringRun).runDueSchedules(now, SyncScheduler.BATCH_LIMIT);

        SyncSchedule after = reload(s);
        assertThat(after.isEnabled()).isFalse(); // the operator's edit survives
        assertThat(after.getNextRunAt()).isNull(); // not overwritten with a cadence slot
        assertThat(after.getLastRunAt()).isEqualTo(now);
        assertThat(inquiries.count()).isEqualTo(45); // the in-flight run still landed
    }

    @Test
    void cronScheduleIsDeferredSafelyWithoutExecution() {
        SellerAccount acc = account("GMARKET");
        SyncSchedule s = new SyncSchedule();
        s.setOrgId(org);
        s.setSellerAccountId(acc.getId());
        s.setDataType(DataType.INQUIRY.name());
        s.setCadenceKind("CRON");
        s.setCronExpr("0 0 * * *");
        s.setEnabled(true);
        s.setNextRunAt(now);
        schedules.save(s);

        assertThat(runner.runDueSchedules(now, SyncScheduler.BATCH_LIMIT)).isEmpty();

        SyncSchedule after = reload(s);
        assertThat(after.isEnabled()).isFalse(); // paused, not spinning as ever-due
        assertThat(after.getPausedReason()).contains("CRON");
        assertThat(syncJobs.count()).isZero();
    }

    @Test
    void invalidIntervalScheduleIsPausedNotLooped() {
        SellerAccount acc = account("GMARKET");
        SyncSchedule s = intervalSchedule(acc, DataType.INQUIRY, now, true);
        s.setIntervalMinutes(null);
        schedules.save(s);

        assertThat(runner.runDueSchedules(now, SyncScheduler.BATCH_LIMIT)).isEmpty();

        SyncSchedule after = reload(s);
        assertThat(after.isEnabled()).isFalse();
        assertThat(after.getPausedReason()).isNotBlank();
        assertThat(syncJobs.count()).isZero();
    }
}
