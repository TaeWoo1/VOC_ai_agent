package com.sellerops.proactive;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.common.DataOrigin;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryOperationalState;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItem;
import com.sellerops.inquiry.workitem.InquiryWorkItemPhase;
import com.sellerops.inquiry.workitem.InquiryWorkItemRepository;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewReplyState;
import com.sellerops.review.ReviewRepository;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * <b>The proactive loop does not repeat itself, and does not chase work that is over.</b>
 *
 * <p>These are the properties that decide whether the feature is usable at all. A loop that
 * re-prepares the same signal every ten minutes produces a screen the seller learns to ignore; a loop
 * that keeps showing an inquiry someone already answered on the channel is worse than no loop,
 * because it costs the seller a click to find out nothing happened.
 *
 * <p>The investigators are stubbed. What is under test here is the ORDER and the BOOKKEEPING — which
 * source states produce a new case, which close an old one, and which do neither — and a stub makes
 * that observable without running a model.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class ProactiveReconcilerTest {

    @Autowired InquiryRepository inquiries;
    @Autowired InquiryWorkItemRepository workItems;
    @Autowired ReviewRepository reviews;
    @Autowired ProactiveCaseRepository cases;

    private UUID org;
    private UUID channel;
    private UUID account;
    private AtomicInteger inquiryInvestigations;
    private ProactiveCaseReconciler reconciler;

    @BeforeEach
    void setUp() {
        org = UUID.randomUUID();
        channel = UUID.randomUUID();
        account = UUID.randomUUID();
        inquiryInvestigations = new AtomicInteger();

        ProactiveInquiryInvestigator inquiryStub = new ProactiveInquiryInvestigator(null, null) {
            @Override
            public Investigation investigate(UUID orgId, UUID workItemId) {
                inquiryInvestigations.incrementAndGet();
                return new Investigation(ProactivePreparedAction.DRAFT_PREPARED, 1, "GROUNDED", 2,
                        null, null);
            }
        };
        ProactiveReviewInvestigator reviewStub = new ProactiveReviewInvestigator(null, null) {
            @Override
            public Investigation investigate(UUID orgId, Review review) {
                return new Investigation(ProactiveReason.NEGATIVE_REVIEW, null, 0, "확인해 주세요.");
            }
        };
        reconciler = new ProactiveCaseReconciler(
                new ProactiveProperties(true, 5, 5, 50, Instant.EPOCH), cases, workItems, inquiries, reviews,
                inquiryStub, reviewStub,
                Clock.fixed(Instant.parse("2026-08-25T00:00:00Z"), ZoneOffset.UTC));
    }

    @Test
    @DisplayName("the same unchanged signal never produces a second card")
    void anUnchangedSignalIsInvestigatedOnce() {
        seedInquiry("UNANSWERED", InquiryOperationalState.ACTIVE, InquiryWorkItemPhase.OPEN, null);

        reconciler.tick(org);
        ProactiveCaseReconciler.TickReport second = reconciler.tick(org);
        reconciler.tick(org);

        assertThat(cases.findAll()).hasSize(1);
        assertThat(inquiryInvestigations).hasValue(1);
        assertThat(second.skippedUnchanged()).isEqualTo(1);
    }

    @Test
    @DisplayName("an inquiry answered on the channel closes its card and never comes back")
    void answeredElsewhereClosesTheCard() {
        UUID workItem = seedInquiry("UNANSWERED", InquiryOperationalState.ACTIVE,
                InquiryWorkItemPhase.OPEN, null);
        reconciler.tick(org);
        assertThat(open()).hasSize(1);

        // Someone answered it on the marketplace; the next routine collection wrote that back.
        Inquiry inquiry = inquiries.findById(inquiryIdOf(workItem)).orElseThrow();
        inquiry.setStatus("ANSWERED");
        inquiries.save(inquiry);

        reconciler.tick(org);

        assertThat(open()).isEmpty();
        assertThat(cases.findAll()).singleElement()
                .satisfies(row -> {
                    assertThat(row.getStatus()).isEqualTo(ProactiveCaseStatus.CLOSED);
                    assertThat(row.getCloseReason()).isEqualTo(ProactiveCloseReason.ANSWERED_ELSEWHERE);
                });

        // And a further tick does not resurrect it — the gate no longer selects it at all.
        reconciler.tick(org);
        assertThat(open()).isEmpty();
    }

    @Test
    @DisplayName("the seller acting on the work is what resolves the card")
    void sellerActionMarksTheCaseActed() {
        UUID workItem = seedInquiry("UNANSWERED", InquiryOperationalState.ACTIVE,
                InquiryWorkItemPhase.OPEN, null);
        reconciler.tick(org);

        InquiryWorkItem item = workItems.findById(workItem).orElseThrow();
        item.setPhase(InquiryWorkItemPhase.APPROVED);
        workItems.save(item);

        reconciler.tick(org);

        assertThat(cases.findAll()).singleElement().satisfies(row -> {
            assertThat(row.getStatus()).isEqualTo(ProactiveCaseStatus.ACTED);
            assertThat(row.getActedAt()).isNotNull();
            assertThat(row.getCloseReason()).isNull();
        });
    }

    @Test
    @DisplayName("a changed source state supersedes the old card rather than editing it")
    void aChangedSourceStateSupersedes() {
        UUID workItem = seedInquiry("UNANSWERED", InquiryOperationalState.ACTIVE,
                InquiryWorkItemPhase.OPEN, null);
        reconciler.tick(org);

        // The seller bound the inquiry to a product. The evidence available to a draft just changed,
        // so the previous investigation is no longer the best SellerOps can do.
        Inquiry inquiry = inquiries.findById(inquiryIdOf(workItem)).orElseThrow();
        inquiry.setProductId(UUID.randomUUID());
        inquiries.save(inquiry);
        // …and the work item is OPEN again for a fresh proposal (the earlier one is replayed).
        InquiryWorkItem item = workItems.findById(workItem).orElseThrow();
        item.setPhase(InquiryWorkItemPhase.OPEN);
        workItems.save(item);

        reconciler.tick(org);

        assertThat(cases.findAll()).hasSize(2);
        assertThat(open()).hasSize(1);
        assertThat(cases.findAll().stream()
                .filter(c -> c.getStatus() == ProactiveCaseStatus.CLOSED).toList())
                .singleElement()
                .satisfies(row -> assertThat(row.getCloseReason())
                        .isEqualTo(ProactiveCloseReason.SUPERSEDED));
    }

    @Test
    @DisplayName("a spam dismissal closes the card, and the audit says it was not the seller answering")
    void aDismissalClosesTheCard() {
        UUID workItem = seedInquiry("UNANSWERED", InquiryOperationalState.ACTIVE,
                InquiryWorkItemPhase.OPEN, null);
        reconciler.tick(org);

        InquiryWorkItem item = workItems.findById(workItem).orElseThrow();
        item.setPhase(InquiryWorkItemPhase.DISMISSED);
        workItems.save(item);
        Inquiry inquiry = inquiries.findById(inquiryIdOf(workItem)).orElseThrow();
        inquiry.setOperationalState(InquiryOperationalState.EXCLUDED_SPAM);
        inquiries.save(inquiry);

        reconciler.tick(org);

        assertThat(cases.findAll()).singleElement().satisfies(row -> {
            assertThat(row.getStatus()).isEqualTo(ProactiveCaseStatus.CLOSED);
            assertThat(row.getCloseReason()).isEqualTo(ProactiveCloseReason.NOT_OPERATIONAL);
            assertThat(row.getActedAt()).isNull();
        });
    }

    @Test
    @DisplayName("a review that stops needing attention closes its card")
    void aReviewThatStopsNeedingAttentionCloses() {
        Review review = new Review();
        review.setOrgId(org);
        review.setChannelId(channel);
        review.setRating(1);
        review.setBody("포장이 찢어져 있었습니다");
        review.setNegative(true);
        review.setReplyState(ReviewReplyState.UNKNOWN);
        review.setDataOrigin(DataOrigin.REAL);
        review.setReceivedAt(Instant.parse("2026-08-20T00:00:00Z"));
        UUID reviewId = reviews.save(review).getId();

        reconciler.tick(org);
        assertThat(open()).hasSize(1);

        Review answered = reviews.findById(reviewId).orElseThrow();
        answered.setReplyState(ReviewReplyState.ANSWERED);
        reviews.save(answered);

        reconciler.tick(org);

        assertThat(cases.findAll()).singleElement()
                .satisfies(row -> assertThat(row.getStatus()).isEqualTo(ProactiveCaseStatus.ACTED));
    }

    @Test
    @DisplayName("the per-tick budget is a cap on NEW investigations, not on the backlog")
    void theBudgetCapsOneTick() {
        for (int i = 0; i < 8; i++) {
            seedInquiry("UNANSWERED", InquiryOperationalState.ACTIVE, InquiryWorkItemPhase.OPEN,
                    "문의 " + i);
        }
        ProactiveCaseReconciler bounded = new ProactiveCaseReconciler(
                new ProactiveProperties(true, 3, 0, 50, Instant.EPOCH), cases, workItems, inquiries, reviews,
                new ProactiveInquiryInvestigator(null, null) {
                    @Override
                    public Investigation investigate(UUID orgId, UUID workItemId) {
                        return new Investigation(ProactivePreparedAction.DRAFT_PREPARED, 1,
                                "NO_MATCH", 0, "운영 기준을 추가해 주세요.", null);
                    }
                },
                new ProactiveReviewInvestigator(null, null),
                Clock.fixed(Instant.parse("2026-08-25T00:00:00Z"), ZoneOffset.UTC));

        assertThat(bounded.tick(org).preparedInquiries()).isEqualTo(3);
        assertThat(bounded.tick(org).preparedInquiries()).isEqualTo(3);
        assertThat(bounded.tick(org).preparedInquiries()).isEqualTo(2);
        assertThat(bounded.tick(org).preparedInquiries()).isZero();
        assertThat(open()).hasSize(8);
    }


    @Test
    @DisplayName("with no stated boundary nothing is ever prepared — but reconcile still runs")
    void noBoundaryMeansNoPreparation() {
        seedInquiry("UNANSWERED", InquiryOperationalState.ACTIVE, InquiryWorkItemPhase.OPEN, null);
        ProactiveCaseReconciler failClosed = new ProactiveCaseReconciler(
                new ProactiveProperties(true, 5, 5, 50, (Instant) null), cases, workItems, inquiries, reviews,
                new ProactiveInquiryInvestigator(null, null) {
                    @Override
                    public Investigation investigate(UUID orgId, UUID workItemId) {
                        throw new AssertionError("an unfenced org must never reach an investigation");
                    }
                },
                new ProactiveReviewInvestigator(null, null) {
                    @Override
                    public Investigation investigate(UUID orgId, Review review) {
                        throw new AssertionError("an unfenced org must never reach an investigation");
                    }
                },
                Clock.fixed(Instant.parse("2026-08-25T00:00:00Z"), ZoneOffset.UTC));

        ProactiveCaseReconciler.TickReport report = failClosed.tick(org);

        assertThat(report.preparedInquiries()).isZero();
        assertThat(report.preparedReviews()).isZero();
        assertThat(cases.findAll()).isEmpty();
    }

    @Test
    @DisplayName("reconcile is never fenced — a card whose work is done must close, boundary or not")
    void reconcileRunsWithoutABoundary() {
        UUID workItem = seedInquiry("UNANSWERED", InquiryOperationalState.ACTIVE,
                InquiryWorkItemPhase.OPEN, null);
        reconciler.tick(org);   // fence open: one card exists
        assertThat(open()).hasSize(1);

        Inquiry answered = inquiries.findById(inquiryIdOf(workItem)).orElseThrow();
        answered.setStatus("ANSWERED");
        inquiries.save(answered);

        // Now with NO boundary at all. Preparation is off; closing a finished card is not optional.
        new ProactiveCaseReconciler(
                new ProactiveProperties(true, 5, 5, 50, (Instant) null), cases, workItems, inquiries, reviews,
                new ProactiveInquiryInvestigator(null, null), new ProactiveReviewInvestigator(null, null),
                Clock.fixed(Instant.parse("2026-08-25T00:00:00Z"), ZoneOffset.UTC)).tick(org);

        assertThat(open()).isEmpty();
    }

    // ------------------------------------------------------------------ helpers

    private List<ProactiveCase> open() {
        return cases.findAll().stream()
                .filter(c -> c.getStatus() == ProactiveCaseStatus.PREPARED).toList();
    }

    private UUID inquiryIdOf(UUID workItemId) {
        return workItems.findById(workItemId).orElseThrow().getInquiryId();
    }

    private UUID seedInquiry(String status, InquiryOperationalState state,
                             InquiryWorkItemPhase phase, String title) {
        Inquiry q = new Inquiry();
        q.setOrgId(org);
        q.setChannelId(channel);
        q.setSellerAccountId(account);
        q.setTitle(title == null ? "배송 언제 되나요" : title);
        q.setBody("본문");
        q.setStatus(status);
        q.setDataOrigin(DataOrigin.REAL);
        q.setOperationalState(state);
        q.setThreadRole("ROOT");
        q.setContentHash(UUID.randomUUID().toString());
        q.setReceivedAt(Instant.parse("2026-08-20T00:00:00Z"));
        UUID inquiryId = inquiries.save(q).getId();

        InquiryWorkItem w = new InquiryWorkItem();
        w.setOrgId(org);
        w.setInquiryId(inquiryId);
        w.setSellerAccountId(account);
        w.setChannelId(channel);
        w.setPhase(phase);
        return workItems.save(w).getId();
    }
}
