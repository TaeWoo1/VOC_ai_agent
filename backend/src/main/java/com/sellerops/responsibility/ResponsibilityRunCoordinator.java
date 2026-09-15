package com.sellerops.responsibility;

import com.sellerops.channel.ChannelStatus;
import com.sellerops.collect.SyncRunGate;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import com.sellerops.sync.SyncJob;
import jakarta.annotation.PreDestroy;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Turns windows into worked runs. One tick does two things, each restart-safe because every decision is re-read
 * from the database:
 *
 * <ol>
 *   <li><b>Materialize.</b> For each ACTIVE responsibility whose {@code next_run_at} has begun, create the run of
 *   every window from {@code next_run_at} up to now (unique per window — R1). A window that has already ENDED
 *   was never worked: it is written as {@code CANCELLED · MISSED}, visible, and not back-filled as if it had
 *   been. The window that is open now is {@code PENDING}.</li>
 *   <li><b>Claim and execute.</b> Take the oldest claimable run — queued, abandoned by an expired lease, or due
 *   for a retry — under {@code SKIP LOCKED}, mark it RUNNING with this instance as lease owner, and work its
 *   sources through the existing acquisition.</li>
 * </ol>
 *
 * <h2>Why a lease, and not the collection scheduler's claim</h2>
 * {@code SyncScheduleClaimer} commits the claim before running and documents the trade-off: a crash between
 * claim and run loses that occurrence (at-most-once). For a responsibility that is exactly the silent skip the
 * product may not have. Here the claim is a lease that the holder renews by heartbeat; a crashed holder stops
 * renewing, the lease passes, and the next tick reclaims <b>the same run row</b> with {@code attempt + 1}.
 * Settled sources are not re-executed; an observation the dead attempt left unfinished is recovered — its sync
 * job adopted if it finished, closed as an orphan if not — and then observed again.
 *
 * <h2>Fencing</h2>
 * Every write to a RUNNING run and its source rows first checks that this instance still holds the lease. A
 * holder that was merely slow (its lease reclaimed) finds it lost and stops; it cannot finish a run someone
 * else now owns. The partial unique index {@code uq_responsibility_run_active} makes two RUNNING runs of one
 * responsibility impossible regardless of what any instance believes (R2).
 */
@Component
public class ResponsibilityRunCoordinator {

    private static final Logger log = LoggerFactory.getLogger(ResponsibilityRunCoordinator.class);

    static final int MAX_WINDOWS_PER_RESPONSIBILITY_PER_TICK = 100;
    static final int MAX_RUNS_PER_TICK = 20;
    static final int CLAIM_SCAN = 50;
    /** First attempt plus two retries inside the same window. */
    static final int MAX_ATTEMPTS = 3;
    static final Duration[] RETRY_BACKOFF = {Duration.ofMinutes(10), Duration.ofMinutes(30)};
    static final String ORPHAN_JOB_MESSAGE = "이 수집을 맡았던 실행이 중간에 멈춰 정리되었습니다.";

    public record TickReport(int runsMaterialized, int windowsMissed, int runsExecuted) {
    }

    private final ResponsibilityRepository responsibilities;
    private final ResponsibilityRunRepository runs;
    private final ResponsibilityRunSourceRepository sourceRows;
    private final ResponsibilitySources sources;
    private final ResponsibilitySourceObserver observer;
    private final SyncRunGate runGate;
    private final SellerAccountRepository accounts;
    private final TransactionTemplate tx;
    private final Clock clock;
    private final Duration lease;
    private final Duration heartbeat;
    private final String owner = "rr-" + UUID.randomUUID();
    private volatile ScheduledExecutorService heartbeatPool;

    @Autowired
    public ResponsibilityRunCoordinator(ResponsibilityRepository responsibilities, ResponsibilityRunRepository runs,
                                        ResponsibilityRunSourceRepository sourceRows, ResponsibilitySources sources,
                                        ResponsibilitySourceObserver observer, SyncRunGate runGate,
                                        SellerAccountRepository accounts, PlatformTransactionManager txManager,
                                        @Value("${sellerops.responsibility.lease-seconds:180}") long leaseSeconds,
                                        @Value("${sellerops.responsibility.heartbeat-seconds:30}") long heartbeatSeconds) {
        this(responsibilities, runs, sourceRows, sources, observer, runGate, accounts, txManager, Clock.systemUTC(),
                Duration.ofSeconds(leaseSeconds), Duration.ofSeconds(heartbeatSeconds));
    }

