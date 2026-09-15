package com.sellerops.operationscase;

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
 * <b>OperationsCase</b> — one thing a responsibility run found that is worth a case: a new or changed customer
 * inquiry or review, or a source the seller has to reconnect before Reviewnary can look at it.
 *
 * <p><b>Stored on {@code proactive_case}, not beside it</b> (PD-3, decided 2026-09-16). This mapping reads only the
 * rows a responsibility owns ({@code responsibility_id is not null}); {@code ProactiveCase} reads only the others.
 * Same table, two halves, one open-card-per-subject index across both.
 *
 * <p><b>It annotates work; it does not own it.</b> An inquiry's lifecycle stays on {@code inquiry_work_item}, a
 * review's on the review, its triage decision and its reply ledger, a source's on {@code responsibility_run_source}.
 * {@link #status} is recomputed from those by {@link OperationsCaseReconciler}, and nothing here can say a customer
 * was answered or anything was sent.
 *
 * <p><b>No customer sentence is stored here.</b> {@link #reasonNote} is a closed sentence, {@link #summary} and
 * {@link #recommendedAction} are the investigator's seller-language text, and neither is ever mailed.
 *
 * <p>The ownership columns are not declared NOT NULL in this mapping because the proactive half shares the table;
 * {@code ck_proactive_case_owner_shape} (V107) is what requires them on every row a responsibility owns.
 */
@Getter
@Setter
@Entity
@Table(name = "proactive_case")
@SQLRestriction("responsibility_id is not null")
public class OperationsCase extends BaseEntity {

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    @Enumerated(EnumType.STRING)
    @Column(name = "subject_kind", nullable = false, length = 16, columnDefinition = "varchar(16)")
    private OperationsSubjectKind subjectKind;

    /** An inquiry id, a review id, or (for {@link OperationsSubjectKind#SOURCE}) a seller account id. */
    @Column(name = "subject_id", nullable = false)
    private UUID subjectId;

    @Column(name = "work_item_id")
    private UUID workItemId;

    @Column(name = "channel_id")
    private UUID channelId;

    @Column(name = "product_id")
    private UUID productId;

    @Column(name = "signature", nullable = false, length = 64)
    private String signature;

    @Column(name = "source_state", nullable = false, length = 200)
    private String sourceState;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 16, columnDefinition = "varchar(16)")
    private OperationsCaseStatus status;

    @Enumerated(EnumType.STRING)
    @Column(name = "priority", nullable = false, length = 16, columnDefinition = "varchar(16)")
    private CasePriority priority;

    @Enumerated(EnumType.STRING)
    @Column(name = "reason", nullable = false, length = 48, columnDefinition = "varchar(48)")
    private CaseReason reason;

    @Column(name = "reason_note", nullable = false, columnDefinition = "text")
    private String reasonNote;

    @Column(name = "evidence_state", length = 24)
    private String evidenceState;

    @Column(name = "evidence_count", nullable = false)
    private int evidenceCount;

    @Column(name = "knowledge_gap", columnDefinition = "text")
    private String knowledgeGap;

    @Enumerated(EnumType.STRING)
    @Column(name = "prepared_action", nullable = false, length = 32, columnDefinition = "varchar(32)")
    private CasePreparedAction preparedAction;

    @Column(name = "draft_version")
    private Integer draftVersion;

    /** The recommended next action, in the seller's language. */
    @Column(name = "recommendation", columnDefinition = "text")
    private String recommendedAction;

    @Column(name = "surfaced_at")
    private Instant surfacedAt;

    @Column(name = "opened_at")
    private Instant openedAt;

    @Column(name = "acted_at")
    private Instant actedAt;

    @Column(name = "closed_at")
    private Instant closedAt;

    /** The proactive loop's column. Always null here — {@link #resolutionReason} is this half's vocabulary. */
    @Column(name = "close_reason", length = 32, columnDefinition = "varchar(32)")
    private String closeReason;

    @Column(name = "responsibility_id")
    private UUID responsibilityId;

    @Column(name = "origin_run_id")
    private UUID originRunId;

    @Column(name = "last_run_id")
    private UUID lastRunId;

    @Enumerated(EnumType.STRING)
    @Column(name = "case_kind", length = 24)
    private OperationsCaseKind caseKind;

    @Enumerated(EnumType.STRING)
    @Column(name = "required_authority", length = 8)
    private RequiredAuthority requiredAuthority;

    @Enumerated(EnumType.STRING)
    @Column(name = "disposition", length = 24)
    private CaseDisposition disposition;

    @Enumerated(EnumType.STRING)
    @Column(name = "decided_by", length = 8)
    private CaseDecider decidedBy;

    @Column(name = "summary", columnDefinition = "text")
    private String summary;

    @Enumerated(EnumType.STRING)
    @Column(name = "recommended_action_type", length = 32)
    private RecommendedActionType recommendedActionType;

    /** A JSON array of short seller-language strings. */
    @Column(name = "missing_information", columnDefinition = "text")
    private String missingInformation;

    @Enumerated(EnumType.STRING)
    @Column(name = "confidence", length = 8)
    private CaseConfidence confidence;

    @Enumerated(EnumType.STRING)
    @Column(name = "resolution_reason", length = 32)
    private CaseResolution resolutionReason;

    @Column(name = "reconciled_at")
    private Instant reconciledAt;

    @Column(name = "notified_at")
    private Instant notifiedAt;

    public boolean isOpen() {
        return status == OperationsCaseStatus.PREPARED;
    }
}
