package com.sellerops.proactive;

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
import org.hibernate.annotations.SQLRestriction;

/**
 * One thing SellerOps looked into before the seller asked.
 *
 * <p><b>It annotates work; it does not own it.</b> The lifecycle of an inquiry stays on
 * {@code inquiry_work_item} and the lifecycle of a review stays on the review and its reply ledger.
 * This row carries what those cannot: why it matters right now, what was investigated, what was
 * found, and what is prepared. {@link #status} is recomputed from the subject on every tick, so this
 * table can be rebuilt from operational truth and can never become a competing authority over it.
 *
 * <p><b>Sanitized like every other read surface.</b> No buyer identity, no raw inquiry or review
 * body, no order id, no token. {@link #reasonNote} and {@link #recommendation} are composed from
 * operational facts and product/channel labels only, and {@code ProactiveSafetyFenceTest} asserts the
 * shape of what may reach them.
 */
@Getter
@Setter
@Entity
@Table(name = "proactive_case")
// Responsibility Runtime v1 Package B stores its OperationsCase rows in this same table (PD-3). This loop reads, counts
// and reconciles only its own half — a row a responsibility owns is never a proactive card, never superseded here,
// and never counted in this loop's telemetry. The columns the two mappings share are pinned to varchar (what V75 created)
// so a schema generated from both entities cannot narrow one half's tokens to the other half's enum.
@SQLRestriction("responsibility_id is null")
public class ProactiveCase extends BaseEntity {

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    @Enumerated(EnumType.STRING)
    @Column(name = "subject_kind", nullable = false, length = 16, columnDefinition = "varchar(16)")
    private ProactiveSubjectKind subjectKind;

    /** The {@code inquiries.id} or {@code reviews.id} this case is about — {@link #subjectKind} says which. */
    @Column(name = "subject_id", nullable = false)
    private UUID subjectId;

    /** The inquiry's existing work item; null for a review. The join to the flow the CTA opens. */
    @Column(name = "work_item_id")
    private UUID workItemId;

    @Column(name = "channel_id")
    private UUID channelId;

    /** The CANONICAL product, when the subject already resolves to one. Never guessed here. */
    @Column(name = "product_id")
    private UUID productId;

    /** sha256 over org + kind + subject + {@link #sourceState} — see {@link ProactiveSignature}. */
    @Column(name = "signature", nullable = false, length = 64)
    private String signature;

    /**
     * The source state this investigation was performed against, in readable form.
     *
     * <p>Stored beside the hash it produced so a stale case can be explained rather than merely
     * detected: "이 문의는 그 뒤에 답변됨" is a sentence someone can check, and a bare hash mismatch
     * is not. It carries states and ids only, never content.
     */
    @Column(name = "source_state", nullable = false, length = 200)
    private String sourceState;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 16, columnDefinition = "varchar(16)")
    private ProactiveCaseStatus status;

    @Enumerated(EnumType.STRING)
    @Column(name = "priority", nullable = false, length = 16, columnDefinition = "varchar(16)")
    private ProactivePriority priority;

    @Enumerated(EnumType.STRING)
    @Column(name = "reason", nullable = false, length = 48, columnDefinition = "varchar(48)")
    private ProactiveReason reason;

    @Column(name = "reason_note", nullable = false, columnDefinition = "text")
    private String reasonNote;

    /** {@code DraftKnowledgeState} for an inquiry; null for a review, which grounds no draft. */
    @Column(name = "evidence_state", length = 24)
    private String evidenceState;

    @Column(name = "evidence_count", nullable = false)
    private int evidenceCount;

    /** What the seller could add so the next draft is grounded, or null when nothing is missing. */
    @Column(name = "knowledge_gap", columnDefinition = "text")
    private String knowledgeGap;

    @Enumerated(EnumType.STRING)
    @Column(name = "prepared_action", nullable = false, length = 32, columnDefinition = "varchar(32)")
    private ProactivePreparedAction preparedAction;

    /** The version of {@code inquiry_reply_draft} this preparation produced, when it produced one. */
    @Column(name = "draft_version")
    private Integer draftVersion;

    /** The next action the seller can take, composed from facts. Null when there is nothing to say. */
    @Column(name = "recommendation", columnDefinition = "text")
    private String recommendation;

    /** First time this case was returned by a list read — "surfaced", not "created". */
    @Column(name = "surfaced_at")
    private Instant surfacedAt;

    /** First time the seller opened it. */
    @Column(name = "opened_at")
    private Instant openedAt;

    /** When the subject showed that the seller had acted. The retention measure's other end. */
    @Column(name = "acted_at")
    private Instant actedAt;

    @Column(name = "closed_at")
    private Instant closedAt;

    @Enumerated(EnumType.STRING)
    @Column(name = "close_reason", length = 32, columnDefinition = "varchar(32)")
    private ProactiveCloseReason closeReason;
}