    public ResponsibilityRunCoordinator(ResponsibilityRepository responsibilities, ResponsibilityRunRepository runs,
                                        ResponsibilityRunSourceRepository sourceRows, ResponsibilitySources sources,
                                        ResponsibilitySourceObserver observer, SyncRunGate runGate,
                                        SellerAccountRepository accounts, PlatformTransactionManager txManager,
                                        Clock clock, Duration lease, Duration heartbeat) {
        if (lease.isNegative() || lease.isZero()) {
            throw new IllegalStateException("sellerops.responsibility.lease-seconds는 1 이상이어야 합니다.");
        }
        if (!heartbeat.isZero() && heartbeat.compareTo(lease) >= 0) {
            throw new IllegalStateException(
                    "sellerops.responsibility.heartbeat-seconds는 lease-seconds보다 짧아야 합니다.");
        }
        this.responsibilities = responsibilities;
        this.runs = runs;
        this.sourceRows = sourceRows;
        this.sources = sources;
        this.observer = observer;
        this.runGate = runGate;
        this.accounts = accounts;
        this.tx = new TransactionTemplate(txManager);
        this.clock = clock;
        this.lease = lease;
        this.heartbeat = heartbeat;
    }

    public String owner() {
        return owner;
    }

    public TickReport tick() {
        int[] materialized = materializeDue();
        int executed = 0;
        Set<UUID> claimedThisTick = new HashSet<>();
        while (executed < MAX_RUNS_PER_TICK) {
            Optional<ResponsibilityRun> claimed;
            try {
                claimed = claimNext(claimedThisTick);
            } catch (DataIntegrityViolationException raceLost) {
                // Another instance claimed a run of the same responsibility between our read and our write; the
                // partial unique index refused ours. Nothing was changed. The next tick looks again.
                log.info("responsibility: claim 경합에서 다른 인스턴스가 먼저 잡았습니다");
                break;
            }
            if (claimed.isEmpty()) {
                break;
            }
            claimedThisTick.add(claimed.get().getResponsibilityId());
            execute(claimed.get().getId());
            executed++;
        }
        if (materialized[0] + materialized[1] + executed > 0) {
            log.info("responsibility: tick 생성={} 놓친창={} 실행={}", materialized[0], materialized[1], executed);
        }
        return new TickReport(materialized[0], materialized[1], executed);
    }

    // ── materialize ─────────────────────────────────────────────────────────────────────────────────────────

    int[] materializeDue() {
        Instant now = now();
        int[] counts = tx.execute(status -> {
            int created = 0;
            int missed = 0;
            for (Responsibility r : responsibilities.lockDueActive(now, CLAIM_SCAN)) {
                Instant window = ResponsibilityWindows.slotStart(r.getNextRunAt());
                int steps = 0;
                while (!window.isAfter(now) && steps++ < MAX_WINDOWS_PER_RESPONSIBILITY_PER_TICK) {
                    if (runs.findByResponsibilityIdAndWindowStart(r.getId(), window).isEmpty()) {
                        ResponsibilityRun run = ResponsibilityRun.materialized(r, window, RunTrigger.SCHEDULED);
                        if (!run.getWindowEnd().isAfter(now)) {
                            run.cancel(RunFailureReason.MISSED, now);
                            missed++;
                        } else {
                            created++;
                        }
                        runs.save(run);
                    }
                    window = ResponsibilityWindows.slotEnd(window);
                }
                r.setNextRunAt(window);
                responsibilities.save(r);
            }
            return new int[] {created, missed};
        });
        return counts == null ? new int[] {0, 0} : counts;
    }

    // ── claim ───────────────────────────────────────────────────────────────────────────────────────────────

