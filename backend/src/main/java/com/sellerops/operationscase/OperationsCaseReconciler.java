package com.sellerops.operationscase;

import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryOperationalState;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.inquiry.publish.AnswerDeliveryTruthReader;
import com.sellerops.inquiry.workitem.InquiryWorkItem;
import com.sellerops.inquiry.workitem.InquiryWorkItemPhase;
import com.sellerops.inquiry.workitem.InquiryWorkItemRepository;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewReplyState;
import com.sellerops.review.ReviewRepository;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Component;

/**
 * <b>Canonical truth wins.</b> Re-derives every open OperationsCase from the record that owns the work, and is the
 * only writer of an open case's status.
 *
 * <ul>
 *   <li>An inquiry case follows its work item and the inquiry: a work item past waiting-for-seller is the seller
 *   having acted (which phase it reached is on the work item's own audit — this never says «sent» or «verified» in
 *   a word of its own; where an execution exists, the answer lifecycle's own tokens are quoted into the event); an
 *   excluded or answered inquiry closes the case.</li>
 *   <li>A review case follows the review: a reply on the channel or a seller triage decision after the case opened is
 *   the seller acting; a watched review stops being watched after {@link #MONITORING_WINDOW}.</li>
 *   <li>A gap case closes only when the source is READ completely again — that is decided by the run that reads it,
 *   not here — or when its account is gone.</li>
 * </ul>
 *
 * <p>Nothing here calls a channel, a model, or an approval. It reads rows other code wrote.
 */
@Component
public class OperationsCaseReconciler {

    private static final Logger log = LoggerFactory.getLogger(OperationsCaseReconciler.class);

    /** How long Reviewnary keeps watching a review nobody decided about. */
    static final Duration MONITORING_WINDOW = Duration.ofDays(14);
    static final int RECONCILE_PAGE = 500;
    /** The audit actor {@code InquiryWorkItemWriter.reconcileConnectorAnswered} writes; pinned by the fence test. */
    static final String CONNECTOR_INGEST_ACTOR = "SYSTEM:CONNECTOR_INGEST";

    private final OperationsCaseRepository cases;
    private final OperationsCaseEventRepository events;
    private final InquiryRepository inquiries;
    private final InquiryWorkItemRepository workItems;
    private final ReviewRepository reviews;
    private final SellerAccountRepository accounts;
    private final AnswerDeliveryTruthReader deliveries;
    private final Clock clock;

    @Autowired
    public OperationsCaseReconciler(OperationsCaseRepository cases, OperationsCaseEventRepository events,
                                    InquiryRepository inquiries, InquiryWorkItemRepository workItems,
                                    ReviewRepository reviews, SellerAccountRepository accounts,
                                    AnswerDeliveryTruthReader deliveries) {
        this(cases, events, inquiries, workItems, reviews, accounts, deliveries, Clock.systemUTC());
    }

    public OperationsCaseReconciler(OperationsCaseRepository cases, OperationsCaseEventRepository events,
                                    InquiryRepository inquiries, InquiryWorkItemRepository workItems,
                                    ReviewRepository reviews, SellerAccountRepository accounts,
                                    AnswerDeliveryTruthReader deliveries, Clock clock) {
        this.cases = cases;
        this.events = events;
        this.inquiries = inquiries;
        this.workItems = workItems;
        this.reviews = reviews;
        this.accounts = accounts;
        this.deliveries = deliveries;
        this.clock = clock;
    }

    public record Report(int checked, int acted, int closed) {
    }

    record Derived(OperationsCaseStatus status, CaseResolution resolution, CaseEventActor actor, String detail) {
        static final Derived UNCHANGED = new Derived(null, null, null, null);
    }

    public Report reconcile(UUID orgId, UUID responsibilityId, UUID runId) {
        List<OperationsCase> open = cases.findByOrgIdAndResponsibilityIdAndStatusOrderByCreatedAtAsc(
                orgId, responsibilityId, OperationsCaseStatus.PREPARED, PageRequest.of(0, RECONCILE_PAGE));
        int acted = 0;
        int closed = 0;
        for (OperationsCase c : open) {
            try {
                Derived derived = derive(c);
                if (derived.status() == null) {
                    continue;
                }
                apply(c, derived, runId);
                if (derived.status() == OperationsCaseStatus.ACTED) {
                    acted++;
                } else {
                    closed++;
                }
            } catch (RuntimeException e) {
                log.warn("responsibility: case 재확인 실패 org={} case={} 사유={}", orgId, c.getId(),
                        e.getClass().getSimpleName());
            }
        }
        return new Report(open.size(), acted, closed);
    }

