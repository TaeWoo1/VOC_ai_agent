package com.sellerops.proactive;

import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryOperationalState;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItem;
import com.sellerops.inquiry.workitem.InquiryWorkItemPhase;
import com.sellerops.inquiry.workitem.InquiryWorkItemRepository;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewReplyState;
import com.sellerops.review.ReviewRepository;
import com.sellerops.review.triage.ReviewTriageRules;
import com.sellerops.review.triage.ReviewTriageTier;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Component;

/**
 * One pass of the proactive loop for one org: <b>reconcile first, then prepare</b>.
 *
 * <p>The order is not cosmetic. Reconciling first is what makes "seller에게 이미 끝난 일을
 * 처리하세요라고 다시 보여주지 마" structurally true rather than eventually true: a card whose inquiry
 * was answered on the channel overnight is closed before this tick considers investigating anything,
 * so it cannot be re-surfaced by the same run that would have retired it. Preparing first would leave
 * a window — small, but exactly the window a seller notices.
 *
 * <p><b>Everything here is bounded and resumable.</b> Each phase takes a page, both candidate reads
 * are totally ordered, and every write is idempotent (the case's signature is unique per source
 * state; the unique partial index allows one open case per subject). A tick that dies halfway leaves
 * a consistent prefix, and the next tick continues rather than restarting.
 *
 * <p><b>It reads no marketplace and writes to none.</b> The candidate gate is a database read of
 * data already collected; the investigation reuses the in-process draft path. No channel call of any
 * kind originates in this package.
 */
@Component
public class ProactiveCaseReconciler {

    private static final Logger log = LoggerFactory.getLogger(ProactiveCaseReconciler.class);

    private final ProactiveProperties properties;
    private final ProactiveCaseRepository cases;
    private final InquiryWorkItemRepository workItems;
    private final InquiryRepository inquiries;
    private final ReviewRepository reviews;
    private final ProactiveInquiryInvestigator inquiryInvestigator;
    private final ProactiveReviewInvestigator reviewInvestigator;
    private final Clock clock;

    @Autowired
    public ProactiveCaseReconciler(ProactiveProperties properties, ProactiveCaseRepository cases,
                                   InquiryWorkItemRepository workItems, InquiryRepository inquiries,
                                   ReviewRepository reviews,
                                   ProactiveInquiryInvestigator inquiryInvestigator,
                                   ProactiveReviewInvestigator reviewInvestigator) {
        this(properties, cases, workItems, inquiries, reviews, inquiryInvestigator, reviewInvestigator,
                Clock.systemUTC());
    }

    ProactiveCaseReconciler(ProactiveProperties properties, ProactiveCaseRepository cases,
                            InquiryWorkItemRepository workItems, InquiryRepository inquiries,
                            ReviewRepository reviews, ProactiveInquiryInvestigator inquiryInvestigator,
                            ProactiveReviewInvestigator reviewInvestigator, Clock clock) {
        this.properties = properties;
        this.cases = cases;
        this.workItems = workItems;
        this.inquiries = inquiries;
        this.reviews = reviews;
        this.inquiryInvestigator = inquiryInvestigator;
        this.reviewInvestigator = reviewInvestigator;
        this.clock = clock;
    }

    /** What one pass actually did. Counts only — never an id, never content. */
    public record TickReport(int reconciled, int closed, int acted, int preparedInquiries,
                             int preparedReviews, int skippedUnchanged, int failed) {

        static TickReport empty() {
            return new TickReport(0, 0, 0, 0, 0, 0, 0);
        }
    }

    public TickReport tick(UUID orgId) {
        Counters counters = new Counters();
        reconcileOpen(orgId, counters);
        prepareInquiries(orgId, counters);
        prepareReviews(orgId, counters);
        TickReport report = counters.report();
        if (report.preparedInquiries() + report.preparedReviews() + report.closed() + report.acted() > 0) {
            log.info("proactive tick org={} 준비(문의)={} 준비(리뷰)={} 종료={} 처리됨={} 변화없음={} 실패={}",
                    orgId, report.preparedInquiries(), report.preparedReviews(), report.closed(),
                    report.acted(), report.skippedUnchanged(), report.failed());
        }
        return report;
    }

    // ------------------------------------------------------------------ reconcile

