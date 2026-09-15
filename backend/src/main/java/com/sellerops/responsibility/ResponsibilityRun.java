package com.sellerops.responsibility;

import com.sellerops.common.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

/**
 * One logical 2-hour work window. Its identity is {@code (responsibilityId, windowStart)} — a retry of the window
 * is this same row with {@code attempt} increased, never a second row (V106 unique constraint).
 */
@Getter
@Setter
@Entity
@Table(name = "responsibility_run", uniqueConstraints = @UniqueConstraint(
        name = "uq_responsibility_run_window", columnNames = {"responsibility_id", "window_start"}))
public class ResponsibilityRun extends BaseEntity {

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    @Column(name = "responsibility_id", nullable = false)
    private UUID responsibilityId;

    @Column(name = "template_version", nullable = false)
    private int templateVersion;

    @Column(name = "window_start", nullable = false)
    private Instant windowStart;

    @Column(name = "window_end", nullable = false)
    private Instant windowEnd;

    @Enumerated(EnumType.STRING)
    @Column(name = "run_trigger", nullable = false, length = 16)
    private RunTrigger runTrigger;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 16)
    private RunStatus status;

    /** 0 until first claimed; each claim (first run, crash reclaim, retry) adds one. */
    @Column(name = "attempt", nullable = false)
    private int attempt;

    /** The coordinator instance holding a RUNNING run. Every write of a RUNNING run is fenced on it. */
    @Column(name = "lease_owner", length = 64)
    private String leaseOwner;

    /** Renewed by the holder's heartbeat; once it passes, the run is reclaimable. */
    @Column(name = "lease_until")
    private Instant leaseUntil;

    @Column(name = "next_attempt_at")
    private Instant nextAttemptAt;

    @Column(name = "started_at")
    private Instant startedAt;

    @Column(name = "finished_at")
    private Instant finishedAt;

    @Enumerated(EnumType.STRING)
    @Column(name = "failure_reason", length = 40)
    private RunFailureReason failureReason;

    static ResponsibilityRun materialized(Responsibility responsibility, Instant windowStart, RunTrigger trigger) {
        ResponsibilityRun run = new ResponsibilityRun();
        run.setOrgId(responsibility.getOrgId());
        run.setResponsibilityId(responsibility.getId());
        run.setTemplateVersion(responsibility.getTemplateVersion());
        run.setWindowStart(windowStart);
        run.setWindowEnd(ResponsibilityWindows.slotEnd(windowStart));
        run.setRunTrigger(trigger);
        run.setStatus(RunStatus.PENDING);
        run.setAttempt(0);
        return run;
    }

    void claim(String owner, Instant now, Instant leaseUntil) {
        status = RunStatus.RUNNING;
        attempt = attempt + 1;
        leaseOwner = owner;
        this.leaseUntil = leaseUntil;
        nextAttemptAt = null;
        finishedAt = null;
        failureReason = null;
        if (startedAt == null) {
            startedAt = now;
        }
    }

    void finish(RunStatus finalStatus, RunFailureReason reason, Instant now) {
        status = finalStatus;
        failureReason = reason;
        finishedAt = now;
        leaseOwner = null;
        leaseUntil = null;
        nextAttemptAt = null;
    }

    void cancel(RunFailureReason reason, Instant now) {
        finish(RunStatus.CANCELLED, reason, now);
    }

    /** A window cancelled by a pause/stop is worked again on resume — the same logical run, not a new one. */
    void reopen() {
        status = RunStatus.PENDING;
        failureReason = null;
        finishedAt = null;
        nextAttemptAt = null;
        leaseOwner = null;
        leaseUntil = null;
    }

    boolean heldBy(String owner) {
        return status == RunStatus.RUNNING && owner.equals(leaseOwner);
    }
}