    Optional<ResponsibilityRun> claimNext(Set<UUID> skipResponsibilities) {
        Instant now = now();
        Optional<ResponsibilityRun> claimed = tx.execute(status -> {
            for (ResponsibilityRun run : runs.lockClaimable(now, CLAIM_SCAN)) {
                if (skipResponsibilities.contains(run.getResponsibilityId())) {
                    continue;
                }
                Responsibility responsibility = responsibilities.findById(run.getResponsibilityId()).orElse(null);
                if (responsibility == null) {
                    continue;
                }
                if (responsibility.getStatus() != ResponsibilityStatus.ACTIVE) {
                    retire(run, reasonFor(responsibility.getStatus()), now);
                    continue;
                }
                boolean windowOpen = run.getWindowEnd().isAfter(now);
                if (run.getStatus() == RunStatus.PENDING && !windowOpen) {
                    // Queued but never started, and its window is over: recorded as missed, not worked late.
                    run.cancel(RunFailureReason.MISSED, now);
                    runs.save(run);
                    continue;
                }
                if ((run.getStatus() == RunStatus.PARTIAL || run.getStatus() == RunStatus.FAILED) && !windowOpen) {
                    // A retry that would land after its window: the next window's run collects instead.
                    run.setNextAttemptAt(null);
                    runs.save(run);
                    continue;
                }
                // A RUNNING run whose lease expired is reclaimed even if its window has ended: work that started is
                // finished, and the recovery below keeps it from collecting twice.
                if (runs.existsLiveRunningOther(run.getResponsibilityId(), run.getId(), now)) {
                    continue;
                }
                run.claim(owner, now, now.plus(lease));
                runs.saveAndFlush(run);
                return Optional.of(run);
            }
            return Optional.<ResponsibilityRun>empty();
        });
        return claimed == null ? Optional.empty() : claimed;
    }

    private void retire(ResponsibilityRun run, RunFailureReason reason, Instant now) {
        if (run.getStatus() == RunStatus.PENDING || run.getStatus() == RunStatus.RUNNING) {
            for (ResponsibilityRunSource row : sourceRows.findByRunIdOrderByAttemptAscCreatedAtAsc(run.getId())) {
                if (row.getCompleteness() == null) {
                    row.record(SourceObservation.none(SourceFailureReason.CANCELLED, null, null));
                    sourceRows.save(row);
                }
            }
            run.cancel(reason, now);
        } else {
            run.setNextAttemptAt(null);
        }
        runs.save(run);
    }

    // ── execute ─────────────────────────────────────────────────────────────────────────────────────────────

    void execute(UUID runId) {
        Heartbeat beat = startHeartbeat(runId);
        List<ResponsibilitySources.ResolvedSource> required = List.of();
        try {
            ResponsibilityRun run = runs.findById(runId).orElseThrow();
            Responsibility responsibility = responsibilities.findById(run.getResponsibilityId()).orElseThrow();
            required = sources.resolve(run.getOrgId(), responsibility.getTemplateCode());
            if (required.isEmpty()) {
                finish(runId, RunFailureReason.NO_REQUIRED_SOURCE, required);
                return;
            }
            for (ResponsibilitySources.ResolvedSource source : required) {
                if (beat.lost()) {
                    log.warn("responsibility: run {} lease를 잃어 실행을 멈춥니다", runId);
                    return;
                }
                ResponsibilityStatus current = responsibilities.findById(run.getResponsibilityId())
                        .map(Responsibility::getStatus).orElse(ResponsibilityStatus.STOPPED);
                if (current != ResponsibilityStatus.ACTIVE) {
                    cancelHeld(runId, reasonFor(current));
                    return;
                }
                if (!observeSource(run, source)) {
                    log.warn("responsibility: run {} 소유권이 넘어가 실행을 멈춥니다", runId);
                    return;
                }
            }
            finish(runId, null, required);
        } catch (RuntimeException e) {
            log.warn("responsibility: run {} 실행 중 예외 {}", runId, e.getClass().getSimpleName());
            try {
                finish(runId, null, required);
            } catch (RuntimeException ignored) {
                // The lease expires and the run is reclaimed; nothing else to do here.
            }
        } finally {
            beat.stop();
        }
    }

