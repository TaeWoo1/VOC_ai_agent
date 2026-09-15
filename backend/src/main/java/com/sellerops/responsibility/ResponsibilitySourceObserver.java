package com.sellerops.responsibility;

import com.sellerops.channel.ChannelStatus;
import com.sellerops.collect.SyncRunExecutor;
import com.sellerops.connector.DataType;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import com.sellerops.sync.SyncCursorRepository;
import com.sellerops.sync.SyncJob;
import com.sellerops.sync.SyncJobRepository;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Observes one official-API source by running <b>the existing acquisition</b> — {@link SyncRunExecutor}, with its
 * connector, canonical ingest, dedup, cursor and {@code sync_jobs} record — and reading its result as a fact.
 * There is no second collector here.
 *
 * <p>Single-flight is the executor's: when the same (account, data type) is already being collected (a seller
 * pressed 「지금 동기화」), the executor returns that in-flight job instead of starting a second one, and this
 * observer waits for it and adopts its result. Collection happened once, and this window records it.
 */
@Component
public class ResponsibilitySourceObserver {

    private static final Logger log = LoggerFactory.getLogger(ResponsibilitySourceObserver.class);

    /** The {@code sync_jobs.trigger} of collections this runtime starts. */
    public static final String SYNC_TRIGGER = "RESPONSIBILITY";

    private final SyncRunExecutor executor;
    private final SellerAccountRepository accounts;
    private final SyncJobRepository syncJobs;
    private final SyncCursorRepository cursors;
    private final Duration adoptWait;
    private final Duration adoptPoll;

    @Autowired
    public ResponsibilitySourceObserver(SyncRunExecutor executor, SellerAccountRepository accounts,
                                        SyncJobRepository syncJobs, SyncCursorRepository cursors,
                                        @Value("${sellerops.responsibility.adopt-wait-seconds:900}") long adoptWaitSeconds) {
        this(executor, accounts, syncJobs, cursors, Duration.ofSeconds(adoptWaitSeconds), Duration.ofSeconds(2));
    }

    public ResponsibilitySourceObserver(SyncRunExecutor executor, SellerAccountRepository accounts,
                                        SyncJobRepository syncJobs, SyncCursorRepository cursors,
                                        Duration adoptWait, Duration adoptPoll) {
        this.executor = executor;
        this.accounts = accounts;
        this.syncJobs = syncJobs;
        this.cursors = cursors;
        this.adoptWait = adoptWait;
        this.adoptPoll = adoptPoll;
    }

    public SourceObservation observe(UUID orgId, UUID sellerAccountId, DataType dataType) {
        SellerAccount account = accounts.findById(sellerAccountId)
                .filter(a -> orgId.equals(a.getOrgId()))
                .orElse(null);
        if (account == null) {
            return SourceObservation.none(SourceFailureReason.NOT_CONNECTED, null, null);
        }
        // Known before any call: an account the reauth path already marked cannot be read, and asking the channel
        // again would only spend a request to learn it.
        if (account.getConnectionStatus() == ChannelStatus.RECONNECT_REQUIRED) {
            return SourceObservation.none(SourceFailureReason.AUTH_REQUIRED, null, null);
        }
        if (account.getConnectionStatus() != ChannelStatus.CONNECTED) {
            return SourceObservation.none(SourceFailureReason.NOT_CONNECTED, null, null);
        }

        String cursorFrom = cursorValue(orgId, sellerAccountId, dataType);
        SyncJob job;
        try {
            job = executor.execute(orgId, sellerAccountId, dataType, SYNC_TRIGGER);
        } catch (RuntimeException e) {
            log.warn("responsibility source 실행 실패 account={} type={} 사유={}",
                    sellerAccountId, dataType, e.getClass().getSimpleName());
            return SourceObservation.none(SourceFailureReason.EXECUTION_FAILED, null, null);
        }
        if ("RUNNING".equals(job.getStatus())) {
            job = awaitFinished(job);
            if ("RUNNING".equals(job.getStatus())) {
                return SourceObservation.none(SourceFailureReason.TIMEOUT, job.getId(), job.getJobType());
            }
        }
        String cursorTo = cursorValue(orgId, sellerAccountId, dataType);
        ChannelStatus after = accounts.findById(sellerAccountId).map(SellerAccount::getConnectionStatus).orElse(null);
        return SourceObservationMapper.fromJob(job, after, cursorFrom, cursorTo);
    }

    private SyncJob awaitFinished(SyncJob inFlight) {
        Instant deadline = Instant.now().plus(adoptWait);
        SyncJob current = inFlight;
        while ("RUNNING".equals(current.getStatus()) && Instant.now().isBefore(deadline)) {
            try {
                Thread.sleep(adoptPoll.toMillis());
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return current;
            }
            current = syncJobs.findById(inFlight.getId()).orElse(current);
        }
        return current;
    }

    private String cursorValue(UUID orgId, UUID sellerAccountId, DataType dataType) {
        return cursors.findByOrgIdAndSellerAccountIdAndDataTypeAndCursorKey(
                        orgId, sellerAccountId, dataType.name(), SyncRunExecutor.CURSOR_KEY)
                .map(c -> c.getCursorValue())
                .orElse(null);
    }
}
