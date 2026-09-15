package com.sellerops.responsibility;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.collect.SyncRunExecutor;
import com.sellerops.collect.SyncRunGate;
import com.sellerops.collect.SyncScheduleClaimer;
import com.sellerops.collect.SyncScheduleRunner;
import com.sellerops.common.ApiException;
import com.sellerops.community.Cafe24CommunityArticleRepository;
import com.sellerops.connector.ChannelConnectionStatusRepository;
import com.sellerops.connector.ConnectorAlertRepository;
import com.sellerops.connector.ConnectorAuthException;
import com.sellerops.connector.ConnectorCapabilities;
import com.sellerops.connector.ConnectorRegistry;
import com.sellerops.connector.ConnectorTimeoutException;
import com.sellerops.connector.DataType;
import com.sellerops.connector.FetchPage;
import com.sellerops.connector.FetchRequest;
import com.sellerops.connector.MockApiConnector;
import com.sellerops.connector.PullConnector;
import com.sellerops.ingest.IngestionService;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItemAuditRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItemRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItemWriter;
import com.sellerops.order.OrderDailySummaryRepository;
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
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Responsibility Runtime v1 — Package A invariants over real repositories (H2), the real
 * {@link SyncRunExecutor} with its single-flight gate and ingest, and a clock the test moves.
 *
 * <p>The only fake is the channel: a Cafe24-coded connector that delegates to the deterministic mock and can be
 * told to time out, reject authorization or fail per data type. Everything between «a window is due» and «this is
 * what was observed» is production code.
 *
 * <p>Not {@code @Transactional}: every step commits, as it does in the running system, so a crash can leave
 * exactly what a crash leaves. The races that need two database sessions are in
 * {@code ResponsibilityPostgresProofIT}.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
@Transactional(propagation = Propagation.NOT_SUPPORTED)
// Its own in-memory database. This class commits (a crash has to leave committed state behind), and the shared
// test database is reused by every cached context — committed channels, accounts and ingested rows would leak into
// suites that count them.
@TestPropertySource(properties =
        "spring.datasource.url=jdbc:h2:mem:responsibility_runtime;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1")
class ResponsibilityRuntimeTest {

    /** 21:41:59 KST — the open window is [20:00, 22:00) KST. In the past, so real sync-job timestamps follow it. */
    static final Instant BASE = Instant.parse("2026-01-10T12:41:59Z");
    static final Instant W20 = Instant.parse("2026-01-10T11:00:00Z");
    static final Instant W22 = Instant.parse("2026-01-10T13:00:00Z");
    static final Duration LEASE = Duration.ofMinutes(3);

    @Autowired SellerAccountRepository sellerAccounts;
    @Autowired ChannelRepository channels;
    @Autowired ReviewRepository reviews;
    @Autowired InquiryRepository inquiries;
    @Autowired OrderDailySummaryRepository orders;
    @Autowired ProductRepository products;
    @Autowired Cafe24CommunityArticleRepository communityArticles;
    @Autowired InquiryWorkItemRepository workItems;
    @Autowired InquiryWorkItemAuditRepository audits;
    @Autowired PlatformTransactionManager txManager;
    @Autowired com.sellerops.order.ChannelOrderRepository channelOrders;
    @Autowired com.sellerops.order.ChannelOrderStatusEventRepository channelOrderStatusEvents;
    @Autowired SyncJobRepository syncJobs;
    @Autowired SyncCursorRepository cursors;
    @Autowired ChannelConnectionStatusRepository connectionStatus;
    @Autowired SyncScheduleRepository schedules;
    @Autowired ConnectorAlertRepository alerts;
    @Autowired ResponsibilityRepository responsibilities;
    @Autowired ResponsibilityRunRepository runs;
    @Autowired ResponsibilityRunSourceRepository sourceRows;

    private MutableTestClock clock;
    private ScriptedCafe24 connector;
    private SyncRunExecutor executor;
    private SyncRunGate gate;
    private ResponsibilitySources sources;
    private ResponsibilitySourceObserver observer;
    private ResponsibilityService service;
    private ResponsibilityRunCoordinator coordinator;
    private UUID org;
    private final UUID user = UUID.randomUUID();
    private SellerAccount account;