    /** @return false when this instance no longer holds the run. */
    private boolean observeSource(ResponsibilityRun run, ResponsibilitySources.ResolvedSource source) {
        String dataType = source.dataType().name();
        List<ResponsibilityRunSource> history = sourceRows
                .findByRunIdAndSellerAccountIdAndDataTypeOrderByAttemptDesc(run.getId(), source.account().getId(),
                        dataType);
        ResponsibilityRunSource latest = history.isEmpty() ? null : history.get(0);
        if (latest != null && latest.getCompleteness() == null && latest.getAttempt() < currentAttempt(run.getId())) {
            if (!recoverInterrupted(run.getId(), latest)) {
                return false;
            }
        }
        if (latest != null && latest.getCompleteness() != null && latest.getCompleteness().settled()) {
            return true; // R6: a settled source is not collected again in the same window
        }
        ResponsibilityRun held = runs.findById(run.getId()).orElse(null);
        if (held == null || !held.heldBy(owner)) {
            return false;
        }
        ResponsibilityRunSource row = ResponsibilityRunSource.open(held, source, now());
        if (!guardedSave(run.getId(), row)) {
            return false;
        }
        SourceObservation observation = observer.observe(run.getOrgId(), source.account().getId(), source.dataType());
        row.record(observation);
        return guardedSave(run.getId(), row);
    }

    /**
     * An observation left unfinished by a dead attempt. The sync job it started (identified by this runtime's
     * trigger, account, data type and start time) decides what happened: finished → the read happened, adopt it;
     * still RUNNING → nobody is left to finish it, close it so the next read is not coalesced onto a ghost.
     */
    private boolean recoverInterrupted(UUID runId, ResponsibilityRunSource row) {
        List<SyncJob> jobs = sourceRows.findTriggeredSyncJobsSince(row.getSellerAccountId(), row.getDataType(),
                ResponsibilitySourceObserver.SYNC_TRIGGER, row.getStartedAt().minusSeconds(1));
        SyncJob job = jobs.isEmpty() ? null : jobs.get(0);
        if (job != null && !"RUNNING".equals(job.getStatus())) {
            ChannelStatus after = accounts.findById(row.getSellerAccountId())
                    .map(SellerAccount::getConnectionStatus).orElse(null);
            row.record(SourceObservationMapper.fromJob(job, after, null, null));
        } else {
            if (job != null) {
                runGate.failOrphan(job.getId(), ORPHAN_JOB_MESSAGE);
            }
            row.record(SourceObservation.none(SourceFailureReason.INTERRUPTED,
                    job == null ? null : job.getId(), job == null ? null : job.getJobType()));
        }
        return guardedSave(runId, row);
    }

    private int currentAttempt(UUID runId) {
        return runs.findById(runId).map(ResponsibilityRun::getAttempt).orElse(0);
    }

    private boolean guardedSave(UUID runId, ResponsibilityRunSource row) {
        Boolean saved = tx.execute(status -> {
            ResponsibilityRun run = runs.findById(runId).orElse(null);
            if (run == null || !run.heldBy(owner)) {
                return false;
            }
            sourceRows.save(row);
            return true;
        });
        return Boolean.TRUE.equals(saved);
    }

    void finish(UUID runId, RunFailureReason forced, List<ResponsibilitySources.ResolvedSource> required) {
        Instant now = now();
        tx.executeWithoutResult(status -> {
            ResponsibilityRun run = runs.findById(runId).orElse(null);
            if (run == null || !run.heldBy(owner)) {
                return;
            }
            List<ResponsibilityRunSource> rows = sourceRows.findByRunIdOrderByAttemptAscCreatedAtAsc(runId);
            for (ResponsibilityRunSource row : rows) {
                if (row.getCompleteness() == null) {
                    row.record(SourceObservation.none(SourceFailureReason.EXECUTION_FAILED, row.getSyncJobId(), null));
                    sourceRows.save(row);
                }
            }
            Map<String, ResponsibilityRunSource> latest = latestPerSource(rows);
            // A required source this attempt never reached is not a source that succeeded.
            for (ResponsibilitySources.ResolvedSource source : required) {
                String key = ResponsibilitySources.key().apply(source);
                if (!latest.containsKey(key)) {
                    ResponsibilityRunSource row = ResponsibilityRunSource.open(run, source, now);
                    row.record(SourceObservation.none(SourceFailureReason.EXECUTION_FAILED, null, null));
                    sourceRows.save(row);
                    latest.put(key, row);
                }
            }
            RunStatus outcome = forced == RunFailureReason.NO_REQUIRED_SOURCE
                    ? RunStatus.FAILED
                    : RunOutcomeRule.of(latest.values().stream().map(ResponsibilityRunSource::getCompleteness).toList());
            run.finish(outcome, forced, now);
            boolean retryable = latest.values().stream()
                    .filter(r -> r.getCompleteness() == null || !r.getCompleteness().settled())
                    .anyMatch(r -> r.getFailureReason() != null && r.getFailureReason().retryable());
            if ((outcome == RunStatus.PARTIAL || outcome == RunStatus.FAILED) && forced == null
                    && run.getAttempt() < MAX_ATTEMPTS && retryable) {
                Instant next = now.plus(RETRY_BACKOFF[Math.min(run.getAttempt() - 1, RETRY_BACKOFF.length - 1)]);
                if (next.isBefore(run.getWindowEnd())) {
                    run.setNextAttemptAt(next);
                }
            }
            runs.save(run);
        });
    }

