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
 * The observation fact for one source in one attempt of a run. Rows are appended per attempt, so a source that
 * failed at attempt 1 and completed at attempt 2 keeps both facts; the run's status reads the latest per source.
 *
 * <p>A row with {@code completeness = null} is an observation in progress. Finding one owned by an attempt that
 * is no longer running is how a crash is recognised.
 */
@Getter
@Setter
@Entity
@Table(name = "responsibility_run_source", uniqueConstraints = @UniqueConstraint(
        name = "uq_responsibility_run_source_attempt",
        columnNames = {"run_id", "seller_account_id", "data_type", "attempt"}))
public class ResponsibilityRunSource extends BaseEntity {

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    @Column(name = "run_id", nullable = false)
    private UUID runId;

    @Column(name = "attempt", nullable = false)
    private int attempt;

    @Column(name = "seller_account_id", nullable = false)
    private UUID sellerAccountId;

    @Column(name = "channel_code", nullable = false, length = 32)
    private String channelCode;

    @Column(name = "data_type", nullable = false, length = 32)
    private String dataType;

    @Column(name = "method", nullable = false, length = 16)
    private String method;

    @Column(name = "recipe_version", length = 80)
    private String recipeVersion;

    @Column(name = "window_from", nullable = false)
    private Instant windowFrom;

    @Column(name = "window_to", nullable = false)
    private Instant windowTo;

    @Column(name = "cursor_from", columnDefinition = "text")
    private String cursorFrom;

    @Column(name = "cursor_to", columnDefinition = "text")
    private String cursorTo;

    @Column(name = "started_at", nullable = false)
    private Instant startedAt;

    @Column(name = "observed_at")
    private Instant observedAt;

    @Enumerated(EnumType.STRING)
    @Column(name = "completeness", length = 16)
    private SourceCompleteness completeness;

    @Column(name = "observed_count")
    private Integer observedCount;

    @Column(name = "new_count")
    private Integer newCount;

    @Column(name = "changed_count")
    private Integer changedCount;

    @Enumerated(EnumType.STRING)
    @Column(name = "failure_reason", length = 32)
    private SourceFailureReason failureReason;

    @Enumerated(EnumType.STRING)
    @Column(name = "identity_verdict", nullable = false, length = 16)
    private IdentityVerdict identityVerdict;

    @Column(name = "sync_job_id")
    private UUID syncJobId;

    static ResponsibilityRunSource open(ResponsibilityRun run, ResponsibilitySources.ResolvedSource source,
                                        Instant now) {
        ResponsibilityRunSource row = new ResponsibilityRunSource();
        row.setOrgId(run.getOrgId());
        row.setRunId(run.getId());
        row.setAttempt(run.getAttempt());
        row.setSellerAccountId(source.account().getId());
        row.setChannelCode(source.channelCode());
        row.setDataType(source.dataType().name());
        row.setMethod(ResponsibilitySources.METHOD_API);
        row.setWindowFrom(run.getWindowStart());
        row.setWindowTo(run.getWindowEnd());
        row.setStartedAt(now);
        row.setIdentityVerdict(IdentityVerdict.NOT_APPLICABLE);
        return row;
    }

    /**
     * A source observed by an installed helper rather than by a channel's API (Scheduled Aside v1).
     *
     * <p>The row is shaped like any other observation on purpose: the completeness contract, the «NONE carries
     * no count» rule and the seller-facing reading are the same whether a read came from an official API or from
     * a browser on someone's desk. What differs is recorded, not hidden — {@code method} says the helper carried
     * it and {@code recipe_version} says which published recipe did.
     *
     * <p>It hangs off the organisation's own account because {@code seller_account_id} is a real foreign key and
     * this row belongs to that seller's run; the surface read is Reviewnary's own, which is what {@code dataType}
     * names. {@link IdentityVerdict#NOT_APPLICABLE} is the honest verdict: there is no store identity to match on
     * a page we serve ourselves.
     */
    static ResponsibilityRunSource openDevice(ResponsibilityRun run, java.util.UUID sellerAccountId,
                                              String channelCode, String dataType, String recipeVersion,
                                              Instant now) {
        ResponsibilityRunSource row = new ResponsibilityRunSource();
        row.setOrgId(run.getOrgId());
        row.setRunId(run.getId());
        row.setAttempt(run.getAttempt());
        row.setSellerAccountId(sellerAccountId);
        row.setChannelCode(channelCode);
        row.setDataType(dataType);
        row.setMethod(ResponsibilitySources.METHOD_DEVICE);
        row.setRecipeVersion(recipeVersion);
        row.setWindowFrom(run.getWindowStart());
        row.setWindowTo(run.getWindowEnd());
        row.setStartedAt(now);
        row.setIdentityVerdict(IdentityVerdict.NOT_APPLICABLE);
        return row;
    }

    void record(SourceObservation observation) {
        completeness = observation.completeness();
        observedCount = observation.observedCount();
        newCount = observation.newCount();
        changedCount = observation.changedCount();
        failureReason = observation.failureReason();
        identityVerdict = observation.identityVerdict();
        observedAt = observation.observedAt();
        if (observation.recipeVersion() != null) {
            recipeVersion = observation.recipeVersion();
        }
        if (observation.syncJobId() != null) {
            syncJobId = observation.syncJobId();
        }
        if (observation.cursorFrom() != null) {
            cursorFrom = observation.cursorFrom();
        }
        if (observation.cursorTo() != null) {
            cursorTo = observation.cursorTo();
        }
    }

    String sourceKey() {
        return sellerAccountId + ":" + dataType;
    }
}
