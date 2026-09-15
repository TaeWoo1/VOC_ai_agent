package com.sellerops.operationscase;

import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryOperationalState;
import com.sellerops.inquiry.InquiryRepository;
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
 *   having acted (which phase it reached is on the work item's own audit — this never says «sent» or «verified»); an
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
    private final Clock clock;

    @Autowired
    public OperationsCaseReconciler(OperationsCaseRepository cases, OperationsCaseEventRepository events,
                                    InquiryRepository inquiries, InquiryWorkItemRepository workItems,
                                    ReviewRepository reviews, SellerAccountRepository accounts) {
        this(cases, events, inquiries, workItems, reviews, accounts, Clock.systemUTC());
    }

    public OperationsCaseReconciler(OperationsCaseRepository cases, OperationsCaseEventRepository events,
                                    InquiryRepository inquiries, InquiryWorkItemRepository workItems,
                                    ReviewRepository reviews, SellerAccountRepository accounts, Clock clock) {
        this.cases = cases;
        this.events = events;
        this.inquiries = inquiries;
        this.workItems = workItems;
        this.reviews = reviews;
        this.accounts = accounts;
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
                return phase == InquiryWorkItemPhase.DISMISSED
                        ? new Derived(OperationsCaseStatus.CLOSED, CaseResolution.NOT_OPERATIONAL,
                                CaseEventActor.SELLER, "WORK_ITEM_" + phase.name())
                        : new Derived(OperationsCaseStatus.ACTED, CaseResolution.SELLER_ACTED,
                                CaseEventActor.SELLER, "WORK_ITEM_" + phase.name());
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