    @BeforeEach
    void setUp() {
        clock = new MutableTestClock(BASE);
        connector = new ScriptedCafe24();
        ConnectorRegistry registry = new ConnectorRegistry(List.of(connector));
        IngestionService ingestion = new IngestionService(reviews, inquiries, orders, new ProductService(products),
                communityArticles, channels, new InquiryWorkItemWriter(inquiries, workItems, audits, txManager));
        com.sellerops.order.ChannelOrderIngestionService orderIngestion =
                new com.sellerops.order.ChannelOrderIngestionService(channelOrders, channelOrderStatusEvents, txManager);
        gate = new SyncRunGate(sellerAccounts, syncJobs, txManager, 60);
        executor = new SyncRunExecutor(sellerAccounts, channels, registry, ingestion, orderIngestion, syncJobs,
                cursors, connectionStatus, null, null, null, null, gate);
        sources = new ResponsibilitySources(sellerAccounts, channels);
        observer = new ResponsibilitySourceObserver(executor, sellerAccounts, syncJobs, cursors,
                Duration.ofSeconds(3), Duration.ofMillis(50));
        service = new ResponsibilityService(responsibilities, runs, sourceRows, sources, txManager, clock);
        coordinator = coordinator();
        org = UUID.randomUUID();
        account = cafe24Account(org);
    }

    @AfterEach
    void cleanUp() {
        sourceRows.deleteAll();
        runs.deleteAll();
        responsibilities.deleteAll();
    }

    // ── activation ──────────────────────────────────────────────────────────────────────────────────────────

    @Test
    void activationCreatesTheInitialRunForTheOpenWindow_once() {
        service.activate(org, user);

        Responsibility r = responsibility();
        assertThat(r.getStatus()).isEqualTo(ResponsibilityStatus.ACTIVE);
        assertThat(r.getNextRunAt()).isEqualTo(W22);
        List<ResponsibilityRun> all = runsOf();
        assertThat(all).hasSize(1);
        assertThat(all.get(0).getWindowStart()).isEqualTo(W20);
        assertThat(all.get(0).getRunTrigger()).isEqualTo(RunTrigger.ACTIVATION);
        assertThat(all.get(0).getStatus()).isEqualTo(RunStatus.PENDING);

        service.activate(org, user); // duplicate press
        assertThat(runsOf()).hasSize(1);
        assertThat(responsibility().getNextRunAt()).isEqualTo(W22);
    }

    @Test
    void activationWithoutACafe24ApiAccountIsRefused() {
        UUID empty = UUID.randomUUID();
        assertThatThrownBy(() -> service.activate(empty, user)).isInstanceOf(ApiException.class);
        assertThat(responsibilities.findByOrgIdAndTemplateCode(empty, ResponsibilityTemplate.CUSTOMER_OPERATIONS_V1))
                .isEmpty();
    }

    // ── observation through the existing acquisition ────────────────────────────────────────────────────────

    @Test
    void theInitialRunObservesBothSourcesThroughTheExistingAcquisition() {
        service.activate(org, user);
        coordinator.tick();

        ResponsibilityRun run = runsOf().get(0);
        assertThat(run.getStatus()).isEqualTo(RunStatus.SUCCESS);
        assertThat(run.getAttempt()).isEqualTo(1);
        assertThat(run.getLeaseOwner()).isNull();
        assertThat(run.getFinishedAt()).isNotNull();

        ResponsibilityRunSource inquiry = latest(run, DataType.INQUIRY);
        assertThat(inquiry.getCompleteness()).isEqualTo(SourceCompleteness.COMPLETE);
        assertThat(inquiry.getObservedCount()).isEqualTo(45);
        assertThat(inquiry.getNewCount()).isNotNull();
        assertThat(inquiry.getFailureReason()).isNull();
        assertThat(inquiry.getRecipeVersion()).isEqualTo(ScriptedCafe24.KIND);
        assertThat(inquiry.getIdentityVerdict()).isEqualTo(IdentityVerdict.NOT_APPLICABLE);
        assertThat(inquiry.getWindowFrom()).isEqualTo(W20);
        assertThat(inquiry.getWindowTo()).isEqualTo(W22);
        assertThat(inquiry.getCursorTo()).isEqualTo("45");
        assertThat(inquiry.getSyncJobId()).isNotNull();
        assertThat(syncJobs.findById(inquiry.getSyncJobId()).orElseThrow().getTrigger())
                .isEqualTo(ResponsibilitySourceObserver.SYNC_TRIGGER);

        ResponsibilityRunSource review = latest(run, DataType.REVIEW);
        assertThat(review.getCompleteness()).isEqualTo(SourceCompleteness.COMPLETE);
        assertThat(review.getObservedCount()).isEqualTo(60);
    }

