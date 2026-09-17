package com.sellerops.knowledge.guidance;

import com.sellerops.common.BaseEntity;
import com.sellerops.common.DataOrigin;
import com.sellerops.common.RealDataOnly;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.Filter;

/**
 * <b>What the seller asked Reviewnary to keep in mind next time</b> — recorded only when they corrected a draft or a
 * recommendation and explicitly pressed 「다음에도 참고」.
 *
 * <p><b>Context, not a rule.</b> A guidance row is the seller's own sentence about one kind of case. A later
 * investigation or draft may be shown it (as {@code RECENT_SELLER_DECISION} authority in the Knowledge Spine); nothing
 * reads it to change a threshold, a triage rule or an operating policy, and it never grounds a factual claim alone.
 *
 * <p><b>No customer sentence.</b> {@link #topicSignature} is what survives of the question it was about — the words
 * the seller's own sentence also uses ({@code TopicSignature}) — so a later similar question can find it.
 */
@Getter
@Setter
@Entity
@Table(name = "seller_guidance")
@Filter(name = RealDataOnly.NAME, condition = RealDataOnly.CONDITION)
public class SellerGuidance extends BaseEntity {

    public enum Kind { DRAFT_CORRECTION, DECISION_CORRECTION }

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    @Column(name = "product_id")
    private UUID productId;

    /** {@code ORG} or {@code PRODUCT}; a PRODUCT row always names its product (V111 check). */
    @Column(nullable = false, length = 16)
    private String scope;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 32)
    private Kind kind;

    /** {@code INQUIRY} or {@code REVIEW}. */
    @Column(name = "subject_kind", nullable = false, length = 16)
    private String subjectKind;

    @Column(name = "origin_case_id")
    private UUID originCaseId;

    /** For a decision correction: the closed action token the seller said was right. */
    @Column(name = "corrected_action", length = 32)
    private String correctedAction;

    @Column(name = "topic_signature", nullable = false, length = 400)
    private String topicSignature;

    @Column(nullable = false, columnDefinition = "text")
    private String guidance;

    @Column(nullable = false, columnDefinition = "text")
    private String normalized;

    @Column(nullable = false)
    private boolean active = true;

    @Column(name = "author_user_id")
    private UUID authorUserId;

    @Column(name = "author_name", length = 120)
    private String authorName;

    @Enumerated(EnumType.STRING)
    @Column(name = "data_origin", nullable = false, length = 16)
    private DataOrigin dataOrigin = DataOrigin.REAL;
}
