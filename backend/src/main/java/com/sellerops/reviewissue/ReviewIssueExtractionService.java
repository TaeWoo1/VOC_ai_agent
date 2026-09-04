package com.sellerops.reviewissue;

import com.sellerops.review.Review;
import com.sellerops.reviewissue.IssueSignatureExtractor.ExtractedUnit;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
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
 * <p><b>And, since Issue Evidence Trust Closure v1 (2026-09-04), a re-run is a RECONCILE, not an
 * append.</b> The current extractor is authoritative for every unit of the review it is handed: a
 * stored evidence row whose unit the extractor no longer matches is deleted, and an UNKNOWN row whose
 * unit is now matched (or now has a different reason) is replaced. Before this, evidence could only
 * ever be added, so a better extractor could not retract what a worse one had written — the fourteen
 * 「파손없이 잘 도착했네요」 rows behind the live 「배송 파손」 issue would have stayed evidence forever.
 * Deleting evidence is therefore a flow now, and the one thing it never touches is the issue's
 * identity or lifecycle: an issue whose evidence count falls simply reads as small.
 *
 * <p><b>Synthetic reviews are refused at the door.</b> A {@code DEMO_SEED} or {@code VERIFY_FIXTURE}
 * review can chart what a shop did, but it cannot say a problem repeats for this seller — the same rule
 * {@code countUnansweredOperational} applies to owed replies. Refused here, at the write, rather than
 * trusted to the read-time filter: the filter is a session property and this service is also called
 * from listeners and boot runners where no request enabled it (measured: 11 seeded rows had become
 * evidence for 「접착 탈락」 that way).
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
        if (review.getDataOrigin() != null && review.getDataOrigin().synthetic()) {
            return ExtractionResult.NONE;
        }
        LocalDate occurredOn = occurredOn(review);
        int evidenceAdded = 0;
        int evidenceRemoved = 0;
        int unknownAdded = 0;
        int issuesCreated = 0;
        int reopened = 0;

        // What is stored for this review today, keyed the way the extractor's verdict is keyed.
        Map<Integer, List<ReviewIssueEvidence>> storedEvidence = new HashMap<>();
        for (ReviewIssueEvidence row : evidence.findByOrgIdAndReviewId(review.getOrgId(), review.getId())) {
            storedEvidence.computeIfAbsent(row.getUnitOrdinal(), k -> new java.util.ArrayList<>()).add(row);
        }
        Map<Integer, ReviewIssueUnknownUnit> storedUnknown = new HashMap<>();
        for (ReviewIssueUnknownUnit row : unknowns.findByOrgIdAndReviewId(review.getOrgId(), review.getId())) {
            storedUnknown.put(row.getUnitOrdinal(), row);
        }
        Set<Integer> seenOrdinals = new HashSet<>();
        Set<UUID> issuesLosingEvidence = new HashSet<>();

        for (ExtractedUnit unit : extractor.extract(review.getBody())) {
            seenOrdinals.add(unit.ordinal());
            if (!unit.isMatched()) {
                // A unit that is no longer evidence: retract what an earlier verdict wrote.
                for (ReviewIssueEvidence stale : storedEvidence.getOrDefault(unit.ordinal(), List.of())) {
                    evidence.delete(stale);
                    issuesLosingEvidence.add(stale.getIssueId());
                    evidenceRemoved++;
                }
                ReviewIssueUnknownUnit existing = storedUnknown.get(unit.ordinal());
                if (existing == null) {
                    unknowns.save(newUnknown(review, occurredOn, unit));
                    unknownAdded++;
                } else if (existing.getReason() != unit.unknownReason()) {
                    existing.setReason(unit.unknownReason());
                    unknowns.save(existing);
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

            // A matched unit is not UNKNOWN, and it is evidence for exactly this issue.
            ReviewIssueUnknownUnit formerlyUnknown = storedUnknown.remove(unit.ordinal());
            if (formerlyUnknown != null) {
                unknowns.delete(formerlyUnknown);
            }
            boolean alreadyStored = false;
            for (ReviewIssueEvidence stored : storedEvidence.getOrDefault(unit.ordinal(), List.of())) {
                if (stored.getIssueId().equals(issue.getId())) {
                    alreadyStored = true;
                } else {
                    evidence.delete(stored);
                    issuesLosingEvidence.add(stored.getIssueId());
                    evidenceRemoved++;
                }
            }
            if (alreadyStored) {
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

        // Ordinals the body no longer has (a re-imported review whose text changed): retract those too.
        for (Map.Entry<Integer, List<ReviewIssueEvidence>> entry : storedEvidence.entrySet()) {
            if (!seenOrdinals.contains(entry.getKey())) {
                for (ReviewIssueEvidence stale : entry.getValue()) {
                    evidence.delete(stale);
                    issuesLosingEvidence.add(stale.getIssueId());
                    evidenceRemoved++;
                }
            }
        }
        for (Map.Entry<Integer, ReviewIssueUnknownUnit> entry : storedUnknown.entrySet()) {
            if (!seenOrdinals.contains(entry.getKey())) {
                unknowns.delete(entry.getValue());
            }
        }
        for (UUID issueId : issuesLosingEvidence) {
            issues.findById(issueId).ifPresent(this::recomputeEvidenceDates);
        }
        return new ExtractionResult(evidenceAdded, unknownAdded, issuesCreated, reopened, evidenceRemoved);
    }

    /**
     * After a retraction the span may have narrowed, so it is re-derived from what remains rather than
     * kept — {@link #touchEvidenceDates} only ever widens, which was correct while nothing was deleted.
     */
    private void recomputeEvidenceDates(ReviewIssue issue) {
        evidence.flush();
        List<LocalDate> span = evidence.evidenceSpan(issue.getOrgId(), issue.getId());
        issue.setFirstEvidenceOn(span.isEmpty() ? null : span.get(0));
        issue.setLastEvidenceOn(span.isEmpty() ? null : span.get(1));
        issues.save(issue);
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

    /**
     * What one extraction changed. Zero everywhere is the normal result for a re-run.
     *
     * @param evidenceRemoved rows retracted because the current extractor no longer matches their unit
     *     (or the review is synthetic and was refused) — a change, reported like the additions are
     */
    public record ExtractionResult(int evidenceAdded, int unknownAdded, int issuesCreated,
                                   int issuesReopened, int evidenceRemoved) {

        /** The empty result: a refused review, or a re-run that found everything already right. */
        public static final ExtractionResult NONE = new ExtractionResult(0, 0, 0, 0, 0);

        /** Before retraction existed, four numbers were the whole result. Kept for callers that add up. */
        public ExtractionResult(int evidenceAdded, int unknownAdded, int issuesCreated, int issuesReopened) {
            this(evidenceAdded, unknownAdded, issuesCreated, issuesReopened, 0);
        }

        public boolean changedAnything() {
            return evidenceAdded > 0 || unknownAdded > 0 || issuesCreated > 0 || issuesReopened > 0
                    || evidenceRemoved > 0;
        }
    }
}
