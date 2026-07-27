package com.sellerops.reviewissue;

import com.sellerops.review.Review;
import com.sellerops.reviewissue.IssueSignatureExtractor.ExtractedUnit;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The pipeline's write path: review → opinion units → signature → issue memory → evidence, with
 * everything unattributable going to the UNKNOWN pen instead of the nearest issue.
 *
 * <p><b>Idempotent by construction.</b> Evidence is keyed on
 * {@code (org, issue, review, unit_ordinal)} and issues on {@code (org, signature_key)}, so
 * re-running extraction over the same reviews — after a re-import, or to backfill — attaches nothing
 * twice and mints no duplicate issue. That matters because the import path is resumable: the same
 * review legitimately arrives more than once.
 *
 * <p><b>What this service must never do.</b> It writes to the issue tables only. It does not touch
 * {@code item_analyses}, does not change {@code reviews}, and cannot affect who is in the
 * needs-a-look queue — the regression gate in {@code contracts/review-eval/naver/v1/RUBRIC.md} says a
 * detector may only ADD. {@code ReviewIssueQueueIsolationTest} pins that.
 */
@Service
public class ReviewIssueExtractionService {

    private final IssueSignatureExtractor extractor;
    private final ReviewIssueRepository issues;
    private final ReviewIssueEvidenceRepository evidence;
    private final ReviewIssueUnknownUnitRepository unknowns;
    private final ReviewIssueStateEventRepository stateEvents;

    public ReviewIssueExtractionService(IssueSignatureExtractor extractor,
                                        ReviewIssueRepository issues,
                                        ReviewIssueEvidenceRepository evidence,
                                        ReviewIssueUnknownUnitRepository unknowns,
                                        ReviewIssueStateEventRepository stateEvents) {
        this.extractor = extractor;
        this.issues = issues;
        this.evidence = evidence;
        this.unknowns = unknowns;
        this.stateEvents = stateEvents;
    }

    /**
     * Extract one review into the issue memory.
     *
     * @return what changed, so a caller running a batch can report honest totals rather than
     *     "analysis complete"
     */
    @Transactional
    public ExtractionResult extract(Review review) {
        LocalDate occurredOn = occurredOn(review);
        int evidenceAdded = 0;
        int unknownAdded = 0;
        int issuesCreated = 0;
        int reopened = 0;

        for (ExtractedUnit unit : extractor.extract(review.getBody())) {
            if (!unit.isMatched()) {
                if (!unknowns.existsByOrgIdAndReviewIdAndUnitOrdinal(
                        review.getOrgId(), review.getId(), unit.ordinal())) {
                    unknowns.save(newUnknown(review, occurredOn, unit));
                    unknownAdded++;
                }
                continue;
            }

            IssueSignature signature = unit.signature();
            ReviewIssue issue = issues
                    .findByOrgIdAndSignatureKey(review.getOrgId(), signature.signatureKey())
                    .orElse(null);
            if (issue == null) {
                issue = issues.save(newIssue(review.getOrgId(), signature));
                stateEvents.save(stateEvent(issue, null, IssueLifecycleState.OBSERVING,
                        IssueStateActor.SYSTEM, IssueStateReason.CREATED, null));
                issuesCreated++;
            }

            if (evidence.existsByOrgIdAndIssueIdAndReviewIdAndUnitOrdinal(
                    review.getOrgId(), issue.getId(), review.getId(), unit.ordinal())) {
                continue;
            }
            evidence.save(newEvidence(review, issue, occurredOn, unit));
            evidenceAdded++;

            // A RESOLVED issue receiving new evidence goes back to OBSERVING rather than staying
            // resolved or being re-announced as new. Done here, on the write, because the fact that
            // matters ("evidence arrived after we called it resolved") is only visible here — a
            // later scan would have to guess from dates.
            if (issue.getLifecycleState() == IssueLifecycleState.RESOLVED) {
                stateEvents.save(stateEvent(issue, IssueLifecycleState.RESOLVED,
                        IssueLifecycleState.OBSERVING, IssueStateActor.SYSTEM,
                        IssueStateReason.REOPENED, null));
                issue.setLifecycleState(IssueLifecycleState.OBSERVING);
                reopened++;
            }
            touchEvidenceDates(issue, occurredOn);
            issues.save(issue);
        }
        return new ExtractionResult(evidenceAdded, unknownAdded, issuesCreated, reopened);
    }

