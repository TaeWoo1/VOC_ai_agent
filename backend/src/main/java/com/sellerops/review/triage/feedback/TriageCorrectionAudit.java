package com.sellerops.review.triage.feedback;

import com.sellerops.common.BaseEntity;
import com.sellerops.review.triage.ReviewTriageTier;
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
 * One thing the seller did to their own correction. Append-only; never updated.
 *
 * <p>V43 said the history of a correction was "the immutable prediction rows plus this row's
 * updated_at". That is true of what the AI said and false of what the SELLER said: a seller who
 * changed 확인 필요 → 참고 → 지켜보기 left one row holding 지켜보기 and no record that they had ever
 * thought otherwise. This is that record.
 *
 * <p>{@link #tierFrom} is null on a review's first correction and after a withdrawal — in both cases
 * there was no standing seller judgment to leave. {@link #tierTo} is null exactly on
 * {@link Kind#WITHDRAWN}: no tier means "no opinion", and inventing one would put the seller's name
 * on a judgment they took back.
 *
 * <p>{@code shownTier}/{@code shownSource} are frozen here like on every other row in this spine,
 * because the rule's tier is recomputed at read time and the pilot may re-run — a year from now the
 * only thing that can still say what the seller was disagreeing with is this row.
 *
 * <p><b>Decision Data.</b> This is an answer to a question, not a trace of navigation. It is not
 * written to {@code review_triage_behavior_events}, it is never weighted, and it is never folded into
 * a silver snapshot (contract §4.6, feedback draft §7.4).
 */
@Getter
@Setter
@Entity
@Table(name = "review_triage_correction_audit")
public class TriageCorrectionAudit extends BaseEntity {

    /** What the seller did. Closed, and there is no third — a correction is stated or taken back. */
    public enum Kind {
        SET,
        WITHDRAWN
    }

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    @Column(name = "review_id", nullable = false)
    private UUID reviewId;

    @Column(name = "correction_id", nullable = false)
    private UUID correctionId;

    @Enumerated(EnumType.STRING)
    @Column(name = "kind", nullable = false, length = 16)
    private Kind kind;

    /** The tier the seller's correction said before this one, or null when none stood. */
    @Enumerated(EnumType.STRING)
    @Column(name = "tier_from", length = 24)
    private ReviewTriageTier tierFrom;

    /** The tier the seller's correction says after this one; null exactly on {@link Kind#WITHDRAWN}. */
    @Enumerated(EnumType.STRING)
    @Column(name = "tier_to", length = 24)
    private ReviewTriageTier tierTo;

    /** What the SYSTEM was saying at that moment. */
    @Enumerated(EnumType.STRING)
    @Column(name = "shown_tier", length = 24)
    private ReviewTriageTier shownTier;

    @Enumerated(EnumType.STRING)
    @Column(name = "shown_source", length = 8)
    private TriageShownSource shownSource;

    @Column(name = "reason_code", length = 32)
    private String reasonCode;

    @Column(name = "actor_id")
    private UUID actorId;

    @Column(name = "decided_at", nullable = false)
    private Instant decidedAt;
}
