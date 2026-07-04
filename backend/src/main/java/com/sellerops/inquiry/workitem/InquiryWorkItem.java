package com.sellerops.inquiry.workitem;

import com.sellerops.common.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

/**
 * A durable seller work item opened for exactly one {@link
 * com.sellerops.inquiry.Inquiry}. This is the head of the inquiry work lifecycle
 * (Signal → WorkItem → … ported from the collector spec); this slice only creates
 * it in the {@link InquiryWorkItemPhase#OPEN} phase.
 *
 * <p><b>Connection identity:</b> {@code seller_account_id} is the <b>exact</b>
 * per-(org × channel) seller connection ({@link
 * com.sellerops.selleraccount.SellerAccount}) this inquiry arrived on — never a
 * bare {@code channel_id}, which cannot distinguish two accounts on the same
 * channel. {@code channel_id} is denormalized alongside it purely for the queue
 * read; it is not the connection key.
 *
 * <p>One work item per inquiry: {@code inquiry_id} is UNIQUE, so re-ingesting the
 * same inquiry can never fan out into duplicate work items.
 */
@Getter
@Setter
@Entity
@Table(name = "inquiry_work_item",
        uniqueConstraints = @UniqueConstraint(
                name = "uq_inquiry_work_item_inquiry", columnNames = "inquiry_id"))
public class InquiryWorkItem extends BaseEntity {

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    @Column(name = "inquiry_id", nullable = false)
    private UUID inquiryId;

    /** The exact seller connection ({@code SellerAccount.id}) — the connection FK. */
    @Column(name = "seller_account_id", nullable = false)
    private UUID sellerAccountId;

    /** Denormalized channel of the connection (queue read convenience only). */
    @Column(name = "channel_id", nullable = false)
    private UUID channelId;

    @Enumerated(EnumType.STRING)
    @Column(name = "phase", nullable = false)
    private InquiryWorkItemPhase phase;
}