    /** The seller stopped the responsibility: every open case it opened is closed, with the reason recorded. */
    public int closeAll(UUID orgId, UUID responsibilityId) {
        int closed = 0;
        for (OperationsCase c : cases.findByOrgIdAndResponsibilityIdAndStatusOrderByCreatedAtAsc(
                orgId, responsibilityId, OperationsCaseStatus.PREPARED, PageRequest.of(0, RECONCILE_PAGE))) {
            apply(c, new Derived(OperationsCaseStatus.CLOSED, CaseResolution.RESPONSIBILITY_STOPPED,
                    CaseEventActor.SELLER, "RESPONSIBILITY_STOPPED"), null);
            closed++;
        }
        return closed;
    }

    /**
     * <b>Re-derive ONE open case, now, outside a run.</b>
     *
     * <p>The scheduled {@link #reconcile} is what keeps every case honest; this is the same derivation
     * applied to a single subject the moment its canonical record moved, so a seller who just sent an
     * answer is not looking at a card that says «확인 필요» until the next two-hour window. It adds no
     * rule and no vocabulary — {@link #derive} and {@link #apply} are the ones the run uses — and it
     * changes no scheduler semantics: the run still visits this case, finds it settled, and moves on.
     *
     * <p>{@code runId} is null because this did not happen in a run, and recording a run that did not
     * observe it would make the event trail lie about where the conclusion came from.
     *
     * @return true when the case moved
     */
    public boolean converge(UUID orgId, OperationsSubjectKind kind, UUID subjectId) {
        OperationsCase open = cases
                .findByOrgIdAndSubjectKindAndSubjectIdAndStatus(orgId, kind, subjectId, OperationsCaseStatus.PREPARED)
                .orElse(null);
        if (open == null) {
            return false;
        }
        Derived derived = derive(open);
        if (derived.status() == null) {
            return false;
        }
        apply(open, derived, null);
        return true;
    }

    Derived derive(OperationsCase c) {
        return switch (c.getSubjectKind()) {
            case INQUIRY -> deriveInquiry(c);
            case REVIEW -> deriveReview(c);
            case SOURCE -> accounts.findById(c.getSubjectId()).filter(a -> c.getOrgId().equals(a.getOrgId())).isEmpty()
                    ? new Derived(OperationsCaseStatus.CLOSED, CaseResolution.SUBJECT_GONE, CaseEventActor.SYSTEM,
                            "ACCOUNT_GONE")
                    : Derived.UNCHANGED;
        };
    }

    private Derived deriveInquiry(OperationsCase c) {
        Optional<Inquiry> found = inquiries.findById(c.getSubjectId()).filter(i -> c.getOrgId().equals(i.getOrgId()));
        if (found.isEmpty()) {
            return new Derived(OperationsCaseStatus.CLOSED, CaseResolution.SUBJECT_GONE, CaseEventActor.SYSTEM,
                    "INQUIRY_GONE");
        }
        Inquiry inquiry = found.get();
        Optional<InquiryWorkItem> workItem = (c.getWorkItemId() != null
                ? workItems.findById(c.getWorkItemId())
                : workItems.findByInquiryId(inquiry.getId()))
                .filter(w -> c.getOrgId().equals(w.getOrgId()));
        if (workItem.isPresent()) {
            InquiryWorkItemPhase phase = workItem.get().getPhase();
            if (phase == InquiryWorkItemPhase.COMPLETED && !"UNANSWERED".equals(inquiry.getStatus())
                    && cases.completedByActor(c.getOrgId(), workItem.get().getId(), CONNECTOR_INGEST_ACTOR)) {
                // Answered on the channel; the connector closed the work item. The first live run labelled this
                // SELLER_ACTED because the phase was read before the reason — the phase says done, not who did it.
                return new Derived(OperationsCaseStatus.CLOSED, CaseResolution.ANSWERED_ELSEWHERE,
                        CaseEventActor.SYSTEM, "INQUIRY_ANSWERED_ON_CHANNEL");
            }
            if (!InquiryWorkItemPhase.AWAITING_SELLER.contains(phase)) {
                if (phase == InquiryWorkItemPhase.DISMISSED) {
                    return new Derived(OperationsCaseStatus.CLOSED, CaseResolution.NOT_OPERATIONAL,
                            CaseEventActor.SELLER, "WORK_ITEM_" + phase.name());
                }
                // <b>A bound approval is not an action that reached anyone.</b> ACTION_PENDING is written by
                // the binding itself, before any transport is asked for, and it is also where a dispatch that
                // sent nothing comes back to. Reading the phase alone, this card closed as 「판매자가 조치함」
                // for a work item whose execution had never left ACTION_PENDING — the shape work item
                // 57ee2220 has held since 2026-08-20, approved into a deployment with no adapter. The phase
                // says the seller decided; only the execution row says whether anything was carried, so that
                // is what is asked. Every other phase already implies a dispatch was attempted and recorded.
                if (phase == InquiryWorkItemPhase.ACTION_PENDING
                        && !dispatchAttempted(c.getOrgId(), workItem.get().getId())) {
                    return Derived.UNCHANGED;
                }
                return new Derived(OperationsCaseStatus.ACTED, CaseResolution.SELLER_ACTED, CaseEventActor.SELLER,
                        "WORK_ITEM_" + phase.name() + delivery(c.getOrgId(), workItem.get().getId()));
            }
        }
        if (inquiry.getOperationalState() != null && inquiry.getOperationalState() != InquiryOperationalState.ACTIVE) {
            return new Derived(OperationsCaseStatus.CLOSED, CaseResolution.NOT_OPERATIONAL, CaseEventActor.SYSTEM,
                    "INQUIRY_" + inquiry.getOperationalState().name());
        }
        if (!"UNANSWERED".equals(inquiry.getStatus())) {
            return new Derived(OperationsCaseStatus.CLOSED, CaseResolution.ANSWERED_ELSEWHERE, CaseEventActor.SYSTEM,
                    "INQUIRY_ANSWERED");
        }
        return Derived.UNCHANGED;
    }

