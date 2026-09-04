package com.sellerops.report;

import com.sellerops.common.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

/**
 * One generated report, frozen. See {@code V96__agent_report.sql} for why it is a row.
 *
 * <p>The three JSON columns are the three layers the screen renders: {@code factsJson} (values with
 * ids), {@code summaryJson} (the deterministic reading), {@code narrativeJson} (the validated model
 * reading, or null). A row is never updated after generation — a newer reading is a new version.
 */
@Getter
@Setter
@Entity
@Table(name = "agent_report")
public class AgentReport extends BaseEntity {

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private ReportKind kind;

    @Column(name = "period_start", nullable = false)
    private LocalDate periodStart;

    @Column(name = "period_end", nullable = false)
    private LocalDate periodEnd;

    @Column(nullable = false)
    private int version;

    @Column(name = "facts_json", nullable = false, columnDefinition = "text")
    private String factsJson;

    @Column(name = "summary_json", nullable = false, columnDefinition = "text")
    private String summaryJson;

    @Column(name = "narrative_json", columnDefinition = "text")
    private String narrativeJson;

    @Enumerated(EnumType.STRING)
    @Column(name = "narrative_status", nullable = false, length = 24)
    private NarrativeStatus narrativeStatus;

    /** The generator's version string when a narrative was attempted, for provenance. */
    @Column(name = "narrative_version", length = 200)
    private String narrativeVersion;

    @Column(name = "generated_at", nullable = false)
    private Instant generatedAt;
}
