package com.sellerops.proactive;

import com.sellerops.agent.quota.AgentQuotaService;
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
import com.sellerops.organization.Organization;
import com.sellerops.organization.OrganizationRepository;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Comparator;
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
    private final OrganizationRepository organizations;
    private final AgentQuotaService quota;
    private final Clock clock;

    @Autowired
    public ProactiveCaseReconciler(ProactiveProperties properties, ProactiveCaseRepository cases,
                                   InquiryWorkItemRepository workItems, InquiryRepository inquiries,
                                   ReviewRepository reviews,
                                   ProactiveInquiryInvestigator inquiryInvestigator,
                                   ProactiveReviewInvestigator reviewInvestigator,
                                   OrganizationRepository organizations, AgentQuotaService quota) {
        this(properties, cases, workItems, inquiries, reviews, inquiryInvestigator, reviewInvestigator,
                organizations, quota, Clock.systemUTC());
    }

    ProactiveCaseReconciler(ProactiveProperties properties, ProactiveCaseRepository cases,
                            InquiryWorkItemRepository workItems, InquiryRepository inquiries,
                            ReviewRepository reviews, ProactiveInquiryInvestigator inquiryInvestigator,
                            ProactiveReviewInvestigator reviewInvestigator,
                            OrganizationRepository organizations, AgentQuotaService quota, Clock clock) {
        this.properties = properties;
        this.cases = cases;
        this.workItems = workItems;
        this.inquiries = inquiries;
        this.reviews = reviews;
        this.inquiryInvestigator = inquiryInvestigator;
        this.reviewInvestigator = reviewInvestigator;
        this.organizations = organizations;
        this.quota = quota;
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
        // Reconcile ALWAYS runs, budget or not: closing a card whose inquiry was answered overnight is
        // correct whether or not this org may prepare new ones, and it calls no model.
        reconcileOpen(orgId, counters);

        Optional<Organization> org = organizations.findById(orgId);
        if (org.isEmpty()) {
            return report(orgId, counters);
        }
        Instant baseline = activationBaseline(org.get());
        if (baseline == null) {
            return report(orgId, counters);
        }

        int slots = remainingDailySlots(orgId);
        if (slots <= 0) {
            return report(orgId, counters);
        }
        prepare(orgId, baseline, slots, counters);
        return report(orgId, counters);
    }

    /**
     * This org's activation baseline — stamped on the first tick that ever runs for it.
     *
     * <p><b>Activation IS the baseline.</b> There is nothing for an operator to set, which is the
     * point: a boundary someone types is a boundary someone can mistype, and the mistake is silent
     * until an org's whole imported history is on a seller's screen. The first tick writes the instant
     * and prepares nothing, because at that instant nothing has been observed after it yet.
     *
     * <p>Written once and never moved. Forward would hide work; backward would re-open the flood.
     */
    private Instant activationBaseline(Organization org) {
        if (org.getProactiveBaselineAt() != null) {
            return org.getProactiveBaselineAt();
        }
        Instant now = clock.instant();
        org.setProactiveBaselineAt(now);
        organizations.save(org);
        log.info("proactive: 활성화 기준 시각을 기록했습니다 org={} — 이 시각 이전에 관측된 일은 "
                + "과거 backlog이며 신규 후보가 되지 않습니다", org.getId());
        return null;   // Nothing can be newer than an instant recorded a moment ago.
    }

    /**
     * How many expensive preparations this org may still get today.
     *
     * <p><b>Two gates, and both must pass.</b> The first is the product's own daily cap, counted off
     * the cases this loop actually created today — no second ledger, because {@code proactive_case}
     * already records exactly the thing being capped. The second is the org's shared Agent quota,
     * read without charging it: the loop competes for the same budget a seller-initiated draft spends
     * and yields when it is gone, which is what "proactive reserve = 0" means in code.
     *
     * <p>The day is the SAME day the quota uses — Asia/Seoul, taken from {@code AgentQuotaService}
     * rather than recomputed, so the two gates can never disagree about when today started.
     */
    private int remainingDailySlots(UUID orgId) {
        AgentQuotaService.AgentQuotaStatus status = quota.status(orgId);
        // The same ceiling, so the same switch: a deployment that turned enforcement off did not ask
        // for a second, invisible enforcement point here.
        if (status.enabled() && status.enforced() && status.llmCallsUsed() >= status.llmCallsLimit()) {
            log.info("proactive: 오늘 AI 예산이 소진되어 신규 준비를 건너뜁니다 org={}", orgId);
            return 0;
        }
        ZoneId zone = ZoneId.of("Asia/Seoul");
        Instant dayStart = status.date().atStartOfDay(zone).toInstant();
        Instant dayEnd = status.date().plusDays(1).atStartOfDay(zone).toInstant();
        long preparedToday = cases.countByOrgIdAndCreatedAtGreaterThanEqualAndCreatedAtLessThan(
                orgId, dayStart, dayEnd);
        return (int) Math.max(0, properties.dailyCap() - preparedToday);
    }

    /**
     * One line per tick, <b>always</b> — including the tick that found nothing.
     *
     * <p>It used to log only when something happened, which is the version of this that cannot be
     * trusted: "the loop is running and there is nothing to do" and "the loop is not running" looked
     * identical in the log, and the second is the failure an operator actually needs to see. One line
     * per org per interval is nothing; silence that means two different things is expensive.
     *
     * <p>Counts and one org id. No subject id, no title, no content.
     */
    private TickReport report(UUID orgId, Counters counters) {
        TickReport report = counters.report();
        log.info("proactive tick org={} 재확인={} 준비(문의)={} 준비(리뷰)={} 종료={} 처리됨={} 변화없음={} 실패={}",
                orgId, report.reconciled(), report.preparedInquiries(), report.preparedReviews(),
                report.closed(), report.acted(), report.skippedUnchanged(), report.failed());
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

    /**
     * <b>One selection across both kinds, not two queues with two budgets.</b>
     *
     * <p>Each lane's read is bounded and each is already ordered, but they are merged and re-sorted
     * before anything is investigated: the seller has one morning, and a system that hands them the
     * top three inquiries AND the top five reviews has not prioritised anything. What comes out is the
     * N most urgent things this org has, whatever kind they are.
     *
     * <p><b>The sort is explainable and the model has no part in it</b> — priority tier, then how
     * recently SellerOps first saw it, then a stable id tiebreak so a capped run is deterministic and
     * a re-run picks the same rows. The selection tier is computed from the row alone (an unanswered
     * inquiry is HIGH because a customer is waiting; a 1점 review is HIGH because it is the worst
     * rating). An investigation may RAISE a case's stored priority above its selection tier — a 2점
     * review turns out to be a repeat issue — and can never lower it, so nothing selected as urgent
     * quietly renders as routine.
     */
    private void prepare(UUID orgId, Instant baseline, int slots, Counters counters) {
        int scan = properties.candidateScan();
        List<Candidate> candidates = new ArrayList<>();
        for (InquiryWorkItem workItem : workItems.findProactiveCandidates(
                orgId, baseline, PageRequest.of(0, scan))) {
            inquiries.findById(workItem.getInquiryId())
                    .filter(i -> i.getOrgId().equals(orgId))
                    .ifPresent(inquiry -> candidates.add(Candidate.inquiry(workItem, inquiry)));
        }
        for (Review review : reviews.findProactiveCandidates(orgId, baseline, PageRequest.of(0, scan))) {
            candidates.add(Candidate.review(review));
        }
        candidates.sort(Comparator
                .comparingInt((Candidate c) -> c.selectionPriority().rank())
                .thenComparing(Candidate::firstObserved, Comparator.reverseOrder())
                .thenComparing(Candidate::subjectId));

        int prepared = 0;
        for (Candidate candidate : candidates) {
            if (prepared >= slots) {
                return;
            }
            String state = ProactiveSignature.truncateState(candidate.sourceState());
            String signature = ProactiveSignature.of(orgId, candidate.kind(), candidate.subjectId(), state);
            if (alreadyInvestigated(orgId, candidate.kind(), candidate.subjectId(), signature)) {
                counters.skippedUnchanged++;
                continue;
            }
            supersedeOpen(orgId, candidate.kind(), candidate.subjectId(), counters);
            try {
                if (candidate.kind() == ProactiveSubjectKind.INQUIRY) {
                    prepareInquiry(orgId, candidate, state, signature);
                    counters.preparedInquiries++;
                } else {
                    prepareReview(orgId, candidate, state, signature);
                    counters.preparedReviews++;
                }
                prepared++;
            } catch (DataIntegrityViolationException race) {
                // Another tick (or another node) prepared this subject first. The unique index did its
                // job; there is nothing to repair.
                counters.skippedUnchanged++;
            } catch (RuntimeException e) {
                counters.failed++;
                log.warn("proactive: 준비 실패 org={} 종류={} 사유={}", orgId, candidate.kind(), e.toString());
            }
        }
    }

    private void prepareInquiry(UUID orgId, Candidate candidate, String state, String signature) {
        Inquiry inquiry = candidate.inquiryRow();
        ProactiveInquiryInvestigator.Investigation found =
                inquiryInvestigator.investigate(orgId, candidate.workItemId());
        ProactiveCase row = base(orgId, ProactiveSubjectKind.INQUIRY, inquiry.getId(), state, signature,
                ProactiveReason.UNANSWERED_INQUIRY);
        row.setWorkItemId(candidate.workItemId());
        row.setChannelId(inquiry.getChannelId());
        row.setProductId(inquiry.getProductId());
        row.setReasonNote(inquiryNote(inquiry));
        row.setPreparedAction(found.action());
        row.setDraftVersion(found.draftVersion());
        row.setEvidenceState(found.knowledgeState());
        row.setEvidenceCount(found.evidenceCount());
        row.setKnowledgeGap(found.knowledgeGap());
        row.setRecommendation(found.note());
        cases.save(row);
    }

    private void prepareReview(UUID orgId, Candidate candidate, String state, String signature) {
        Review review = candidate.reviewRow();
        ProactiveReviewInvestigator.Investigation found = reviewInvestigator.investigate(orgId, review);
        ProactiveCase row = base(orgId, ProactiveSubjectKind.REVIEW, review.getId(), state, signature,
                found.reason());
        row.setChannelId(review.getChannelId());
        row.setProductId(review.getProductId());
        row.setReasonNote(found.reason().noteKo());
        // A review has no draft to ground, so it has no knowledge state: null here means "this
        // question does not apply", not "nothing was found".
        row.setPreparedAction(ProactivePreparedAction.RECOMMENDATION_ONLY);
        row.setEvidenceCount(found.repeatIssue() == null ? 0 : 1);
        row.setRecommendation(found.recommendation());
        cases.save(row);
    }

    /**
     * One thing that could be prepared, of either kind, with everything the selection needs and
     * nothing it does not.
     *
     * <p>{@code selectionPriority} is deterministic from the row — no model has run yet, and the
     * ordering must be reproducible before one does.
     */
    private record Candidate(ProactiveSubjectKind kind, UUID subjectId, UUID workItemId,
                             Instant firstObserved, ProactivePriority selectionPriority,
                             Inquiry inquiryRow, Review reviewRow) {

        static Candidate inquiry(InquiryWorkItem workItem, Inquiry inquiry) {
            return new Candidate(ProactiveSubjectKind.INQUIRY, inquiry.getId(), workItem.getId(),
                    workItem.getCreatedAt(), ProactivePriority.HIGH, inquiry, null);
        }

        static Candidate review(Review review) {
            ProactivePriority tier = review.getRating() != null
                    && review.getRating() <= ProactiveReviewInvestigator.SEVERE_RATING_MAX
                    ? ProactivePriority.HIGH : ProactivePriority.NORMAL;
            return new Candidate(ProactiveSubjectKind.REVIEW, review.getId(), null,
                    review.getCreatedAt(), tier, null, review);
        }

        String sourceState() {
            return kind == ProactiveSubjectKind.INQUIRY ? inquiryState(inquiryRow) : reviewState(reviewRow);
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
