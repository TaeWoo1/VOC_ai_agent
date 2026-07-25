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
 * One repeated customer issue, with an identity that outlives a page load. That identity is the
 * whole reason this table exists: {@code ProductIssues.tsx} recomputes 이슈 후보 from whatever the
 * inbox feed holds at load time, so no question about CHANGE can be asked of it — "새로 나타남",
 * "증가 중", "계속 발생" and "개선됨" are all unanswerable without a row that persists.
 *
 * <p>Every stored field is either vocabulary or a count-derived date. <b>No customer text.</b>
 * 대표 고객 표현 is re-derived at read time from {@code review_issue_evidence} through the existing
 * masking path, so this table can be listed, counted and reported on without any masking decision.
 */
@Getter
@Setter
@Entity
@Table(name = "review_issues")
public class ReviewIssue extends BaseEntity {

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    /**
     * The issue's identity, e.g. {@code 배송:지연}. Unique per org, which is what makes attaching a
     * new unit an indexed lookup and re-extraction idempotent.
     */
    @Column(name = "signature_key", nullable = false, length = 64)
    private String signatureKey;

    /** Operator-facing label derived from vocabulary, never assembled from a review body. */
    @Column(nullable = false, length = 120)
    private String title;

    @Column(nullable = false, length = 40)
    private String aspect;

    @Column(nullable = false, length = 40)
    private String problem;

    /** Fixed by the problem vocabulary. Never derived from the star rating. */
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private IssueSeverity severity;

    @Enumerated(EnumType.STRING)
    @Column(name = "lifecycle_state", nullable = false, length = 24)
    private IssueLifecycleState lifecycleState;

    /** Which extractor produced this issue — a later one emits different keys and must be tellable apart. */
    @Column(name = "extractor_kind", nullable = false, length = 24)
    private String extractorKind;

    @Column(name = "extractor_version", nullable = false, length = 32)
    private String extractorVersion;

    /**
     * Date of the earliest and latest evidence. Maintained as evidence is attached so the NEW
     * judgement's "no evidence before the window" test costs no scan.
     */
    @Column(name = "first_evidence_on")
    private LocalDate firstEvidenceOn;

    @Column(name = "last_evidence_on")
    private LocalDate lastEvidenceOn;

    /**
     * The operator said 중요하지 않음. Kept rather than deleted: a deleted issue would be recreated
     * by the next extraction pass and announced as new, which is how a dismissal turns into a
     * recurring nag.
     */
    @Column(nullable = false)
    private boolean dismissed;
}
