package com.sellerops.collect.runtime;

import com.sellerops.connector.ChannelConnectionStatus;
import com.sellerops.connector.ChannelConnectionStatusRepository;
import com.sellerops.selleraccount.SellerAccountRepository;
import com.sellerops.sync.SyncJob;
import com.sellerops.sync.SyncJobRepository;
import java.time.Instant;
import java.util.UUID;
import org.springframework.stereotype.Service;

/**
 * Convergence point for the common collection runtime. Every collection path — API pull,
 * supervised seller-center export, and manual upload — opens a run here and finalizes it
 * here, so all three land one uniform {@code sync_jobs} row (collection_runs) and one
 * {@code channel_connection_status} health update (channel_connections).
 *
 * <p><b>Skeleton slice.</b> This service exists and is unit-tested, but NO existing caller
 * (SyncRunExecutor, FileUploadConnector) is wired to it yet and the scheduler stays
 * disabled — wiring is a deliberate follow-up. Like the existing executor it is NOT
 * {@code @Transactional}: it follows the same per-row-safety model.
 *
 * <p>The status mapping and the connection-health rules mirror the existing
 * {@code SyncRunExecutor} logic exactly (success/partial → CONNECTED + reset failures;
 * rate limit → record reason only, never an escalating failure; other failure →
 * increment consecutive failures), so a future migration of callers is behaviour-preserving.
 */
@Service
public class CollectionRunService {

    private final SyncJobRepository syncJobs;
    private final ChannelConnectionStatusRepository connectionStatus;
    private final SellerAccountRepository sellerAccounts;

    public CollectionRunService(SyncJobRepository syncJobs,
                                ChannelConnectionStatusRepository connectionStatus,
                                SellerAccountRepository sellerAccounts) {
        this.syncJobs = syncJobs;
        this.connectionStatus = connectionStatus;
        this.sellerAccounts = sellerAccounts;
    }

    /** Open and persist a RUNNING run for the descriptor, stamping the collection method. */
    public SyncJob open(CollectionDescriptor d) {
        SyncJob job = new SyncJob();
        job.setOrgId(d.orgId());
        job.setSellerAccountId(d.sellerAccountId());
        job.setChannelId(d.channelId());
        job.setDataType(d.dataType() != null ? d.dataType().name() : null);
        job.setMethod(d.method() != null ? d.method().name() : null);
        job.setUploadType(d.uploadType());
        job.setTrigger(d.trigger() != null ? d.trigger() : "UPLOAD");
        // jobType = connector kind (e.g. FILE_UPLOAD), orthogonal to method. A caller may carry
        // it explicitly to keep the legacy row shape; otherwise it mirrors the collection method.
        job.setJobType(d.jobType() != null ? d.jobType()
                : (d.method() != null ? d.method().name() : "UNKNOWN"));
        job.setAttempt(1);
        job.setStatus("RUNNING");
        job.setStartedAt(Instant.now());
        return syncJobs.save(job);
    }

    /**
     * Finalize the run from a {@link ConnectorResult}: write the raw row tallies and the
     * mapped {@code sync_jobs.status} (never RATE_LIMITED — see
     * {@link ConnectorResult#jobStatus()}), record the bounded failure code, then update
     * connection health.
     */
    public SyncJob finalizeRun(SyncJob job, ConnectorResult r) {
        return finalizeRun(job, r, r.failureCode());
    }

    /**
     * Finalize variant that stores an explicit {@code error_message} rather than the bounded
     * {@code failureCode}. The default ({@link #finalizeRun(SyncJob, ConnectorResult)}) keeps
     * the sanitized bounded code; this overload exists for the manual-upload path, which
     * faithfully preserves the legacy raw first row-error in the (operator-facing) row. The
     * stored message reaches connection health only when there is a seller account — uploads
     * pass none, so the raw text never lands in {@code channel_connection_status.last_error}.
     */
    public SyncJob finalizeRun(SyncJob job, ConnectorResult r, String storedErrorMessage) {
        String status = r.jobStatus();
        job.setTotalRows(r.totalRows());
        job.setSuccessRows(r.successRows());
        job.setSkippedRows(r.skippedRows());
        job.setFailedRows(r.failedRows());
        job.setStatus(status);
        job.setRateLimited(r.rateLimited());
        job.setErrorMessage(storedErrorMessage);
        job.setFinishedAt(Instant.now());
        SyncJob saved = syncJobs.save(job);
        updateHealth(saved, status, r.rateLimited());
        return saved;
    }

    /**
     * Connection-health update mirroring {@code SyncRunExecutor.updateHealth}:
     * success/partial → CONNECTED + last-synced + reset failures; rate limit (no data) →
     * record the reason only (never an escalating failure); other failure → increment
     * consecutive failures. No-op when the run has no seller account (legacy channel-only jobs).
     */
    private void updateHealth(SyncJob job, String status, boolean rateLimited) {
        UUID sellerAccountId = job.getSellerAccountId();
        if (sellerAccountId == null) {
            return;
        }
        boolean collected = "SUCCESS".equals(status) || "PARTIAL".equals(status);
        Instant now = Instant.now();
        String failureCode = job.getErrorMessage();

        ChannelConnectionStatus health = connectionStatus.findBySellerAccountId(sellerAccountId)
                .orElseGet(() -> {
                    ChannelConnectionStatus c = new ChannelConnectionStatus();
                    c.setOrgId(job.getOrgId());
                    c.setSellerAccountId(sellerAccountId);
                    c.setState("CONNECTED");
                    return c;
                });

        if (collected) {
            health.setState("CONNECTED");
            health.setLastSuccessAt(now);
            health.setConsecutiveFailures(0);
            health.setLastError(null);
            sellerAccounts.findById(sellerAccountId).ifPresent(account -> {
                account.setLastSyncedAt(now);
                sellerAccounts.save(account);
            });
        } else if (rateLimited) {
            // Throttling on a healthy connection, not a connectivity failure — it must
            // never count toward DEGRADED escalation. Record the reason only.
            health.setLastError(failureCode);
        } else {
            health.setConsecutiveFailures(health.getConsecutiveFailures() + 1);
            health.setLastError(failureCode);
        }
        connectionStatus.save(health);
    }
}