    /**
     * Re-derive every open case from its subject.
     *
     * <p>This method is the whole of the stale-handling contract, and it is deliberately the only
     * writer of {@link ProactiveCaseStatus}. Nothing a seller does touches a case directly; what they
     * do touches the work item or the review, and this reads the consequence back.
     */
    private void reconcileOpen(UUID orgId, Counters counters) {
        List<ProactiveCase> open = cases.findForReconcile(orgId, ProactiveCaseStatus.PREPARED,
                PageRequest.of(0, Math.max(1, properties.reconcilePerTick())));
        for (ProactiveCase existing : open) {
            counters.reconciled++;
            try {
                Outcome outcome = existing.getSubjectKind() == ProactiveSubjectKind.INQUIRY
                        ? reconcileInquiry(orgId, existing)
                        : reconcileReview(orgId, existing);
                apply(existing, outcome, counters);
            } catch (RuntimeException e) {
                counters.failed++;
                log.warn("proactive: 재확인 실패 org={} case={} 사유={}", orgId, existing.getId(), e.toString());
            }
        }
    }

    /** What a re-derivation concluded. {@code null} status means "unchanged — still the seller's". */
    private record Outcome(ProactiveCaseStatus status, ProactiveCloseReason closeReason) {

        static final Outcome UNCHANGED = new Outcome(null, null);

        static Outcome acted() {
            return new Outcome(ProactiveCaseStatus.ACTED, null);
        }

        static Outcome closed(ProactiveCloseReason reason) {
            return new Outcome(ProactiveCaseStatus.CLOSED, reason);
        }
    }

    private Outcome reconcileInquiry(UUID orgId, ProactiveCase existing) {
        Optional<InquiryWorkItem> workItem = existing.getWorkItemId() == null
                ? Optional.empty()
                : workItems.findById(existing.getWorkItemId()).filter(w -> w.getOrgId().equals(orgId));
        Optional<Inquiry> inquiry = inquiries.findById(existing.getSubjectId())
                .filter(i -> i.getOrgId().equals(orgId));
        if (workItem.isEmpty() || inquiry.isEmpty()) {
            return Outcome.closed(ProactiveCloseReason.NOT_OPERATIONAL);
        }
        InquiryWorkItemPhase phase = workItem.get().getPhase();
        // The seller acted. Which of the later phases it reached is on the work item's own audit
        // trail; this only needs to stop showing the card.
        if (phase != InquiryWorkItemPhase.PROPOSED && phase != InquiryWorkItemPhase.OPEN) {
            return phase == InquiryWorkItemPhase.DISMISSED
                    ? Outcome.closed(ProactiveCloseReason.NOT_OPERATIONAL)
                    : Outcome.acted();
        }
        Inquiry row = inquiry.get();
        if (row.getOperationalState() != InquiryOperationalState.ACTIVE) {
            return Outcome.closed(ProactiveCloseReason.NOT_OPERATIONAL);
        }
        if (!"UNANSWERED".equals(row.getStatus())) {
            // Answered somewhere else — on the channel, or by a routine collection that saw the
            // seller's own reply. Not our doing, and not a failure.
            return Outcome.closed(ProactiveCloseReason.ANSWERED_ELSEWHERE);
        }
        return driftedFrom(existing, inquiryState(row))
                ? Outcome.closed(ProactiveCloseReason.SUPERSEDED) : Outcome.UNCHANGED;
    }

    private Outcome reconcileReview(UUID orgId, ProactiveCase existing) {
        Optional<Review> found = reviews.findById(existing.getSubjectId())
                .filter(r -> r.getOrgId().equals(orgId));
        if (found.isEmpty()) {
            return Outcome.closed(ProactiveCloseReason.NO_LONGER_ACTIONABLE);
        }
        Review review = found.get();
        if (review.getReplyState() == ReviewReplyState.ANSWERED) {
            return Outcome.acted();
        }
        if (ReviewTriageRules.tier(review.getRating(), review.getBody()) != ReviewTriageTier.NEEDS_ATTENTION) {
            return Outcome.closed(ProactiveCloseReason.NO_LONGER_ACTIONABLE);
        }
        if (reviews.countActiveReplyWork(orgId, review.getId()) == 0) {
            // The seller set this review's reply work aside. Respecting that is the same rule the
            // candidate gate follows; a card that came back would be the product arguing with them.
            return Outcome.closed(ProactiveCloseReason.NO_LONGER_ACTIONABLE);
        }
        return driftedFrom(existing, reviewState(review))
                ? Outcome.closed(ProactiveCloseReason.SUPERSEDED) : Outcome.UNCHANGED;
    }

    private boolean driftedFrom(ProactiveCase existing, String currentState) {
        return !ProactiveSignature.truncateState(currentState).equals(existing.getSourceState());
    }