    @Test
    void theNextWindowRunsAtItsBoundary_withARealZero_andRepeatedTicksCreateNothing() {
        service.activate(org, user);
        coordinator.tick();

        clock.set(W22.plusSeconds(20));
        coordinator.tick();
        coordinator.tick();
        coordinator.tick();

        List<ResponsibilityRun> all = runsOf();
        assertThat(all).hasSize(2);
        ResponsibilityRun scheduled = all.get(1);
        assertThat(scheduled.getWindowStart()).isEqualTo(W22);
        assertThat(scheduled.getRunTrigger()).isEqualTo(RunTrigger.SCHEDULED);
        assertThat(scheduled.getStatus()).isEqualTo(RunStatus.SUCCESS);
        ResponsibilityRunSource inquiry = latest(scheduled, DataType.INQUIRY);
        assertThat(inquiry.getCompleteness()).isEqualTo(SourceCompleteness.COMPLETE);
        assertThat(inquiry.getObservedCount()).isZero();
        assertThat(inquiry.getNewCount()).isZero();
        assertThat(inquiry.getFailureReason()).isNull();
        // one collection per window per source — never a second read of the same window
        assertThat(jobsFor(DataType.INQUIRY)).hasSize(2);
        assertThat(responsibility().getNextRunAt()).isEqualTo(W22.plus(Duration.ofHours(2)));
    }

    @Test
    void aRestartedSchedulerKeepsTheSameNextWindow() {
        service.activate(org, user);
        coordinator.tick();

        ResponsibilityRunCoordinator restarted = coordinator(); // a new process: new owner, nothing in memory
        clock.set(W22.minusSeconds(1));
        restarted.tick();
        assertThat(runsOf()).hasSize(1);

        clock.set(W22);
        restarted.tick();
        assertThat(runsOf()).extracting(ResponsibilityRun::getWindowStart).containsExactly(W20, W22);
    }

    @Test
    void windowsThatPassedWhileNothingRanAreRecordedMissed_notSilentlySkipped_notBackfilled() {
        service.activate(org, user);
        coordinator.tick();

        Instant w00 = W22.plus(Duration.ofHours(2));
        Instant w02 = W22.plus(Duration.ofHours(4));
        clock.set(w02.plusSeconds(30)); // the scheduler was down across 22:00 and 00:00
        coordinator.tick();

        List<ResponsibilityRun> all = runsOf();
        assertThat(all).extracting(ResponsibilityRun::getWindowStart).containsExactly(W20, W22, w00, w02);
        assertThat(all.get(1).getStatus()).isEqualTo(RunStatus.CANCELLED);
        assertThat(all.get(1).getFailureReason()).isEqualTo(RunFailureReason.MISSED);
        assertThat(all.get(2).getStatus()).isEqualTo(RunStatus.CANCELLED);
        assertThat(all.get(2).getFailureReason()).isEqualTo(RunFailureReason.MISSED);
        assertThat(sourceRows.findByRunIdOrderByAttemptAscCreatedAtAsc(all.get(1).getId())).isEmpty();
        assertThat(all.get(3).getStatus()).isEqualTo(RunStatus.SUCCESS);
        assertThat(jobsFor(DataType.INQUIRY)).hasSize(2);
    }

    // ── partial / failed / retry ────────────────────────────────────────────────────────────────────────────

