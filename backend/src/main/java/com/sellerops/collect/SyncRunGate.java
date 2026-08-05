package com.sellerops.collect;

import com.sellerops.connector.DataType;
import com.sellerops.selleraccount.SellerAccountRepository;
import com.sellerops.sync.SyncJob;
import com.sellerops.sync.SyncJobRepository;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.function.Supplier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Single-flight admission + orphaned-run recovery for pull syncs. One collection run per
 * (seller account, data type) at a time: a second concurrent start does not create a duplicate
 * {@link SyncJob}, and a run left {@code RUNNING} by an abnormal exit (crash / restart mid-run) does
 * not block future runs forever.
 *
 * <p><b>Why here, and why a row lock.</b> {@code SyncRunExecutor} is deliberately non-transactional
 * and holds no lock across its (potentially minutes-long) pagination, so a naive "is one RUNNING?
 * no → create" check would race: two starts could both read "none" and both create a job. This gate
 * runs the <b>stale-clean + RUNNING-check + create</b> as one short critical section under a
 * {@code PESSIMISTIC_WRITE} lock on the seller-account row (via
 * {@link SellerAccountRepository#findByIdForUpdate}); the lock is released the instant the job row
 * exists, so the long run itself is never under a DB lock. The {@code RUNNING} job row is the
 * in-flight marker other starts detect.
 *
 * <p><b>Stale recovery is lazy and multi-instance-safe.</b> There is no boot-wide sweep — the
 * codebase does not guarantee a single instance ({@code SyncScheduleClaimer} explicitly tolerates
 * multi-instance), so a startup reconciler could fail a run that is genuinely alive on another node.
 * Instead, cleanup happens only <i>here</i>, at a new run's start, under the account lock, and only
 * for a {@code RUNNING} job whose {@code startedAt} is older than {@link #staleAfter} — a threshold
 * chosen to sit well above any legitimate single-run wall-time (see
 * {@code sellerops.collect.sync-stale-after-minutes}). A <b>fresh</b> RUNNING run is never touched.
 * Because the criterion is elapsed time (not process identity) and the threshold exceeds the worst
 * legitimate run, a run still executing on any instance is safe.
 */
@Component
public class SyncRunGate {

    /**
     * Stable, sanitized run-history message for a run reclaimed as orphaned. Carries no account,
     * credential, or provider detail — only that a stale run was cleaned so a fresh one could start.
     */
    static final String STALE_ERROR =
            "이전 수집이 안전 시간 한도를 초과해 비정상 종료로 판단되어 정리되었습니다.";

    private final SellerAccountRepository accounts;
    private final SyncJobRepository syncJobs;
    private final TransactionTemplate tx;
    private final Duration staleAfter;

    public SyncRunGate(SellerAccountRepository accounts, SyncJobRepository syncJobs,
                       PlatformTransactionManager txManager,
                       @Value("${sellerops.collect.sync-stale-after-minutes:60}") long staleAfterMinutes) {
        this.accounts = accounts;
        this.syncJobs = syncJobs;
        this.tx = new TransactionTemplate(txManager);
        if (staleAfterMinutes < 1) {
            throw new IllegalStateException(
                    "sellerops.collect.sync-stale-after-minutes는 1 이상이어야 합니다 (설정값: "
                            + staleAfterMinutes + ").");
        }
        this.staleAfter = Duration.ofMinutes(staleAfterMinutes);
    }

    /** Outcome of an admission check: the run to use, and whether it is an existing in-flight run. */
    public record RunStart(SyncJob job, boolean coalesced) {}

    /**
     * Admit a run for {@code (sellerAccountId, dataType)}. Under the account row lock: reclaim any
     * orphaned (stale) RUNNING job, then either coalesce onto a still-fresh RUNNING run
     * ({@code coalesced=true}, {@code newRun} not called) or create a new one via {@code newRun}
     * ({@code coalesced=false}). {@code newRun} must persist and return a freshly-started RUNNING
     * {@link SyncJob} (it is invoked inside this transaction, so the create is atomic with the check).
     */
    public RunStart beginRunOrCoalesce(UUID sellerAccountId, DataType dataType, Supplier<SyncJob> newRun) {
        return tx.execute(status -> {
            // Serialize concurrent starts for THIS account so the check-then-create below is atomic.
            accounts.findByIdForUpdate(sellerAccountId);

            Instant staleBefore = Instant.now().minus(staleAfter);
            List<SyncJob> running = syncJobs.findRunningBySellerAccountIdAndDataType(
                    sellerAccountId, dataType.name());
            SyncJob live = null;
            for (SyncJob run : running) {
                // Age from startedAt, falling back to createdAt (BaseEntity, always set) so a RUNNING
                // row that somehow carries no startedAt can still be reclaimed rather than blocking
                // forever. A fresh run's age is recent, so it is never reclaimed.
                Instant runStart = run.getStartedAt() != null ? run.getStartedAt() : run.getCreatedAt();
                if (runStart != null && runStart.isBefore(staleBefore)) {
                    // Orphaned past the safe limit → fail closed so it can never block a fresh run.
                    run.setStatus("FAILED");
                    run.setErrorMessage(STALE_ERROR);
                    run.setFinishedAt(Instant.now());
                    syncJobs.save(run);
                } else if (live == null) {
                    // A still-fresh RUNNING run — never touched; the new start coalesces onto it.
                    live = run;
                }
            }
            if (live != null) {
                return new RunStart(live, true);
            }
            return new RunStart(newRun.get(), false);
        });
    }
}
