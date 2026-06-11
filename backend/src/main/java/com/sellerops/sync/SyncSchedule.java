package com.sellerops.sync;

import com.sellerops.common.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

/**
 * One operator-enabled collection schedule per (seller account x data type) —
 * enforced by a unique constraint (V4) so the control API's upsert cannot
 * duplicate rows under concurrent PUTs. Cadence is either an interval
 * (interval_minutes) or a cron expression (cron_expr), selected by cadence_kind.
 */
@Getter
@Setter
@Entity
@Table(name = "sync_schedules", uniqueConstraints = @UniqueConstraint(
        name = "uq_sync_schedules_account_data_type",
        columnNames = {"org_id", "seller_account_id", "data_type"}))
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