    @Test
    void oneSourceFailingIsPartial_andTheRetryIsTheSameRunCollectingOnlyWhatWasMissing() {
        connector.modes.put(DataType.INQUIRY, ScriptedCafe24.Mode.TIMEOUT);
        service.activate(org, user);
        coordinator.tick();

        ResponsibilityRun run = runsOf().get(0);
        assertThat(run.getStatus()).isEqualTo(RunStatus.PARTIAL);
        assertThat(run.getNextAttemptAt()).isEqualTo(BASE.plus(Duration.ofMinutes(10)));
        ResponsibilityRunSource failed = latest(run, DataType.INQUIRY);
        assertThat(failed.getCompleteness()).isEqualTo(SourceCompleteness.NONE);
        assertThat(failed.getFailureReason()).isEqualTo(SourceFailureReason.TIMEOUT);
        assertThat(failed.getObservedCount()).isNull();
        assertThat(failed.getNewCount()).isNull();
        assertThat(latest(run, DataType.REVIEW).getCompleteness()).isEqualTo(SourceCompleteness.COMPLETE);

        connector.modes.remove(DataType.INQUIRY);
        clock.set(BASE.plus(Duration.ofMinutes(10)).plusSeconds(1));
        coordinator.tick();

        assertThat(runsOf()).hasSize(1);
        ResponsibilityRun retried = runsOf().get(0);
        assertThat(retried.getId()).isEqualTo(run.getId());
        assertThat(retried.getAttempt()).isEqualTo(2);
        assertThat(retried.getStatus()).isEqualTo(RunStatus.SUCCESS);
        assertThat(retried.getNextAttemptAt()).isNull();
        assertThat(rows(retried, DataType.INQUIRY)).extracting(ResponsibilityRunSource::getCompleteness)
                .containsExactly(SourceCompleteness.NONE, SourceCompleteness.COMPLETE);
        assertThat(rows(retried, DataType.REVIEW)).hasSize(1); // settled at attempt 1, not collected again
        assertThat(jobsFor(DataType.REVIEW)).hasSize(1);
    }

    @Test
    void everySourceFailingIsFailed_andAnAuthorizationFailureIsNeverAZero() {
        connector.modes.put(DataType.INQUIRY, ScriptedCafe24.Mode.AUTH);
        connector.modes.put(DataType.REVIEW, ScriptedCafe24.Mode.AUTH);
        service.activate(org, user);
        coordinator.tick();

        ResponsibilityRun run = runsOf().get(0);
        assertThat(run.getStatus()).isEqualTo(RunStatus.FAILED);
        for (DataType type : List.of(DataType.INQUIRY, DataType.REVIEW)) {
            ResponsibilityRunSource row = latest(run, type);
            assertThat(row.getCompleteness()).isEqualTo(SourceCompleteness.NONE);
            assertThat(row.getFailureReason()).isEqualTo(SourceFailureReason.AUTH_REQUIRED);
            assertThat(row.getObservedCount()).isNull();
            assertThat(row.getNewCount()).isNull();
            assertThat(row.getChangedCount()).isNull();
        }
        // re-asking a channel that refused authorization changes nothing within the window
        assertThat(run.getNextAttemptAt()).isNull();
    }

    // ── crash recovery ──────────────────────────────────────────────────────────────────────────────────────