    private void cancelHeld(UUID runId, RunFailureReason reason) {
        Instant now = now();
        tx.executeWithoutResult(status -> {
            ResponsibilityRun run = runs.findById(runId).orElse(null);
            if (run == null || !run.heldBy(owner)) {
                return;
            }
            retire(run, reason, now);
        });
    }

    static Map<String, ResponsibilityRunSource> latestPerSource(List<ResponsibilityRunSource> rows) {
        Map<String, ResponsibilityRunSource> latest = new LinkedHashMap<>();
        for (ResponsibilityRunSource row : rows) {
            ResponsibilityRunSource seen = latest.get(row.sourceKey());
            if (seen == null || row.getAttempt() >= seen.getAttempt()) {
                latest.put(row.sourceKey(), row);
            }
        }
        return latest;
    }

    private static RunFailureReason reasonFor(ResponsibilityStatus status) {
        return status == ResponsibilityStatus.PAUSED
                ? RunFailureReason.RESPONSIBILITY_PAUSED
                : RunFailureReason.RESPONSIBILITY_STOPPED;
    }

    private Instant now() {
        return clock.instant().truncatedTo(ChronoUnit.MICROS);
    }

    // ── heartbeat ───────────────────────────────────────────────────────────────────────────────────────────

    private record Heartbeat(AtomicBoolean lostFlag, ScheduledFuture<?> future) {
        static final Heartbeat NONE = new Heartbeat(new AtomicBoolean(false), null);

        boolean lost() {
            return lostFlag.get();
        }

        void stop() {
            if (future != null) {
                future.cancel(false);
            }
        }
    }

    private Heartbeat startHeartbeat(UUID runId) {
        if (heartbeat.isZero()) {
            return Heartbeat.NONE;
        }
        AtomicBoolean lost = new AtomicBoolean(false);
        ScheduledFuture<?> future = pool().scheduleAtFixedRate(() -> {
            try {
                Integer renewed = tx.execute(status -> runs.renewLease(runId, owner, now().plus(lease)));
                if (renewed == null || renewed == 0) {
                    lost.set(true);
                }
            } catch (RuntimeException e) {
                // A transient database failure is not a lost lease; if it persists the lease expires on its own.
                log.warn("responsibility: run {} heartbeat 실패 {}", runId, e.getClass().getSimpleName());
            }
        }, heartbeat.toMillis(), heartbeat.toMillis(), TimeUnit.MILLISECONDS);
        return new Heartbeat(lost, future);
    }

    private ScheduledExecutorService pool() {
        ScheduledExecutorService current = heartbeatPool;
        if (current == null) {
            synchronized (this) {
                if (heartbeatPool == null) {
                    heartbeatPool = Executors.newSingleThreadScheduledExecutor(r -> {
                        Thread t = new Thread(r, "responsibility-heartbeat");
                        t.setDaemon(true);
                        return t;
                    });
                }
                current = heartbeatPool;
            }
        }
        return current;
    }

    @PreDestroy
    void shutdown() {
        ScheduledExecutorService current = heartbeatPool;
        if (current != null) {
            current.shutdownNow();
        }
    }

    /** Test seam: the runs of one responsibility, oldest window first. */
    List<ResponsibilityRun> runsOf(UUID responsibilityId) {
        return new ArrayList<>(runs.findByResponsibilityIdOrderByWindowStartAsc(responsibilityId));
    }
}
