package com.sellerops.collect;

import com.sellerops.connector.ChannelConnectionStatusRepository;
import com.sellerops.connector.ConnectorAlert;
import com.sellerops.connector.ConnectorAlertRepository;
import com.sellerops.connector.DataType;
import com.sellerops.sync.SyncJob;
import com.sellerops.sync.SyncJobRepository;
import com.sellerops.sync.SyncSchedule;
import com.sellerops.sync.SyncScheduleRepository;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * Runs the schedules claimed by {@link SyncScheduleClaimer} through
 * {@link SyncRunExecutor} and decides when each schedule runs next:
 *
 * <ul>
 *   <li><b>SUCCESS / PARTIAL with landed data</b> — normal cadence
 *       ({@code now + intervalMinutes}); schedule stays enabled.</li>
 *   <li><b>Rate limited</b> — never hammer-retry: next run honors the
 *       connector's retry-after hint ({@link SyncJob#getNextRetryAt()}) but no
 *       sooner than {@link #MIN_RATE_LIMIT_DELAY} from now.</li>
 *   <li><b>FAILED</b> — bounded backoff keyed off the account's consecutive
 *       failure count (1m → 5m → 25m); from {@link #MAX_ATTEMPTS} on, fast
 *       retries stop and the schedule falls back to its normal cadence, so
 *       there is no infinite tight retry loop. Retry execution itself is just
 *       the schedule coming due again — no separate retry queue.</li>
 * </ul>
 *
 * <p>Escalation: when consecutive failures reach {@link #DEGRADED_THRESHOLD},
 * the connection state crosses to {@code DEGRADED} and a
 * {@code REPEATED_FAILURE} alert row is recorded; rate-limited runs record a
 * {@code RATE_LIMITED} alert row. Alerts are <b>recorded only</b> — no
 * email/SMS/push delivery in this slice. Spam guards: DEGRADED alerts fire only
 * at the threshold crossing, and at most one unacknowledged alert of a type
 * exists per seller account.
 */
@Service
public class SyncScheduleRunner {

    private static final Logger log = LoggerFactory.getLogger(SyncScheduleRunner.class);

    static final int DEGRADED_THRESHOLD = 3;
    /** From this attempt on, stop accelerated retries and use the normal cadence. */
    static final int MAX_ATTEMPTS = 4;
    /** Bounded backoff: attempt 1 → 1m, 2 → 5m, 3 → 25m. */
    private static final int[] BACKOFF_MINUTES = {1, 5, 25};
    /** A rate-limited schedule never retries sooner than this, hint or not. */
    static final Duration MIN_RATE_LIMIT_DELAY = Duration.ofMinutes(1);

    private final SyncScheduleClaimer claimer;
    private final SyncRunExecutor executor;
    private final SyncScheduleRepository schedules;
    private final SyncJobRepository syncJobs;
    private final ChannelConnectionStatusRepository connectionStatus;
    private final ConnectorAlertRepository alerts;

    public SyncScheduleRunner(SyncScheduleClaimer claimer, SyncRunExecutor executor,
                              SyncScheduleRepository schedules, SyncJobRepository syncJobs,
                              ChannelConnectionStatusRepository connectionStatus,
                              ConnectorAlertRepository alerts) {
        this.claimer = claimer;
        this.executor = executor;
        this.schedules = schedules;
        this.syncJobs = syncJobs;
        this.connectionStatus = connectionStatus;
        this.alerts = alerts;
    }

    /**
     * Claim and execute up to {@code limit} due schedules. Returns the finished
     * jobs of the schedules that actually executed (deferred/broken ones are
     * rescheduled but produce no job).
     */
    public List<SyncJob> runDueSchedules(Instant now, int limit) {
        List<SyncSchedule> claimed = claimer.claimDue(now, limit);
        List<SyncJob> jobs = new ArrayList<>();
        for (SyncSchedule schedule : claimed) {
            SyncJob job = runOne(schedule, now);
            if (job != null) {
                jobs.add(job);
            }
        }
        return jobs;
    }

    private SyncJob runOne(SyncSchedule claimed, Instant now) {
        SyncJob job = null;
        try {
            DataType dataType = DataType.valueOf(claimed.getDataType());
            job = executor.execute(claimed.getOrgId(), claimed.getSellerAccountId(), dataType, "SCHEDULED");
        } catch (Exception e) {
            // One broken schedule (missing account, bad data_type) must not block the
            // rest of the batch. It keeps its provisional cadence-based next_run_at.
            log.warn("Scheduled run failed before execution for schedule {}: {}", claimed.getId(), e.getMessage());
        }

        // Re-read instead of saving the claimed snapshot: the operator may have
        // edited the schedule (disable, new interval) while the run was executing,
        // and a stale write here would silently undo that edit.
        SyncSchedule schedule = schedules.findById(claimed.getId()).orElse(null);
        if (schedule != null) {
            schedule.setLastRunAt(now);
            if (schedule.isEnabled()) {
                schedule.setNextRunAt(resolveNextRun(schedule, job, now));
            }
            schedules.save(schedule);
        }

        if (job != null) {
            escalate(claimed, job);
        }
        return job;
    }

    /** Outcome-aware next run: cadence on success, rate-limit delay, or bounded backoff. */
    private Instant resolveNextRun(SyncSchedule schedule, SyncJob job, Instant now) {
        Instant cadence = now.plus(Duration.ofMinutes(schedule.getIntervalMinutes()));
        if (job == null) {
            return cadence;
        }
        if (job.isRateLimited()) {
            Instant floor = now.plus(MIN_RATE_LIMIT_DELAY);
            Instant hinted = job.getNextRetryAt();
            Instant next = (hinted != null && hinted.isAfter(floor)) ? hinted : floor;
            recordRetryAt(job, next);
            return next;
        }
        if ("FAILED".equals(job.getStatus())) {
            int failures = connectionStatus.findBySellerAccountId(schedule.getSellerAccountId())
                    .map(h -> h.getConsecutiveFailures())
                    .orElse(0);
            // failures == 0 means the executor recorded a config failure without
            // touching health — fast retries won't fix config, so use the cadence.
            if (failures >= 1 && failures < MAX_ATTEMPTS) {
                Instant next = now.plus(Duration.ofMinutes(BACKOFF_MINUTES[failures - 1]));
                recordRetryAt(job, next);
                return next;
            }
        }
        return cadence;
    }

    private void recordRetryAt(SyncJob job, Instant next) {
        job.setNextRetryAt(next);
        syncJobs.save(job);
    }

    private void escalate(SyncSchedule schedule, SyncJob job) {
        if ("FAILED".equals(job.getStatus())) {
            connectionStatus.findBySellerAccountId(schedule.getSellerAccountId()).ifPresent(health -> {
                // Alert only at the threshold crossing — once DEGRADED, further
                // failures don't re-alert until the account recovers.
                if (health.getConsecutiveFailures() >= DEGRADED_THRESHOLD && !"DEGRADED".equals(health.getState())) {
                    health.setState("DEGRADED");
                    connectionStatus.save(health);
                    recordAlert(schedule, job, "REPEATED_FAILURE", "WARNING",
                            "예약 수집이 " + health.getConsecutiveFailures()
                                    + "회 연속 실패하여 연결 상태를 점검이 필요한 상태로 전환했습니다.");
                }
            });
        }
        if (job.isRateLimited()) {
            recordAlert(schedule, job, "RATE_LIMITED", "WARNING",
                    "채널 속도 제한으로 수집이 지연되고 있습니다. 잠시 후 예약된 시각에 자동으로 다시 시도합니다.");
        }
    }

    /**
     * Record an alert row only (no delivery). Skips if one of this type is already
     * open. The exists-then-save check is not atomic across instances — a rare
     * duplicate open alert is possible multi-instance and is harmless until a
     * unique partial index arrives with the alert read API.
     */
    private void recordAlert(SyncSchedule schedule, SyncJob job, String type, String severity, String message) {
        if (alerts.existsBySellerAccountIdAndTypeAndAcknowledgedAtIsNull(schedule.getSellerAccountId(), type)) {
            return;
        }
        ConnectorAlert alert = new ConnectorAlert();
        alert.setOrgId(schedule.getOrgId());
        alert.setSellerAccountId(schedule.getSellerAccountId());
        alert.setSyncJobId(job.getId());
        alert.setType(type);
        alert.setSeverity(severity);
        alert.setMessage(message);
        alerts.save(alert);
    }
}
