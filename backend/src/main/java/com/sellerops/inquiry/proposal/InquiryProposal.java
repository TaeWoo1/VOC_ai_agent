package com.sellerops.inquiry.proposal;

import com.sellerops.common.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

/**
 * A coarse, advisory proposal attached to exactly one {@link
 * com.sellerops.inquiry.workitem.InquiryWorkItem} when it moves OPEN&nbsp;&rarr;&nbsp;PROPOSED
 * (ported from the collector's {@code AgentProposal}). A proposal NEVER executes
 * anything — it records only what a reply <i>would</i> be about and whether it needs
 * approval.
 *
 * <p><b>Privacy:</b> this row stores only sanitized decision metadata — the coarse
 * {@code summary_category}, the {@code action_kind}, the approval requirement, the
 * authoring actor, and provider provenance. It deliberately persists <b>no</b>
 * inquiry body, <b>no</b> reply-draft text, <b>no</b> buyer identity, and <b>no</b>
 * reply token.
 *
 * <p>One proposal per work item: {@code work_item_id} is UNIQUE, which makes a
 * replayed or concurrent propose safe (the loser resolves to the existing row).
 */
@Getter
@Setter
@Entity
@Table(name = "inquiry_proposal",
        uniqueConstraints = @UniqueConstraint(
                name = "uq_inquiry_proposal_work_item", columnNames = "work_item_id"))
public class InquiryProposal extends BaseEntity {

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    @Column(name = "work_item_id", nullable = false)
    private UUID workItemId;

    @Column(name = "inquiry_id", nullable = false)
    private UUID inquiryId;

    /** Coarse side-effect class of the reply the proposal is about (e.g. POST_INQUIRY_REPLY). */
    @Column(name = "action_kind", nullable = false)
    private String actionKind;

    /** Coarse category of the drafted reply — never raw reply content. */
    @Column(name = "summary_category", nullable = false)
    private String summaryCategory;

    /** Whether an explicit seller approval is required before any execution. */
    @Column(name = "requires_approval", nullable = false)
    private boolean requiresApproval;

    /** The party the proposal is attributed to (e.g. {@code SYSTEM:RULE_PROPOSER}). */
    @Column(name = "proposed_by", nullable = false)
    private String proposedBy;

    @Column(name = "provider_kind", nullable = false)
    private String providerKind;

    @Column(name = "provider_name", nullable = false)
    private String providerName;

    @Column(name = "provider_version", nullable = false)
    private String providerVersion;
}
