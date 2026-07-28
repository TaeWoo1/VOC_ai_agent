package com.sellerops.reviewissue;

import com.sellerops.common.ApiException;
import com.sellerops.reviewissue.dto.ReviewIssueFeedbackResponse;
import java.time.Clock;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;

/**
 * Records the operator's judgement about a repeated-issue CANDIDATE — 유용함 / 관련 없음 / 나중에 보기.
 *
 * <p><b>Offline evaluation data only.</b> This writes ONE append-only {@link ReviewIssueFeedback} and
 * touches nothing else — no lifecycle transition, no queue, no judgement. It is the issue-side
 * analogue of the {@code review-eval} label seed, kept so a later eval session can ask whether the
 * DRAFT/UNMEASURED detector surfaces the right issues.
 *
 * <p>Org-scoped: the issue must exist in the caller's org, or the ref is unaddressable (same message
 * whether missing or another org's, so an id cannot be probed). Idempotent on
 * {@code (orgId, commandId)}: a repeat is a no-op that reports {@code replayed}, the same contract the
 * reply outcome and work-dismissal writes follow.
 *
 * <p><b>Carries no {@code @Transactional} on the write path by design</b> — the same rule the reply
 * writers follow: {@code record()} commits on return so the unique-violation on a concurrent
 * duplicate surfaces here where the catch turns it into an idempotent replay.
 */
@Service
public class ReviewIssueFeedbackService {

    private final ReviewIssueFeedbackRepository feedback;
    private final ReviewIssueRepository issues;
    private final Clock clock;

    @Autowired
    public ReviewIssueFeedbackService(ReviewIssueFeedbackRepository feedback,
                                      ReviewIssueRepository issues) {
        this(feedback, issues, Clock.systemUTC());
    }

    /** Test seam: an explicit {@link Clock} pins {@code created_at}. */
    ReviewIssueFeedbackService(ReviewIssueFeedbackRepository feedback, ReviewIssueRepository issues,
                               Clock clock) {
        this.feedback = feedback;
        this.issues = issues;
        this.clock = clock;
    }

    /**
     * Record feedback for an issue. Idempotent on {@code (orgId, commandId)}: a replay writes nothing
     * and reports {@code replayed = true}. Never changes lifecycle, queue, or judgement.
     *
     * @throws ApiException 400 for a blank/over-long commandId or unknown kind; 404 when the issue is
     *     not in this org.
     */
    public ReviewIssueFeedbackResponse record(UUID orgId, UUID issueId, String kindRaw,
                                              String commandId, String actor) {
        ReviewIssueFeedbackKind kind = ReviewIssueFeedbackKind.parse(kindRaw);
        if (commandId == null || commandId.isBlank()) {
            throw ApiException.badRequest("commandId는 필수입니다.");
        }
        // Bound the id here, not at the column: tests build the H2 schema from the entity (varchar(120)),
        // so an over-long id would pass every test and 500 only in production. A 400 everywhere instead.
        if (commandId.length() > 120) {
            throw ApiException.badRequest("commandId가 너무 깁니다.");
        }
        // Same message whether missing or another org's, so an id cannot be probed (identity mixing).
        issues.findById(issueId)
                .filter(i -> i.getOrgId().equals(orgId))
                .orElseThrow(() -> ApiException.notFound("이슈를 찾을 수 없습니다."));

        // Fast path: a command already applied replays without a second row. Reuse for a DIFFERENT
        // issue or kind is a conflict, not a silent second effect.
        var prior = feedback.findByOrgIdAndCommandId(orgId, commandId);
        if (prior.isPresent()) {
            return replay(prior.get(), issueId, kind);
        }
        ReviewIssueFeedback row = new ReviewIssueFeedback();
        row.setOrgId(orgId);
        row.setIssueId(issueId);
        row.setKind(kind);
        row.setCommandId(commandId);
        row.setCreatedBy(actor);
        row.setCreatedAt(clock.instant());
        try {
            feedback.save(row);
        } catch (DataIntegrityViolationException raced) {
            // A concurrent request with the same command id won the unique index. Resolve it as the
            // replay it is (or a 409 if that id was spent on a different issue/kind).
            return feedback.findByOrgIdAndCommandId(orgId, commandId)
                    .map(existing -> replay(existing, issueId, kind))
                    .orElseThrow(() -> raced);
        }
        return new ReviewIssueFeedbackResponse(issueId, kind.name(), false);
    }

    private static ReviewIssueFeedbackResponse replay(ReviewIssueFeedback prior, UUID issueId,
                                                      ReviewIssueFeedbackKind kind) {
        if (!prior.getIssueId().equals(issueId) || prior.getKind() != kind) {
            throw ApiException.conflict("commandId가 이미 다른 피드백에 사용되었습니다.");
        }
        return new ReviewIssueFeedbackResponse(issueId, kind.name(), true);
    }
}