    /**
     * UTC date of the review's {@code received_at}. UTC, not a local zone, because that is the zone
     * the value was written in: {@code DateParse.instantAtStartOfDay} pins the channel's calendar
     * date to UTC midnight, so reading it back in UTC recovers that exact date. Reading it in another
     * zone would shift some rows by a day for no gain.
     */
    private static LocalDate occurredOn(Review review) {
        return review.getReceivedAt().atOffset(ZoneOffset.UTC).toLocalDate();
    }

    /** Widen the issue's evidence span. Never narrows it — deleting evidence is not a flow. */
    private static void touchEvidenceDates(ReviewIssue issue, LocalDate occurredOn) {
        if (issue.getFirstEvidenceOn() == null || occurredOn.isBefore(issue.getFirstEvidenceOn())) {
            issue.setFirstEvidenceOn(occurredOn);
        }
        if (issue.getLastEvidenceOn() == null || occurredOn.isAfter(issue.getLastEvidenceOn())) {
            issue.setLastEvidenceOn(occurredOn);
        }
    }

    private ReviewIssue newIssue(UUID orgId, IssueSignature signature) {
        ReviewIssue issue = new ReviewIssue();
        issue.setOrgId(orgId);
        issue.setSignatureKey(signature.signatureKey());
        issue.setTitle(signature.titleKo());
        issue.setAspect(signature.aspect());
        issue.setProblem(signature.problem());
        issue.setSeverity(signature.severity());
        // A brand-new issue starts OBSERVING, never NEEDS_REVIEW: whether it warrants a look is a
        // judgement about accumulated evidence, and at creation there is one piece.
        issue.setLifecycleState(IssueLifecycleState.OBSERVING);
        issue.setExtractorKind(extractor.kind());
        issue.setExtractorVersion(extractor.version());
        issue.setDismissed(false);
        return issue;
    }

    private static ReviewIssueEvidence newEvidence(Review review, ReviewIssue issue,
                                                   LocalDate occurredOn, ExtractedUnit unit) {
        ReviewIssueEvidence row = new ReviewIssueEvidence();
        row.setOrgId(review.getOrgId());
        row.setIssueId(issue.getId());
        row.setReviewId(review.getId());
        row.setUnitOrdinal(unit.ordinal());
        row.setProductId(review.getProductId());
        row.setOccurredOn(occurredOn);
        row.setMatchConfidence(MatchConfidence.EXACT_SIGNATURE);
        return row;
    }

    private static ReviewIssueUnknownUnit newUnknown(Review review, LocalDate occurredOn,
                                                     ExtractedUnit unit) {
        ReviewIssueUnknownUnit row = new ReviewIssueUnknownUnit();
        row.setOrgId(review.getOrgId());
        row.setReviewId(review.getId());
        row.setUnitOrdinal(unit.ordinal());
        row.setProductId(review.getProductId());
        row.setOccurredOn(occurredOn);
        row.setReason(unit.unknownReason());
        return row;
    }

    private static ReviewIssueStateEvent stateEvent(ReviewIssue issue,
                                                    IssueLifecycleState from,
                                                    IssueLifecycleState to,
                                                    IssueStateActor actor,
                                                    IssueStateReason reason,
                                                    String note) {
        ReviewIssueStateEvent event = new ReviewIssueStateEvent();
        event.setOrgId(issue.getOrgId());
        event.setIssueId(issue.getId());
        event.setFromState(from);
        event.setToState(to);
        event.setActor(actor);
        event.setReason(reason);
        event.setNote(note);
        return event;
    }

    /** What one extraction changed. Zero everywhere is the normal result for a re-run. */
    public record ExtractionResult(int evidenceAdded, int unknownAdded, int issuesCreated,
                                   int issuesReopened) {

        public boolean changedAnything() {
            return evidenceAdded > 0 || unknownAdded > 0 || issuesCreated > 0 || issuesReopened > 0;
        }
    }
}
