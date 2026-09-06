package com.sellerops.proactive;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.agent.quota.AgentLlmUsage;
import com.sellerops.agent.quota.AgentLlmUsageRepository;
import com.sellerops.agent.quota.AgentQuotaProperties;
import com.sellerops.agent.quota.AgentQuotaService;
import com.sellerops.agent.quota.AgentUsageKind;
import com.sellerops.common.DataOrigin;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryOperationalState;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItem;
import com.sellerops.inquiry.workitem.InquiryWorkItemPhase;
import com.sellerops.inquiry.workitem.InquiryWorkItemRepository;
import com.sellerops.organization.Organization;
import com.sellerops.organization.OrganizationRepository;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewReplyState;
import com.sellerops.review.ReviewRepository;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
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
import org.springframework.boot.test.autoconfigure.orm.jpa.TestEntityManager;
import org.springframework.test.context.ActiveProfiles;

/**
 * <b>What the proactive loop is allowed to spend, and what it is allowed to look at.</b>
 *
 * <p>Three properties decide whether this feature is usable rather than merely working. It must not
 * repeat itself — a screen that re-raises the same signal every ten minutes is one a seller learns to
 * ignore. It must not chase work that is over — a card for an inquiry someone already answered costs
 * a click to discover nothing happened. And it must not outspend the person it is working for: the
 * investigation draws on the same daily AI budget a seller-initiated draft does, so an unbounded loop
 * would quietly turn every draft the seller asked for into a deterministic fallback.
 *
 * <p>The investigators are stubbed. What is under test is the ORDER, the BUDGET and the BOOKKEEPING —
 * which candidates are selected, how many, and which source states produce, close, or skip a case.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class ProactiveReconcilerTest {

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");

    @Autowired InquiryRepository inquiries;
    @Autowired InquiryWorkItemRepository workItems;
    @Autowired ReviewRepository reviews;
    @Autowired ProactiveCaseRepository cases;
    @Autowired OrganizationRepository organizations;
    @Autowired AgentLlmUsageRepository llmUsage;
    @Autowired TestEntityManager entityManager;

    private UUID org;
    private UUID channel;
    private UUID account;
    private AtomicInteger investigations;
    private Instant now;

    @BeforeEach
    void setUp() {
        Organization organization = new Organization();
        organization.setName("proactive-test");
        org = organizations.save(organization).getId();
        channel = UUID.randomUUID();
        account = UUID.randomUUID();
        investigations = new AtomicInteger();
        now = Instant.parse("2026-08-25T03:00:00Z");   // midday KST
    }

    // ------------------------------------------------------------------ the activation baseline

    @Test
    @DisplayName("the first tick records the org's activation baseline and prepares nothing")
    void activationIsTheBaseline() {
        seedInquiry("UNANSWERED", InquiryOperationalState.ACTIVE, InquiryWorkItemPhase.OPEN, null);

        ProactiveCaseReconciler.TickReport first = reconciler().tick(org);

        assertThat(organizations.findById(org).orElseThrow().getProactiveBaselineAt()).isEqualTo(now);
        assertThat(first.preparedInquiries() + first.preparedReviews()).isZero();
        assertThat(investigations).hasValue(0);
    }

    @Test
    @DisplayName("work observed before the baseline is historical backlog, forever")
    void preBaselineWorkIsNeverACandidate() {
        // The shape that made this fence necessary: an org's whole imported history, every row real,
        // unanswered and operational, all of it first observed in one backfill days before anyone
        // decided to switch this feature on.
        UUID inquiryWorkItem = seedInquiry("UNANSWERED", InquiryOperationalState.ACTIVE,
                InquiryWorkItemPhase.OPEN, null);
        UUID reviewId = seedReview(1, "포장이 찢어져 있었습니다");
        stampObserved(inquiryWorkItem, reviewId, Instant.parse("2026-08-01T00:00:00Z"));
        activate(Instant.parse("2026-08-20T00:00:00Z"));

        // Many ticks, not one: "not yet" and "never" are different claims and only the second is true.
        for (int i = 0; i < 5; i++) {
            reconciler().tick(org);
        }

        assertThat(cases.findAll()).isEmpty();
        assertThat(investigations).hasValue(0);
    }

    @Test
    @DisplayName("a pre-baseline row that is merely TOUCHED does not become current work")
    void aTouchIsNotAnObservation() {
        UUID workItem = seedInquiry("UNANSWERED", InquiryOperationalState.ACTIVE,
                InquiryWorkItemPhase.OPEN, null);
        UUID reviewId = seedReview(1, "포장이 찢어져 있었습니다");
        stampObserved(workItem, reviewId, Instant.parse("2026-08-01T00:00:00Z"));
        activate(Instant.parse("2026-08-20T00:00:00Z"));

        // Routine collection re-saves what it re-sees; on the canonical Demo Org that meant 3,266 of
        // 3,334 rows carried an update newer than their insert. If freshness were read off updated_at
        // or last_seen_at, one sweep would call an org's entire history new.
        Inquiry inquiry = inquiries.findById(inquiryIdOf(workItem)).orElseThrow();
        inquiry.setLastSeenAt(now);
        inquiries.save(inquiry);
        Review review = reviews.findById(reviewId).orElseThrow();
        reviews.save(review);
        entityManager.flush();

        reconciler().tick(org);

        assertThat(cases.findAll()).isEmpty();
    }

    @Test
    @DisplayName("work first observed after the baseline is candidate work")
    void postBaselineWorkIsPrepared() {
        activate(Instant.parse("2026-08-20T00:00:00Z"));
        seedInquiry("UNANSWERED", InquiryOperationalState.ACTIVE, InquiryWorkItemPhase.OPEN, null);

        reconciler().tick(org);

        assertThat(cases.findAll()).singleElement().satisfies(row -> {
            assertThat(row.getSubjectKind()).isEqualTo(ProactiveSubjectKind.INQUIRY);
            assertThat(row.getStatus()).isEqualTo(ProactiveCaseStatus.PREPARED);
        });
    }

    @Test
    @DisplayName("one org's baseline and cases never touch another's")
    void everythingIsOrgScoped() {
        Organization other = new Organization();
        other.setName("other");
        UUID otherOrg = organizations.save(other).getId();
        activate(Instant.parse("2026-08-20T00:00:00Z"));
        seedInquiry("UNANSWERED", InquiryOperationalState.ACTIVE, InquiryWorkItemPhase.OPEN, null);

        reconciler().tick(org);

        assertThat(cases.findAll()).hasSize(1);
        assertThat(cases.findAll().get(0).getOrgId()).isEqualTo(org);
        assertThat(organizations.findById(otherOrg).orElseThrow().getProactiveBaselineAt())
                .as("a tick for one org must not activate another")
                .isNull();
        assertThat(cases.countByOrgIdAndStatus(otherOrg, ProactiveCaseStatus.PREPARED)).isZero();
    }

    // ------------------------------------------------------------------ the daily budget

    @Test
    @DisplayName("three a day, across both kinds together — and the fourth never reaches a model")
    void theDailyCapIsGlobalAndHolds() {
        activate(Instant.parse("2026-08-20T00:00:00Z"));
        for (int i = 0; i < 4; i++) {
            seedInquiry("UNANSWERED", InquiryOperationalState.ACTIVE, InquiryWorkItemPhase.OPEN,
                    "문의 " + i);
        }
        for (int i = 0; i < 4; i++) {
            seedReview(1, "불량입니다 " + i);
        }

        // Many ticks in the same day. A per-tick cap would have allowed three per tick.
        for (int i = 0; i < 6; i++) {
            reconciler().tick(org);
        }

        assertThat(cases.findAll()).hasSize(3);
        assertThat(investigations)
                .as("the cap is on SPEND, so it must be enforced before the investigation, not after")
                .hasValue(3);
        assertThat(cases.findAll()).allSatisfy(row ->
                assertThat(row.getStatus()).isEqualTo(ProactiveCaseStatus.PREPARED));
    }

    @Test
    @DisplayName("a new day is a new budget — yesterday's spend does not count against today")
    void theCapIsDaily() {
        activate(Instant.parse("2026-08-20T00:00:00Z"));
        for (int i = 0; i < 5; i++) {
            seedInquiry("UNANSWERED", InquiryOperationalState.ACTIVE, InquiryWorkItemPhase.OPEN,
                    "문의 " + i);
        }

        reconciler().tick(org);
        assertThat(cases.findAll()).hasSize(3);

        // Age the three into yesterday. The cap counts cases created inside TODAY's window — the same
        // Asia/Seoul day the Agent quota uses — so a day that has rolled over frees the budget without
        // anything being deleted or reset. (Backdated here rather than by moving the injected clock:
        // created_at is stamped by the persistence layer's own clock, which is the correct production
        // behaviour and the reason this has to be simulated at the row.)
        for (ProactiveCase row : cases.findAll()) {
            entityManager.getEntityManager()
                    .createQuery("update ProactiveCase c set c.createdAt = :at where c.id = :id")
                    .setParameter("at", now.minus(java.time.Duration.ofDays(1)))
                    .setParameter("id", row.getId()).executeUpdate();
        }
        entityManager.clear();

        reconciler().tick(org);

        assertThat(cases.findAll()).as("the remaining two, not three more").hasSize(5);
    }

    @Test
    @DisplayName("an exhausted shared Agent quota stops preparation — the loop yields to the person")
    void anExhaustedQuotaStopsPreparation() {
        activate(Instant.parse("2026-08-20T00:00:00Z"));
        seedInquiry("UNANSWERED", InquiryOperationalState.ACTIVE, InquiryWorkItemPhase.OPEN, null);
        // The org has spent its day. proactive reserve is 0, so there is nothing held back for it.
        //
        // Seeded against the REAL Asia/Seoul date, not the injected clock's, because that is the day
        // AgentQuotaService itself reads — it takes the system clock, and the loop deliberately reuses
        // its day rather than answering "when did today start" a second time. Keying this off the
        // injected instant passed for as long as the two happened to agree and failed the first
        // midnight after, which is the whole reason it is spelled out here.
        LocalDate today = LocalDate.now(KST);
        for (int i = 0; i < 2; i++) {
            AgentLlmUsage row = new AgentLlmUsage();
            row.setOrgId(org);
            row.setUsageDate(today);
            row.setKind(AgentUsageKind.DRAFT);
            llmUsage.save(row);
        }

        ProactiveCaseReconciler.TickReport report = reconciler(2).tick(org);

        assertThat(report.preparedInquiries() + report.preparedReviews()).isZero();
        assertThat(cases.findAll()).isEmpty();
        assertThat(investigations).hasValue(0);
    }

    @Test
    @DisplayName("reconcile runs on a spent budget — closing finished work is not a purchase")
    void reconcileIsNeverBudgeted() {
        activate(Instant.parse("2026-08-20T00:00:00Z"));
        UUID workItem = seedInquiry("UNANSWERED", InquiryOperationalState.ACTIVE,
                InquiryWorkItemPhase.OPEN, null);
        reconciler().tick(org);
        assertThat(open()).hasSize(1);

        Inquiry answered = inquiries.findById(inquiryIdOf(workItem)).orElseThrow();
        answered.setStatus("ANSWERED");
        inquiries.save(answered);

        // Cap of zero: nothing may be prepared, and the finished card must still close.
        ProactiveCaseReconciler.TickReport report = reconcilerWithCap(0).tick(org);

        assertThat(report.reconciled()).isEqualTo(1);
        assertThat(open()).isEmpty();
        assertThat(cases.findAll()).singleElement().satisfies(row -> {
            assertThat(row.getStatus()).isEqualTo(ProactiveCaseStatus.CLOSED);
            assertThat(row.getCloseReason()).isEqualTo(ProactiveCloseReason.ANSWERED_ELSEWHERE);
        });
    }

    // ------------------------------------------------------------------ global selection

    @Test
    @DisplayName("the budget buys the most urgent work of EITHER kind, newest observed first")
    void selectionIsGlobalAndExplainable() {
        activate(Instant.parse("2026-08-20T00:00:00Z"));
        // A NORMAL review observed most recently, and two HIGH items observed earlier. A per-lane
        // budget would have bought the review; one selection buys urgency first.
        UUID oldInquiry = seedInquiry("UNANSWERED", InquiryOperationalState.ACTIVE,
                InquiryWorkItemPhase.OPEN, "오래된 문의");
        UUID severeReview = seedReview(1, "최악입니다");
        UUID mildReview = seedReview(2, "조금 아쉽습니다");
        stampObserved(oldInquiry, null, Instant.parse("2026-08-21T00:00:00Z"));
        stampObserved(null, severeReview, Instant.parse("2026-08-22T00:00:00Z"));
        stampObserved(null, mildReview, Instant.parse("2026-08-24T00:00:00Z"));

        reconcilerWithCap(2).tick(org);

        assertThat(cases.findAll()).hasSize(2);
        assertThat(cases.findAll()).allSatisfy(row ->
                assertThat(row.getPriority()).isEqualTo(ProactivePriority.HIGH));
        assertThat(cases.findAll()).extracting(ProactiveCase::getSubjectId)
                .containsExactlyInAnyOrder(inquiryIdOf(oldInquiry), severeReview);
    }

    // ------------------------------------------------------------------ dedupe and stale

    @Test
    @DisplayName("the same unchanged signal never produces a second card")
    void anUnchangedSignalIsInvestigatedOnce() {
        activate(Instant.parse("2026-08-20T00:00:00Z"));
        seedInquiry("UNANSWERED", InquiryOperationalState.ACTIVE, InquiryWorkItemPhase.OPEN, null);

        reconciler().tick(org);
        ProactiveCaseReconciler.TickReport second = reconciler().tick(org);

        assertThat(cases.findAll()).hasSize(1);
        assertThat(investigations).hasValue(1);
        assertThat(second.skippedUnchanged()).isEqualTo(1);
    }

    @Test
    @DisplayName("an inquiry answered on the channel closes its card and never comes back")
    void answeredElsewhereClosesTheCard() {
        activate(Instant.parse("2026-08-20T00:00:00Z"));
        UUID workItem = seedInquiry("UNANSWERED", InquiryOperationalState.ACTIVE,
                InquiryWorkItemPhase.OPEN, null);
        reconciler().tick(org);
        assertThat(open()).hasSize(1);

        Inquiry inquiry = inquiries.findById(inquiryIdOf(workItem)).orElseThrow();
        inquiry.setStatus("ANSWERED");
        inquiries.save(inquiry);

        reconciler().tick(org);
        reconciler().tick(org);

        assertThat(open()).isEmpty();
        assertThat(cases.findAll()).singleElement().satisfies(row -> {
            assertThat(row.getStatus()).isEqualTo(ProactiveCaseStatus.CLOSED);
            assertThat(row.getCloseReason()).isEqualTo(ProactiveCloseReason.ANSWERED_ELSEWHERE);
        });
    }

    @Test
    @DisplayName("the seller acting on the work is what resolves the card")
    void sellerActionMarksTheCaseActed() {
        activate(Instant.parse("2026-08-20T00:00:00Z"));
        UUID workItem = seedInquiry("UNANSWERED", InquiryOperationalState.ACTIVE,
                InquiryWorkItemPhase.OPEN, null);
        reconciler().tick(org);

        InquiryWorkItem item = workItems.findById(workItem).orElseThrow();
        item.setPhase(InquiryWorkItemPhase.APPROVED);
        workItems.save(item);

        reconciler().tick(org);

        assertThat(cases.findAll()).singleElement().satisfies(row -> {
            assertThat(row.getStatus()).isEqualTo(ProactiveCaseStatus.ACTED);
            assertThat(row.getActedAt()).isNotNull();
            assertThat(row.getCloseReason()).isNull();
        });
    }

    @Test
    @DisplayName("a changed source state supersedes the old card rather than editing it")
    void aChangedSourceStateSupersedes() {
        activate(Instant.parse("2026-08-20T00:00:00Z"));
        UUID workItem = seedInquiry("UNANSWERED", InquiryOperationalState.ACTIVE,
                InquiryWorkItemPhase.OPEN, null);
        reconciler().tick(org);

        // The seller bound the inquiry to a product: the evidence available to a draft just changed.
        Inquiry inquiry = inquiries.findById(inquiryIdOf(workItem)).orElseThrow();
        inquiry.setProductId(UUID.randomUUID());
        inquiries.save(inquiry);
        InquiryWorkItem item = workItems.findById(workItem).orElseThrow();
        item.setPhase(InquiryWorkItemPhase.OPEN);
        workItems.save(item);

        reconciler().tick(org);

        assertThat(cases.findAll()).hasSize(2);
        assertThat(open()).hasSize(1);
        assertThat(cases.findAll().stream()
                .filter(c -> c.getStatus() == ProactiveCaseStatus.CLOSED).toList())
                .singleElement()
                .satisfies(row -> assertThat(row.getCloseReason())
                        .isEqualTo(ProactiveCloseReason.SUPERSEDED));
    }

    @Test
    @DisplayName("a spam dismissal closes the card, and never reads as the seller answering")
    void aDismissalClosesTheCard() {
        activate(Instant.parse("2026-08-20T00:00:00Z"));
        UUID workItem = seedInquiry("UNANSWERED", InquiryOperationalState.ACTIVE,
                InquiryWorkItemPhase.OPEN, null);
        reconciler().tick(org);

        InquiryWorkItem item = workItems.findById(workItem).orElseThrow();
        item.setPhase(InquiryWorkItemPhase.DISMISSED);
        workItems.save(item);
        Inquiry inquiry = inquiries.findById(inquiryIdOf(workItem)).orElseThrow();
        inquiry.setOperationalState(InquiryOperationalState.EXCLUDED_SPAM);
        inquiries.save(inquiry);

        reconciler().tick(org);

        assertThat(cases.findAll()).singleElement().satisfies(row -> {
            assertThat(row.getStatus()).isEqualTo(ProactiveCaseStatus.CLOSED);
            assertThat(row.getCloseReason()).isEqualTo(ProactiveCloseReason.NOT_OPERATIONAL);
            assertThat(row.getActedAt()).isNull();
        });
    }

    @Test
    @DisplayName("a review that acquires a reply is resolved, not re-raised")
    void anAnsweredReviewIsResolved() {
        activate(Instant.parse("2026-08-20T00:00:00Z"));
        UUID reviewId = seedReview(1, "포장이 찢어져 있었습니다");
        reconciler().tick(org);
        assertThat(open()).hasSize(1);

        Review answered = reviews.findById(reviewId).orElseThrow();
        answered.setReplyState(ReviewReplyState.ANSWERED);
        reviews.save(answered);

        reconciler().tick(org);

        assertThat(cases.findAll()).singleElement()
                .satisfies(row -> assertThat(row.getStatus()).isEqualTo(ProactiveCaseStatus.ACTED));
    }

    // ------------------------------------------------------------------ wiring

    private ProactiveCaseReconciler reconciler() {
        return reconcilerWithCap(3);
    }

    /** @param llmCallsLimit the org's shared daily Agent budget */
    private ProactiveCaseReconciler reconciler(int llmCallsLimit) {
        return build(3, llmCallsLimit, now);
    }

    private ProactiveCaseReconciler reconcilerWithCap(int dailyCap) {
        return build(dailyCap, 1000, now);
    }

    private ProactiveCaseReconciler reconcilerAt(Instant at) {
        return build(3, 1000, at);
    }

    private ProactiveCaseReconciler build(int dailyCap, int llmCallsLimit, Instant at) {
        ProactiveInquiryInvestigator inquiryStub = new ProactiveInquiryInvestigator(null, null) {
            @Override
            public Investigation investigate(UUID orgId, UUID workItemId) {
                investigations.incrementAndGet();
                return new Investigation(ProactivePreparedAction.DRAFT_PREPARED, 1, "GROUNDED", 2,
                        null, null);
            }
        };
        ProactiveReviewInvestigator reviewStub = new ProactiveReviewInvestigator(null, null) {
            @Override
            public Investigation investigate(UUID orgId, Review review) {
                investigations.incrementAndGet();
                return new Investigation(
                        review.getRating() != null && review.getRating() <= 1
                                ? ProactiveReason.SEVERE_NEGATIVE_REVIEW : ProactiveReason.NEGATIVE_REVIEW,
                        null, 0, "확인해 주세요.");
            }
        };
        return new ProactiveCaseReconciler(
                new ProactiveProperties(true, dailyCap, 50, 50, List.of(org)),
                cases, workItems, inquiries, reviews, inquiryStub, reviewStub, organizations,
                new AgentQuotaService(llmUsage, new AgentQuotaProperties(true, true, false, 1000, llmCallsLimit)),
                Clock.fixed(at, ZoneOffset.UTC));
    }

    /** Activate the org at a stated instant, the way a first tick would have. */
    private void activate(Instant at) {
        Organization organization = organizations.findById(org).orElseThrow();
        organization.setProactiveBaselineAt(at);
        organizations.save(organization);
        entityManager.flush();
    }

    /** Rewrite when SellerOps first observed a row — the column is not settable through the entity. */
    private void stampObserved(UUID workItemId, UUID reviewId, Instant at) {
        if (workItemId != null) {
            entityManager.getEntityManager()
                    .createQuery("update InquiryWorkItem w set w.createdAt = :at where w.id = :id")
                    .setParameter("at", at).setParameter("id", workItemId).executeUpdate();
        }
        if (reviewId != null) {
            entityManager.getEntityManager()
                    .createQuery("update Review r set r.createdAt = :at where r.id = :id")
                    .setParameter("at", at).setParameter("id", reviewId).executeUpdate();
        }
        entityManager.clear();
    }

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

    private UUID seedReview(Integer rating, String body) {
        Review r = new Review();
        r.setOrgId(org);
        r.setChannelId(channel);
        r.setRating(rating);
        r.setBody(body);
        r.setNegative(true);
        r.setReplyState(ReviewReplyState.UNKNOWN);
        r.setDataOrigin(DataOrigin.REAL);
        r.setContentHash(UUID.randomUUID().toString());
        r.setReceivedAt(Instant.parse("2026-08-20T00:00:00Z"));
        return reviews.save(r).getId();
    }
}