    private void apply(ProactiveCase existing, Outcome outcome, Counters counters) {
        if (outcome.status() == null) {
            return;
        }
        Instant now = clock.instant();
        existing.setStatus(outcome.status());
        if (outcome.status() == ProactiveCaseStatus.ACTED) {
            existing.setActedAt(now);
            counters.acted++;
        } else {
            existing.setClosedAt(now);
            existing.setCloseReason(outcome.closeReason());
            counters.closed++;
        }
        cases.save(existing);
    }

    // ------------------------------------------------------------------ prepare

    private void prepareInquiries(UUID orgId, Counters counters) {
        int budget = properties.inquiriesPerTick();
        if (budget == 0) {
            return;
        }
        // Read more candidates than the budget: the oldest few may already have been investigated
        // against their current state, and a page sized to the budget would spend every tick
        // re-reading them and preparing nothing.
        List<InquiryWorkItem> candidates =
                workItems.findProactiveCandidates(orgId, PageRequest.of(0, budget * 5));
        int prepared = 0;
        for (InquiryWorkItem workItem : candidates) {
            if (prepared >= budget) {
                return;
            }
            Optional<Inquiry> found = inquiries.findById(workItem.getInquiryId())
                    .filter(i -> i.getOrgId().equals(orgId));
            if (found.isEmpty()) {
                continue;
            }
            Inquiry inquiry = found.get();
            String state = ProactiveSignature.truncateState(inquiryState(inquiry));
            String signature = ProactiveSignature.of(orgId, ProactiveSubjectKind.INQUIRY,
                    inquiry.getId(), state);
            if (alreadyInvestigated(orgId, ProactiveSubjectKind.INQUIRY, inquiry.getId(), signature)) {
                counters.skippedUnchanged++;
                continue;
            }
            supersedeOpen(orgId, ProactiveSubjectKind.INQUIRY, inquiry.getId(), counters);
            try {
                ProactiveInquiryInvestigator.Investigation found2 =
                        inquiryInvestigator.investigate(orgId, workItem.getId());
                ProactiveCase row = base(orgId, ProactiveSubjectKind.INQUIRY, inquiry.getId(), state,
                        signature, ProactiveReason.UNANSWERED_INQUIRY);
                row.setWorkItemId(workItem.getId());
                row.setChannelId(inquiry.getChannelId());
                row.setProductId(inquiry.getProductId());
                row.setReasonNote(inquiryNote(inquiry));
                row.setPreparedAction(found2.action());
                row.setDraftVersion(found2.draftVersion());
                row.setEvidenceState(found2.knowledgeState());
                row.setEvidenceCount(found2.evidenceCount());
                row.setKnowledgeGap(found2.knowledgeGap());
                row.setRecommendation(found2.note());
                save(row);
                prepared++;
                counters.preparedInquiries++;
            } catch (DataIntegrityViolationException race) {
                // Another tick (or another node) prepared this subject first. The unique index did its
                // job; there is nothing to repair.
                counters.skippedUnchanged++;
            } catch (RuntimeException e) {
                counters.failed++;
                log.warn("proactive: 문의 준비 실패 org={} workItem={} 사유={}", orgId, workItem.getId(), e.toString());
            }
        }
    }

    private void prepareReviews(UUID orgId, Counters counters) {
        int budget = properties.reviewsPerTick();
        if (budget == 0) {
            return;
        }
        List<Review> candidates = reviews.findProactiveCandidates(orgId, PageRequest.of(0, budget * 5));
        int prepared = 0;
        for (Review review : candidates) {
            if (prepared >= budget) {
                return;
            }
            String state = ProactiveSignature.truncateState(reviewState(review));
            String signature = ProactiveSignature.of(orgId, ProactiveSubjectKind.REVIEW, review.getId(), state);
            if (alreadyInvestigated(orgId, ProactiveSubjectKind.REVIEW, review.getId(), signature)) {
                counters.skippedUnchanged++;
                continue;
            }
            supersedeOpen(orgId, ProactiveSubjectKind.REVIEW, review.getId(), counters);
            try {
                ProactiveReviewInvestigator.Investigation found =
                        reviewInvestigator.investigate(orgId, review);
                ProactiveCase row = base(orgId, ProactiveSubjectKind.REVIEW, review.getId(), state,
                        signature, found.reason());
                row.setChannelId(review.getChannelId());
                row.setProductId(review.getProductId());
                row.setReasonNote(found.reason().noteKo());
                // A review has no draft to ground, so it has no knowledge state: null here means
                // "this question does not apply", not "nothing was found".
                row.setPreparedAction(ProactivePreparedAction.RECOMMENDATION_ONLY);
                row.setEvidenceCount(found.repeatIssue() == null ? 0 : 1);
                row.setRecommendation(found.recommendation());
                save(row);
                prepared++;
                counters.preparedReviews++;
            } catch (DataIntegrityViolationException race) {
                counters.skippedUnchanged++;
            } catch (RuntimeException e) {
                counters.failed++;
                log.warn("proactive: 리뷰 준비 실패 org={} review={} 사유={}", orgId, review.getId(), e.toString());
            }
        }
    }