    @Test
    void aCrashedHolderLosesTheRunToTheNextTick_whichFinishesTheSameRunWithoutCollectingTwice() {
        service.activate(org, user);
        ResponsibilityRunCoordinator dead = coordinator();
        ResponsibilityRun claimed = dead.claimNext(Set.of()).orElseThrow();
        // The holder had begun INQUIRY when the process died: an open observation and the sync job it started.
        ResponsibilityRunSource open = ResponsibilityRunSource.open(claimed,
                new ResponsibilitySources.ResolvedSource(account, "CAFE24", DataType.INQUIRY), clock.instant());
        sourceRows.saveAndFlush(open);
        SyncJob orphan = runningJob(DataType.INQUIRY, ResponsibilitySourceObserver.SYNC_TRIGGER);

        ResponsibilityRunCoordinator next = coordinator();
        assertThat(next.claimNext(Set.of())).as("a live lease is not claimable").isEmpty();

        clock.set(BASE.plus(LEASE).plusSeconds(1));
        next.tick();

        assertThat(runsOf()).hasSize(1);
        ResponsibilityRun recovered = runs.findById(claimed.getId()).orElseThrow();
        assertThat(recovered.getAttempt()).isEqualTo(2);
        assertThat(recovered.getStatus()).isEqualTo(RunStatus.SUCCESS);
        assertThat(syncJobs.findById(orphan.getId()).orElseThrow().getStatus()).isEqualTo("FAILED");
        List<ResponsibilityRunSource> inquiry = rows(recovered, DataType.INQUIRY);
        assertThat(inquiry).extracting(ResponsibilityRunSource::getCompleteness)
                .containsExactly(SourceCompleteness.NONE, SourceCompleteness.COMPLETE);
        assertThat(inquiry.get(0).getFailureReason()).isEqualTo(SourceFailureReason.INTERRUPTED);
        assertThat(inquiry.get(0).getSyncJobId()).isEqualTo(orphan.getId());
        assertThat(rows(recovered, DataType.REVIEW)).extracting(ResponsibilityRunSource::getAttempt)
                .containsExactly(2);

        // the dead holder, were it to wake, can no longer write to the run
        Instant finishedAt = recovered.getFinishedAt();
        dead.finish(claimed.getId(), null, List.of());
        ResponsibilityRun after = runs.findById(claimed.getId()).orElseThrow();
        assertThat(after.getStatus()).isEqualTo(RunStatus.SUCCESS);
        assertThat(after.getAttempt()).isEqualTo(2);
        assertThat(after.getFinishedAt()).isEqualTo(finishedAt);
    }

    @Test
    void aCrashAfterTheReadFinishedAdoptsThatRead_insteadOfReadingAgain() {
        service.activate(org, user);
        ResponsibilityRunCoordinator dead = coordinator();
        ResponsibilityRun claimed = dead.claimNext(Set.of()).orElseThrow();
        ResponsibilityRunSource open = ResponsibilityRunSource.open(claimed,
                new ResponsibilitySources.ResolvedSource(account, "CAFE24", DataType.INQUIRY), clock.instant());
        sourceRows.saveAndFlush(open);
        SyncJob finished = runningJob(DataType.INQUIRY, ResponsibilitySourceObserver.SYNC_TRIGGER);
        finished.setStatus("SUCCESS");
        finished.setSuccessRows(45);
        finished.setTotalRows(45);
        finished.setFinishedAt(Instant.now());
        syncJobs.saveAndFlush(finished);

        clock.set(BASE.plus(LEASE).plusSeconds(1));
        coordinator.tick();

        ResponsibilityRun recovered = runs.findById(claimed.getId()).orElseThrow();
        assertThat(recovered.getStatus()).isEqualTo(RunStatus.SUCCESS);
        List<ResponsibilityRunSource> inquiry = rows(recovered, DataType.INQUIRY);
        assertThat(inquiry).hasSize(1);
        assertThat(inquiry.get(0).getCompleteness()).isEqualTo(SourceCompleteness.COMPLETE);
        assertThat(inquiry.get(0).getObservedCount()).isEqualTo(45);
        assertThat(inquiry.get(0).getNewCount()).as("not measured by this runtime").isNull();
        assertThat(jobsFor(DataType.INQUIRY)).hasSize(1);
    }

    // ── pause / stop ────────────────────────────────────────────────────────────────────────────────────────

    @Test
    void aPausedResponsibilityCreatesNoRun_andResumeWorksTheOpenWindow() {
        service.activate(org, user);
        coordinator.tick();
        service.pause(org);
        assertThat(responsibility().getStatus()).isEqualTo(ResponsibilityStatus.PAUSED);
        assertThat(responsibility().getNextRunAt()).isNull();

        clock.set(W22.plusSeconds(10));
        coordinator.tick();
        Instant w00 = W22.plus(Duration.ofHours(2));
        clock.set(w00.plusSeconds(10));
        coordinator.tick();
        assertThat(runsOf()).hasSize(1);

        service.resume(org);
        List<ResponsibilityRun> all = runsOf();
        assertThat(all).extracting(ResponsibilityRun::getWindowStart).containsExactly(W20, w00);
        assertThat(all.get(1).getRunTrigger()).isEqualTo(RunTrigger.RESUME);
        coordinator.tick();
        assertThat(runsOf().get(1).getStatus()).isEqualTo(RunStatus.SUCCESS);
    }

