package com.sellerops.reviewissue;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Moves issues through {@link IssueLifecycleState}, and refuses transitions that are not the
 * lifecycle's.
 *
 * <p><b>Only two transitions are automatic</b> — OBSERVING → NEEDS_REVIEW when a judgement fires,
 * and VERIFYING → RESOLVED after enough quiet weeks (plus RESOLVED → OBSERVING on new evidence,
 * performed by {@link ReviewIssueExtractionService} where the fact is visible). Everything else
 * requires a person, because SellerOps cannot know that work was done.
 *
 * <p><b>Why RESOLVED is unreachable from anywhere but VERIFYING.</b> An issue that simply went quiet
 * without recorded remediation may be seeing slow sales, seasonality, or a missed import — none of
 * which is a fix. Auto-resolving it would turn a coverage gap into a success report. There is
 * deliberately no operator "mark resolved" either: the operator's contribution is recording that
 * they acted, and the quiet period is then evidence rather than assertion.
 */
@Service
public class ReviewIssueLifecycleService {

    private final ReviewIssueRepository issues;
    private final ReviewIssueStateEventRepository stateEvents;
    private final ReviewIssueSnapshotService snapshots;

    public ReviewIssueLifecycleService(ReviewIssueRepository issues,
                                       ReviewIssueStateEventRepository stateEvents,
                                       ReviewIssueSnapshotService snapshots) {
        this.issues = issues;
        this.stateEvents = stateEvents;
        this.snapshots = snapshots;
    }

    /**
     * Apply both automatic transitions across an org. Idempotent: running it twice on the same
     * reference date changes nothing the second time, so it is safe on a schedule and safe to
     * re-run after a failure.
     */
    @Transactional
    public AutomaticPassResult runAutomaticPass(UUID orgId, LocalDate referenceDate) {
        int raised = 0;
        int resolved = 0;
        for (ReviewIssue issue : issues.findByOrgIdAndDismissedFalse(orgId)) {
            if (issue.getLifecycleState() == IssueLifecycleState.OBSERVING) {
                IssueChangeRules.Assessment assessment = IssueChangeRules.assess(
                        snapshots.snapshot(orgId, issue.getId(), referenceDate));
                if (assessment.warrantsReview()) {
                    transition(issue, IssueLifecycleState.NEEDS_REVIEW, IssueStateActor.SYSTEM,
                            IssueStateReason.of(primaryReason(assessment)), null);
                    raised++;
                }
            } else if (issue.getLifecycleState() == IssueLifecycleState.VERIFYING
                    && snapshots.quietLongEnoughToResolve(orgId, issue.getId(), referenceDate)) {
                transition(issue, IssueLifecycleState.RESOLVED, IssueStateActor.SYSTEM,
                        IssueStateReason.QUIET_WEEKS, null);
                resolved++;
            }
        }
        return new AutomaticPassResult(raised, resolved);
    }

    /**
     * Which fired judgement to record as the reason. The first in {@link IssueChangeKind}'s display
     * order, which is also severity order — a NEW issue is described as new even if it is also
     * concentrated. IMPROVED is excluded because it never warrants review.
     */
    static IssueChangeKind primaryReason(IssueChangeRules.Assessment assessment) {
        return assessment.kinds().stream()
                .filter(IssueChangeKind::warrantsReview)
                .findFirst()
                .orElseThrow(() -> new IllegalStateException(
                        "확인이 필요한 판정이 없는데 상태를 올리려고 했습니다."));
    }

    /** 확인 필요 → 조치 중. The note is the operator's own record of what they are doing. */
    @Transactional
    public ReviewIssue startActing(UUID orgId, UUID issueId, String note) {
        ReviewIssue issue = require(orgId, issueId);
        requireState(issue, IssueLifecycleState.NEEDS_REVIEW);
        transition(issue, IssueLifecycleState.ACTING, IssueStateActor.OPERATOR,
                IssueStateReason.OPERATOR, note);
        return issue;
    }

    /**
     * 조치 중 → 개선 확인 중. This is the transition that later legitimises RESOLVED: from here a
     * quiet period is evidence that something changed rather than a coincidence.
     */
    @Transactional
    public ReviewIssue markRemediated(UUID orgId, UUID issueId, String note) {
        ReviewIssue issue = require(orgId, issueId);
        requireState(issue, IssueLifecycleState.ACTING);
        transition(issue, IssueLifecycleState.VERIFYING, IssueStateActor.OPERATOR,
                IssueStateReason.OPERATOR, note);
        return issue;
    }

    /**
     * 중요하지 않음. Sets a flag rather than deleting the row: a deleted issue would be recreated by
     * the next extraction pass and announced as new, which turns one dismissal into a recurring nag.
     * The lifecycle state is left untouched so restoring returns the operator to where they were.
     */
    @Transactional
    public ReviewIssue dismiss(UUID orgId, UUID issueId) {
        ReviewIssue issue = require(orgId, issueId);
        issue.setDismissed(true);
        return issues.save(issue);
    }

    @Transactional
    public ReviewIssue restore(UUID orgId, UUID issueId) {
        ReviewIssue issue = require(orgId, issueId);
        issue.setDismissed(false);
        return issues.save(issue);
    }

    @Transactional(readOnly = true)
    public List<ReviewIssueStateEvent> history(UUID orgId, UUID issueId) {
        require(orgId, issueId);
        return stateEvents.findByOrgIdAndIssueIdOrderByCreatedAtAsc(orgId, issueId);
    }

    private void transition(ReviewIssue issue, IssueLifecycleState target, IssueStateActor actor,
                            IssueStateReason reason, String note) {
        IssueLifecycleState from = issue.getLifecycleState();
        if (actor == IssueStateActor.SYSTEM && !from.systemMayTransitionTo(target)) {
            // Not defensive noise: this is the fence that keeps an automated pass from ever
            // declaring work done. If it ever throws, the bug is that something taught the system a
            // transition that belongs to a person.
            throw new IllegalStateException(
                    "시스템이 수행할 수 없는 상태 전이입니다: " + from + " → " + target);
        }
        ReviewIssueStateEvent event = new ReviewIssueStateEvent();
        event.setOrgId(issue.getOrgId());
        event.setIssueId(issue.getId());
        event.setFromState(from);
        event.setToState(target);
        event.setActor(actor);
        event.setReason(reason);
        event.setNote(note);
        stateEvents.save(event);

        issue.setLifecycleState(target);
        issues.save(issue);
    }

    private ReviewIssue require(UUID orgId, UUID issueId) {
        ReviewIssue issue = issues.findById(issueId).orElse(null);
        // Same message for "not this org's" and "does not exist", so an id cannot be probed for
        // existence across orgs.
        if (issue == null || !issue.getOrgId().equals(orgId)) {
            throw new IllegalArgumentException("이슈를 찾을 수 없습니다.");
        }
        return issue;
    }

    private static void requireState(ReviewIssue issue, IssueLifecycleState expected) {
        if (issue.getLifecycleState() != expected) {
            throw new IllegalStateException(
                    "현재 상태에서 수행할 수 없습니다: " + issue.getLifecycleState());
        }
    }

    /** What one automatic pass changed. Zero/zero is the normal result of a re-run. */
    public record AutomaticPassResult(int raisedForReview, int resolved) {
    }
}