    /**
     * Has this exact source state already been investigated — whatever became of the case afterwards?
     *
     * <p>Deliberately not "is there an open case": a case the seller ACTED on, or one closed because
     * the review stopped needing attention, must not be re-prepared the moment the loop comes round
     * again. The signature is the memory of what has been looked at.
     */
    private boolean alreadyInvestigated(UUID orgId, ProactiveSubjectKind kind, UUID subjectId, String signature) {
        return cases.findByOrgIdAndSubjectKindAndSubjectIdAndSignature(orgId, kind, subjectId, signature)
                .isPresent();
    }

    /** Close the open case for a subject whose state has moved on, so the new one can take its place. */
    private void supersedeOpen(UUID orgId, ProactiveSubjectKind kind, UUID subjectId, Counters counters) {
        cases.findByOrgIdAndSubjectKindAndSubjectIdAndStatus(orgId, kind, subjectId,
                ProactiveCaseStatus.PREPARED).ifPresent(stale -> {
                    stale.setStatus(ProactiveCaseStatus.CLOSED);
                    stale.setClosedAt(clock.instant());
                    stale.setCloseReason(ProactiveCloseReason.SUPERSEDED);
                    cases.save(stale);
                    counters.closed++;
                });
    }

    private ProactiveCase base(UUID orgId, ProactiveSubjectKind kind, UUID subjectId, String state,
                               String signature, ProactiveReason reason) {
        ProactiveCase row = new ProactiveCase();
        row.setOrgId(orgId);
        row.setSubjectKind(kind);
        row.setSubjectId(subjectId);
        row.setSignature(signature);
        row.setSourceState(state);
        row.setStatus(ProactiveCaseStatus.PREPARED);
        row.setReason(reason);
        row.setPriority(reason.priority());
        row.setPreparedAction(ProactivePreparedAction.NONE);
        row.setReasonNote(reason.noteKo());
        return row;
    }

    private void save(ProactiveCase row) {
        cases.save(row);
    }

    // ------------------------------------------------------------------ source state + copy

    static String inquiryState(Inquiry inquiry) {
        return ProactiveSignature.inquiryState(inquiry.getStatus(),
                inquiry.getOperationalState() == null ? null : inquiry.getOperationalState().name(),
                inquiry.getThreadRole(), inquiry.getProductId(), inquiry.getContentHash());
    }

    static String reviewState(Review review) {
        return ProactiveSignature.reviewState(review.getRating(),
                review.getReplyState() == null ? null : review.getReplyState().name(),
                review.getProductId(), review.getContentHash());
    }

    /**
     * The card's first line for an inquiry — the reason, plus how long the customer has waited.
     *
     * <p>The wait is an operational fact (the channel's own {@code received_at}) and it is the one
     * thing that distinguishes twenty otherwise identical unanswered inquiries. It is stated in whole
     * days because an hours-precise figure on a screen refreshed once a tick would be wrong more often
     * than it was right.
     */
    private String inquiryNote(Inquiry inquiry) {
        String base = ProactiveReason.UNANSWERED_INQUIRY.noteKo();
        if (inquiry.getReceivedAt() == null) {
            return base;
        }
        long days = Duration.between(inquiry.getReceivedAt(), clock.instant()).toDays();
        if (days <= 0) {
            return base + " 오늘 들어온 문의입니다.";
        }
        return base + " " + days + "일째 기다리고 있습니다.";
    }

    /** Mutable tally for one pass; never escapes this class except as a {@link TickReport}. */
    private static final class Counters {
        private int reconciled;
        private int closed;
        private int acted;
        private int preparedInquiries;
        private int preparedReviews;
        private int skippedUnchanged;
        private int failed;

        TickReport report() {
            return new TickReport(reconciled, closed, acted, preparedInquiries, preparedReviews,
                    skippedUnchanged, failed);
        }
    }
}