    @Test
    void pausingBeforeTheQueuedRunStartsCancelsIt_andResumeReopensTheSameRun() {
        service.activate(org, user);
        service.pause(org);
        ResponsibilityRun cancelled = runsOf().get(0);
        assertThat(cancelled.getStatus()).isEqualTo(RunStatus.CANCELLED);
        assertThat(cancelled.getFailureReason()).isEqualTo(RunFailureReason.RESPONSIBILITY_PAUSED);

        coordinator.tick();
        assertThat(jobsFor(DataType.INQUIRY)).isEmpty();

        service.resume(org);
        assertThat(runsOf()).hasSize(1);
        assertThat(runsOf().get(0).getId()).isEqualTo(cancelled.getId());
        coordinator.tick();
        assertThat(runsOf().get(0).getStatus()).isEqualTo(RunStatus.SUCCESS);
    }

    @Test
    void aStoppedResponsibilityCreatesNoRun_untilItIsActivatedAgain() {
        service.activate(org, user);
        coordinator.tick();
        service.stop(org);

        clock.set(W22.plusSeconds(10));
        coordinator.tick();
        assertThat(runsOf()).hasSize(1);
        assertThatThrownBy(() -> service.resume(org)).isInstanceOf(ApiException.class);

        service.activate(org, user);
        assertThat(runsOf()).extracting(ResponsibilityRun::getRunTrigger)
                .containsExactly(RunTrigger.ACTIVATION, RunTrigger.ACTIVATION);
        coordinator.tick();
        assertThat(runsOf().get(1).getStatus()).isEqualTo(RunStatus.SUCCESS);
    }

    // ── single ownership of collection ──────────────────────────────────────────────────────────────────────

    @Test
    void aCollectionAlreadyInFlightIsAdopted_notStartedASecondTime() throws Exception {
        service.activate(org, user);
        SyncJob manual = runningJob(DataType.INQUIRY, "MANUAL");
        Thread finisher = new Thread(() -> {
            try {
                Thread.sleep(300);
            } catch (InterruptedException ignored) {
                Thread.currentThread().interrupt();
            }
            SyncJob j = syncJobs.findById(manual.getId()).orElseThrow();
            j.setStatus("SUCCESS");
            j.setSuccessRows(7);
            j.setTotalRows(7);
            j.setFinishedAt(Instant.now());
            syncJobs.save(j);
        });
        finisher.start();
        coordinator.tick();
        finisher.join();

        ResponsibilityRunSource inquiry = latest(runsOf().get(0), DataType.INQUIRY);
        assertThat(inquiry.getCompleteness()).isEqualTo(SourceCompleteness.COMPLETE);
        assertThat(inquiry.getObservedCount()).isEqualTo(7);
        assertThat(inquiry.getNewCount()).isNull();
        assertThat(inquiry.getSyncJobId()).isEqualTo(manual.getId());
        assertThat(jobsFor(DataType.INQUIRY)).isEmpty();
    }

    @Test
    void theCollectionSchedulerDefersSourcesAnActiveResponsibilityOwns() {
        SyncScheduleRunner runner = new SyncScheduleRunner(new SyncScheduleClaimer(schedules), executor, schedules,
                syncJobs, connectionStatus, alerts,
                new ResponsibilitySourceOwnership(responsibilities, sellerAccounts, channels));
        Instant now = Instant.now().truncatedTo(ChronoUnit.MICROS);
        SyncSchedule inquirySchedule = schedule(DataType.INQUIRY, now);
        schedule(DataType.ORDER_SUMMARY, now);
        service.activate(org, user);

        List<SyncJob> ran = runner.runDueSchedules(now, 20);
        assertThat(ran).extracting(SyncJob::getDataType).containsExactly("ORDER_SUMMARY");

        service.pause(org);
        SyncSchedule s = schedules.findById(inquirySchedule.getId()).orElseThrow();
        s.setNextRunAt(now);
        schedules.save(s);
        List<SyncJob> afterPause = runner.runDueSchedules(now, 20);
        assertThat(afterPause).extracting(SyncJob::getDataType).containsExactly("INQUIRY");
    }

    // ── helpers ─────────────────────────────────────────────────────────────────────────────────────────────

