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

/** An organisation handed Reviewnary a job. One per org × template (V106). */
@Getter
@Setter
@Entity
@Table(name = "responsibility", uniqueConstraints = @UniqueConstraint(
        name = "uq_responsibility_org_template", columnNames = {"org_id", "template_code"}))
public class Responsibility extends BaseEntity {

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    @Enumerated(EnumType.STRING)
    @Column(name = "template_code", nullable = false, length = 48)
    private ResponsibilityTemplate templateCode;

    @Column(name = "template_version", nullable = false)
    private int templateVersion;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 16)
    private ResponsibilityStatus status;

    /** Start of the next window to materialize — always a window boundary; null unless ACTIVE. */
    @Column(name = "next_run_at")
    private Instant nextRunAt;

    @Column(name = "activated_by")
    private UUID activatedBy;

    @Column(name = "activated_at")
    private Instant activatedAt;

    @Column(name = "paused_at")
    private Instant pausedAt;

    @Column(name = "stopped_at")
    private Instant stoppedAt;
}
