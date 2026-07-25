package com.sellerops.reviewimport;

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
 * One authorization for one guided Action Window import run — the bridge between a seller's click and
 * what the local-agent runtime is allowed to do.
 *
 * <p>It exists because the Action Window contract refuses to transport identity: a run carries only
 * opaque 16-hex refs (no plan id, segment id, account id, or date), so the runtime cannot simply be
 * handed "import segment X over dates Y..Z". The frontend mints a ticket, the runtime learns only its
 * {@link #launchRef}, and the server resolves that ref back to the account, plan, segment, and required
 * dates. Because one row is the entire authorization, it is single use — see
 * {@link ReviewImportLaunchStatus}.
 *
 * <p>See {@code V28__review_import_launch.sql}.
 */
@Getter
@Setter
@Entity
@Table(name = "review_import_launch")
public class ReviewImportLaunch extends BaseEntity {

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    @Column(name = "seller_account_id", nullable = false)
    private UUID sellerAccountId;

    @Column(name = "channel_id", nullable = false)
    private UUID channelId;

    /** The opaque 16-hex ref carried on the Action Window wire — the only identifier the runtime learns. */
    @Column(name = "launch_ref", nullable = false, length = 16)
    private String launchRef;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private ReviewImportLaunchKind kind;

    /** Null for a DISCOVERY ticket until it creates a plan; always set for a SEGMENT ticket. */
    @Column(name = "plan_id")
    private UUID planId;

    /** SEGMENT tickets only. */
    @Column(name = "segment_id")
    private UUID segmentId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private ReviewImportLaunchStatus status = ReviewImportLaunchStatus.ISSUED;

    /** DISCOVERY outcome: the earliest date the marketplace allowed. */
    @Column(name = "discovered_start")
    private LocalDate discoveredStart;

    /** DISCOVERY outcome: the latest date the marketplace allowed. */
    @Column(name = "discovered_end")
    private LocalDate discoveredEnd;

    /** DISCOVERY outcome: how the range was established. Never flattened into a boolean. */
    @Enumerated(EnumType.STRING)
    @Column(name = "range_evidence", length = 24)
    private RangeDiscoveryEvidence rangeEvidence;

    /** SEGMENT outcome: how we know the exported scope matched the segment. */
    @Enumerated(EnumType.STRING)
    @Column(name = "scope_evidence", length = 24)
    private ScopeEvidence scopeEvidence;

    @Column(name = "issued_at", nullable = false)
    private Instant issuedAt;

    @Column(name = "consumed_at")
    private Instant consumedAt;

    /** Whether this ticket may still be resolved and spent by a runtime. */
    public boolean isOpen() {
        return status == ReviewImportLaunchStatus.ISSUED;
    }
}
