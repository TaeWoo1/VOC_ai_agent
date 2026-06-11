package com.sellerops.sync;

import com.sellerops.common.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

/**
 * One operator-enabled collection schedule per (seller account x data type).
 * Cadence is either an interval (interval_minutes) or a cron expression
 * (cron_expr), selected by cadence_kind. No scheduling logic here — this slice
 * only persists the configuration; the poller arrives in a later slice.
 */
@Getter
@Setter
@Entity
@Table(name = "sync_schedules")
public class SyncSchedule extends BaseEntity {

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    @Column(name = "seller_account_id", nullable = false)
    private UUID sellerAccountId;

    @Column(name = "data_type", nullable = false)
    private String dataType;

    /** INTERVAL or CRON. */
    @Column(name = "cadence_kind", nullable = false)
    private String cadenceKind;

    @Column(name = "interval_minutes")
    private Integer intervalMinutes;

    @Column(name = "cron_expr")
    private String cronExpr;

    @Column(nullable = false)
    private boolean enabled = false;

    @Column(name = "next_run_at")
    private Instant nextRunAt;

    @Column(name = "last_run_at")
    private Instant lastRunAt;

    @Column(name = "paused_reason", columnDefinition = "text")
    private String pausedReason;
}
