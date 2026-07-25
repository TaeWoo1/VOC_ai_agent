package com.sellerops.reviewissue;

import com.sellerops.common.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import java.time.LocalDate;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

/**
 * One opinion unit of one review, as evidence for one issue.
 *
 * <p><b>The grain is the unit, not the review.</b> "예쁜데 배송이 너무 늦었어요" is a single review
 * carrying one actionable unit, and a review complaining about two different things has to be able
 * to be evidence for two issues. Keying on {@code (review, unit_ordinal)} is what allows both.
 */
@Getter
@Setter
@Entity
@Table(name = "review_issue_evidence")
public class ReviewIssueEvidence extends BaseEntity {

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    @Column(name = "issue_id", nullable = false)
    private UUID issueId;

    @Column(name = "review_id", nullable = false)
    private UUID reviewId;

    /**
     * Which opinion unit within the review, 0-based in reading order.
     * {@link OpinionUnitSplitter} is pure and stable, so this ordinal still identifies the same
     * clause when the body is re-split at read time to render 대표 고객 표현.
     */
    @Column(name = "unit_ordinal", nullable = false)
    private int unitOrdinal;

    /** Denormalized from the review so the concentration rollup is one indexed scan. Nullable. */
    @Column(name = "product_id")
    private UUID productId;

    /**
     * UTC date bucket of {@code reviews.received_at}. Stored so every window is date arithmetic with
     * no timezone decision at query time; for file-imported rows this is exactly the calendar date
     * the channel displayed. See {@code contracts/review-issue/v1/THRESHOLDS.md} §1.
     */
    @Column(name = "occurred_on", nullable = false)
    private LocalDate occurredOn;

    @Enumerated(EnumType.STRING)
    @Column(name = "match_confidence", nullable = false, length = 24)
    private MatchConfidence matchConfidence;
}
