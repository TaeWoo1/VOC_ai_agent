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
 * An opinion unit that produced no usable signature — the UNKNOWN holding pen.
 *
 * <p>Its existence is the design decision. The alternative is attaching a low-confidence unit to the
 * nearest issue, which inflates every count with guesses and makes the change judgements measure the
 * extractor's optimism rather than the customers. "We could not tell" is stored as a fact.
 *
 * <p>Phase A writes here and reports the count. It does not cluster these into new issue candidates:
 * clustering is a semantic step, and scope lock v1.6 ② has not opened one. {@link UnknownReason}
 * separates the reasons so the pen can later be triaged rather than swept — {@code NO_ASPECT} rows
 * are real complaints that could not be attributed, and they are where a clustering pass should
 * start.
 */
@Getter
@Setter
@Entity
@Table(name = "review_issue_unknown_units")
public class ReviewIssueUnknownUnit extends BaseEntity {

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    @Column(name = "review_id", nullable = false)
    private UUID reviewId;

    @Column(name = "unit_ordinal", nullable = false)
    private int unitOrdinal;

    @Column(name = "product_id")
    private UUID productId;

    @Column(name = "occurred_on", nullable = false)
    private LocalDate occurredOn;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 32)
    private UnknownReason reason;
}
