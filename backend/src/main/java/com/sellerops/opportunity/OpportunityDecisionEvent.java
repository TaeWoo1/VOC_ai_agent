package com.sellerops.opportunity;

import com.sellerops.common.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

/**
 * One append-only row in the decision trail of a derived opportunity.
 *
 * <p><b>Nothing here is ever updated.</b> The live decision is {@link ImprovementOpportunity}; this
 * says what the seller did to get it there. {@code statusFrom} is null on the first event about an
 * opportunity and otherwise names the status actually left, which is only true because the writer
 * locks the decision row before reading it.
 *
 * <p>{@code evidenceCount} freezes what the suggestion rested on at that moment — the issue's
 * evidence is recounted on every read, so without this the trail could say 「채택」 beside a number
 * that had nothing to do with the decision.
 */
@Getter
@Setter
@Entity
@Table(name = "improvement_opportunity_event")
public class OpportunityDecisionEvent extends BaseEntity {

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    @Column(name = "opportunity_id", nullable = false)
    private UUID opportunityId;

    @Column(name = "issue_id", nullable = false)
    private UUID issueId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 40)
    private OpportunityKind kind;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private OpportunityEvent event;

    @Enumerated(EnumType.STRING)
    @Column(name = "status_from", length = 16)
    private OpportunityStatus statusFrom;

    @Enumerated(EnumType.STRING)
    @Column(name = "status_to", nullable = false, length = 16)
    private OpportunityStatus statusTo;

    /** Null only on rows backfilled by V103, where it was never observed. */
    @Column(name = "evidence_count")
    private Long evidenceCount;

    @Column(name = "actor_id")
    private UUID actorId;

    @Column(name = "decided_at", nullable = false)
    private Instant decidedAt;
}