    private ResponsibilityRunCoordinator coordinator() {
        return new ResponsibilityRunCoordinator(responsibilities, runs, sourceRows, sources, observer, gate,
                sellerAccounts, txManager, clock, LEASE, Duration.ZERO);
    }

    private Responsibility responsibility() {
        return responsibilities.findByOrgIdAndTemplateCode(org, ResponsibilityTemplate.CUSTOMER_OPERATIONS_V1)
                .orElseThrow();
    }

    private List<ResponsibilityRun> runsOf() {
        return runs.findByResponsibilityIdOrderByWindowStartAsc(responsibility().getId());
    }

    private List<ResponsibilityRunSource> rows(ResponsibilityRun run, DataType type) {
        return sourceRows.findByRunIdOrderByAttemptAscCreatedAtAsc(run.getId()).stream()
                .filter(r -> r.getDataType().equals(type.name()))
                .toList();
    }

    private ResponsibilityRunSource latest(ResponsibilityRun run, DataType type) {
        List<ResponsibilityRunSource> all = rows(run, type);
        return all.get(all.size() - 1);
    }

    private List<SyncJob> jobsFor(DataType type) {
        return sourceRows.findTriggeredSyncJobsSince(account.getId(), type.name(),
                ResponsibilitySourceObserver.SYNC_TRIGGER, Instant.EPOCH);
    }

    private SyncJob runningJob(DataType type, String trigger) {
        SyncJob job = new SyncJob();
        job.setOrgId(org);
        job.setSellerAccountId(account.getId());
        job.setChannelId(account.getChannelId());
        job.setDataType(type.name());
        job.setJobType(ScriptedCafe24.KIND);
        job.setTrigger(trigger);
        job.setStatus("RUNNING");
        job.setStartedAt(Instant.now());
        return syncJobs.saveAndFlush(job);
    }

    private SyncSchedule schedule(DataType type, Instant due) {
        SyncSchedule s = new SyncSchedule();
        s.setOrgId(org);
        s.setSellerAccountId(account.getId());
        s.setDataType(type.name());
        s.setCadenceKind("INTERVAL");
        s.setIntervalMinutes(60);
        s.setEnabled(true);
        s.setNextRunAt(due);
        return schedules.save(s);
    }

    private SellerAccount cafe24Account(UUID orgId) {
        Channel ch = channels.findByCode("CAFE24").orElseGet(() -> {
            Channel c = new Channel();
            c.setCode("CAFE24");
            c.setNameKo("카페24");
            c.setStatus(ChannelStatus.AVAILABLE);
            c.setSupportsInquiry(true);
            c.setSupportsReview(true);
            c.setSupportsOrder(true);
            c.setSupportsSales(true);
            c.setSupportsProduct(true);
            c.setSortOrder(0);
            return channels.save(c);
        });
        SellerAccount a = new SellerAccount();
        a.setOrgId(orgId);
        a.setChannelId(ch.getId());
        a.setConnectionStatus(ChannelStatus.CONNECTED);
        a.setFileUpload(false);
        return sellerAccounts.save(a);
    }

    /** A Cafe24-coded channel over the deterministic mock, told per data type how to behave. */
    static final class ScriptedCafe24 implements PullConnector {
        static final String KIND = "CAFE24_API_TEST";

        enum Mode { OK, TIMEOUT, AUTH, FAIL }

        final MockApiConnector mock = new MockApiConnector();
        final Map<DataType, Mode> modes = new ConcurrentHashMap<>();

        @Override
        public String kind() {
            return KIND;
        }

        @Override
        public ConnectorCapabilities capabilities(String channelCode) {
            return mock.capabilities(channelCode);
        }

        @Override
        public FetchPage fetch(FetchRequest request) {
            return switch (modes.getOrDefault(request.dataType(), Mode.OK)) {
                case TIMEOUT -> throw new ConnectorTimeoutException("시간 초과 (테스트)");
                case AUTH -> throw new ConnectorAuthException("카페24", ConnectorAuthException.Cause.REFRESH_TOKEN_REVOKED);
                case FAIL -> throw new IllegalStateException("장애 (테스트)");
                case OK -> mock.fetch(request);
            };
        }
    }
}
