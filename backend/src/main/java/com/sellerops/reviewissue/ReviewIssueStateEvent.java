package com.sellerops.reviewissue;

import com.sellerops.common.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

/**
 * One lifecycle transition. Append-only.
 *
 * <p>Separate from the issue row because the operator's own 조치 기록 is what makes
 * 개선 확인 중 → 해결됨 a legitimate conclusion rather than a coincidence, and a state field that is
 * simply overwritten loses it. It also answers "why was I told to look at this" months later, once
 * the counts that triggered the transition have moved on.
 */
@Getter
@Setter
@Entity
@Table(name = "review_issue_state_events")
public class ReviewIssueStateEvent extends BaseEntity {

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    @Column(name = "issue_id", nullable = false)
    private UUID issueId;

    /** Null only on the row recording the issue's creation. */
    @Enumerated(EnumType.STRING)
    @Column(name = "from_state", length = 24)
    private IssueLifecycleState fromState;

    @Enumerated(EnumType.STRING)
    @Column(name = "to_state", nullable = false, length = 24)
    private IssueLifecycleState toState;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private IssueStateActor actor;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 32)
    private IssueStateReason reason;

    /** The operator's own note (조치 내용). Operator-authored — not customer content. */
    @Column(columnDefinition = "text")
    private String note;
}