    /**
     * What the answer lifecycle observed for this work item, <b>quoted</b>.
     *
     * <p>The case still says only that the seller acted. Whether anything reached the customer is owned by the
     * package that writes the execution and verification rows, so its tokens are recorded here verbatim rather
     * than translated into a resolution of this vocabulary — which is why {@link CaseResolution} still has no
     * word for sent, executed or verified. An inquiry the seller moved on without an execution adds nothing:
     * absence of a row is not a delivery state.
     */
    /**
     * Whether the answer lifecycle ever got past «bound, nothing sent».
     *
     * <p>Reads the same row {@link #delivery} quotes, and asks it the one question this vocabulary is
     * allowed to ask: has the execution moved off {@code ACTION_PENDING}? No row at all is also a no —
     * a work item in ACTION_PENDING without an execution cannot have dispatched anything.
     */
    private boolean dispatchAttempted(UUID orgId, UUID workItemId) {
        return deliveries.observe(orgId, workItemId)
                .map(AnswerDeliveryTruthReader.AnswerDeliveryTruth::dispatchAttempted)
                .orElse(false);
    }

    private String delivery(UUID orgId, UUID workItemId) {
        return deliveries.observe(orgId, workItemId)
                .map(truth -> ";delivery=" + truth.status()
                        + ";outcome=" + truth.category()
                        + (truth.verified() == null ? "" : ";verified=" + truth.verified())
                        + (truth.observedSignal() == null ? "" : ";observed=" + truth.observedSignal()))
                .orElse("");
    }

    private Derived deriveReview(OperationsCase c) {
        Optional<Review> found = reviews.findById(c.getSubjectId()).filter(r -> c.getOrgId().equals(r.getOrgId()));
        if (found.isEmpty()) {
            return new Derived(OperationsCaseStatus.CLOSED, CaseResolution.SUBJECT_GONE, CaseEventActor.SYSTEM,
                    "REVIEW_GONE");
        }
        Review review = found.get();
        if (review.getReplyState() == ReviewReplyState.ANSWERED) {
            return new Derived(OperationsCaseStatus.ACTED, CaseResolution.ANSWERED_ON_CHANNEL, CaseEventActor.SELLER,
                    "REVIEW_ANSWERED");
        }
        if (cases.reviewDecidedSince(c.getOrgId(), review.getId(), c.getCreatedAt())) {
            return new Derived(OperationsCaseStatus.ACTED, CaseResolution.SELLER_ACTED, CaseEventActor.SELLER,
                    "REVIEW_TRIAGE_DECIDED");
        }
        if (c.getDisposition() == CaseDisposition.MONITORING && c.getUpdatedAt() != null
                && c.getUpdatedAt().isBefore(clock.instant().minus(MONITORING_WINDOW))) {
            return new Derived(OperationsCaseStatus.CLOSED, CaseResolution.MONITORING_ENDED, CaseEventActor.SYSTEM,
                    "MONITORING_WINDOW_PASSED");
        }
        return Derived.UNCHANGED;
    }

    private void apply(OperationsCase c, Derived derived, UUID runId) {
        Instant now = clock.instant();
        c.setStatus(derived.status());
        c.setResolutionReason(derived.resolution());
        c.setReconciledAt(now);
        if (derived.status() == OperationsCaseStatus.ACTED) {
            c.setActedAt(now);
        } else {
            c.setClosedAt(now);
        }
        OperationsCase saved = cases.save(c);
        events.save(OperationsCaseEvent.of(saved, runId, derived.actor(),
                derived.status() == OperationsCaseStatus.ACTED ? CaseEventKind.SELLER_ACTED
                        : CaseEventKind.RECONCILED_CLOSED,
                "{\"observed\":\"" + derived.detail() + "\"}"));
    }
}
