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
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.data.domain.PageRequest;
import org.springframework.test.context.ActiveProfiles;

/**
 * <b>What the proactive loop is allowed to look at</b> — the deterministic gate, asserted against a
 * real database because every clause in it is SQL.
 *
 * <p>This is the test that carries the v1 acceptance list's negative requirements: a source thread
 * reply is never a candidate, a dismissed inquiry is never a candidate, a manufactured row is never
 * a candidate, an answered row is never a candidate, and no org ever sees another's.
 *
 * <p>It deliberately proves those by <b>seeding the state and reading the gate</b>, rather than by
 * reading the gate's source. A predicate that looks right and selects wrong is the failure this is
 * for.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class ProactiveCandidateGateTest {

    @Autowired InquiryRepository inquiries;
    @Autowired InquiryWorkItemRepository workItems;
    @Autowired ReviewRepository reviews;
    @Autowired org.springframework.boot.test.autoconfigure.orm.jpa.TestEntityManager entityManager;

    private UUID org;
    private UUID otherOrg;
    private UUID channel;
    private UUID account;

    @BeforeEach
    void setUp() {
        org = UUID.randomUUID();
        otherOrg = UUID.randomUUID();
        channel = UUID.randomUUID();
        account = UUID.randomUUID();
    }

    // ------------------------------------------------------------------ inquiries

    @Test
    @DisplayName("an unanswered customer question the seller has not started IS a candidate")
    void theOrdinaryCaseIsSelected() {
        UUID workItem = seedInquiry(org, "UNANSWERED", InquiryOperationalState.ACTIVE, "ROOT",
                DataOrigin.REAL, InquiryWorkItemPhase.OPEN);

        assertThat(candidateWorkItems(org)).containsExactly(workItem);
    }

    @Test
    @DisplayName("a source thread REPLY is never a candidate — the seller's own answer is not a question")
    void aThreadReplyIsNeverACandidate() {
        // Both fences, one at a time. First the projection the connector writes at ingest…
        seedInquiry(org, "UNANSWERED", InquiryOperationalState.EXCLUDED_THREAD_REPLY, "REPLY",
                DataOrigin.REAL, InquiryWorkItemPhase.OPEN);
        assertThat(candidateWorkItems(org)).isEmpty();

        // …and then the case the second fence exists for: a row whose role the source declared but
        // whose projection has not been applied. This is the shape a future ingest path could produce
        // by forgetting to project, and it must still not reach an investigation.
        seedInquiry(org, "UNANSWERED", InquiryOperationalState.ACTIVE, "REPLY",
                DataOrigin.REAL, InquiryWorkItemPhase.OPEN);
        assertThat(candidateWorkItems(org)).isEmpty();
    }

    @Test
    @DisplayName("an inquiry the seller dismissed as spam is never a candidate")
    void aDismissedInquiryIsNeverACandidate() {
        seedInquiry(org, "UNANSWERED", InquiryOperationalState.EXCLUDED_SPAM, "ROOT",
                DataOrigin.REAL, InquiryWorkItemPhase.OPEN);

        assertThat(candidateWorkItems(org)).isEmpty();
    }

    @Test
    @DisplayName("an answered inquiry is never a candidate, whatever its work item still says")
    void anAnsweredInquiryIsNeverACandidate() {
        seedInquiry(org, "ANSWERED", InquiryOperationalState.ACTIVE, "ROOT",
                DataOrigin.REAL, InquiryWorkItemPhase.OPEN);

        assertThat(candidateWorkItems(org)).isEmpty();
    }

    @Test
    @DisplayName("a manufactured inquiry is never a candidate — the CTA on this card ends at a customer")
    void aSyntheticInquiryIsNeverACandidate() {
        seedInquiry(org, "UNANSWERED", InquiryOperationalState.ACTIVE, "ROOT",
                DataOrigin.DEMO_SEED, InquiryWorkItemPhase.OPEN);

        assertThat(candidateWorkItems(org)).isEmpty();
    }

    @Test
    @DisplayName("work the seller has already started is not proactive work")
    void anItemAlreadyBeingWorkedIsNotACandidate() {
        for (InquiryWorkItemPhase phase : List.of(InquiryWorkItemPhase.PROPOSED,
                InquiryWorkItemPhase.APPROVED, InquiryWorkItemPhase.ACTION_PENDING,
                InquiryWorkItemPhase.EXECUTED, InquiryWorkItemPhase.COMPLETED,
                InquiryWorkItemPhase.DISMISSED, InquiryWorkItemPhase.FAILED,
                InquiryWorkItemPhase.REJECTED)) {
            seedInquiry(org, "UNANSWERED", InquiryOperationalState.ACTIVE, "ROOT", DataOrigin.REAL, phase);
        }

        assertThat(candidateWorkItems(org)).isEmpty();
    }

    @Test
    @DisplayName("one org's candidates never include another's")
    void candidatesAreOrgScoped() {
        UUID mine = seedInquiry(org, "UNANSWERED", InquiryOperationalState.ACTIVE, "ROOT",
                DataOrigin.REAL, InquiryWorkItemPhase.OPEN);
        seedInquiry(otherOrg, "UNANSWERED", InquiryOperationalState.ACTIVE, "ROOT",
                DataOrigin.REAL, InquiryWorkItemPhase.OPEN);

        assertThat(candidateWorkItems(org)).containsExactly(mine);
        assertThat(candidateWorkItems(org)).hasSize(1);
    }

    // ------------------------------------------------------------------ reviews

    @Test
    @DisplayName("the review gate is the existing 확인 필요 rule — nothing wider, nothing new")
    void theReviewGateIsTheExistingTier() {
        UUID oneStarWithText = seedReview(org, 1, "포장이 다 찢어져서 왔어요", ReviewReplyState.UNKNOWN);
        UUID twoStarWithText = seedReview(org, 2, "생각보다 얇습니다", ReviewReplyState.PENDING);
        // Everything the existing rule ranks below 확인 필요 stays out: a textless low rating (there is
        // nothing to read), a middling rating, a good rating, and an unrated row.
        seedReview(org, 1, "   ", ReviewReplyState.UNKNOWN);
        seedReview(org, 3, "무난합니다", ReviewReplyState.UNKNOWN);
        seedReview(org, 5, "좋아요", ReviewReplyState.UNKNOWN);
        seedReview(org, null, "평점 없음", ReviewReplyState.UNKNOWN);

        assertThat(candidateReviews(org)).containsExactlyInAnyOrder(oneStarWithText, twoStarWithText);
    }

    @Test
    @DisplayName("a review that already has a reply is not proactive work")
    void anAnsweredReviewIsNotACandidate() {
        seedReview(org, 1, "불량입니다", ReviewReplyState.ANSWERED);

        assertThat(candidateReviews(org)).isEmpty();
    }

    @Test
    @DisplayName("a manufactured review is never a candidate")
    void aSyntheticReviewIsNotACandidate() {
        Review r = review(org, 1, "데모 데이터", ReviewReplyState.UNKNOWN);
        r.setDataOrigin(DataOrigin.DEMO_SEED);
        reviews.save(r);

        assertThat(candidateReviews(org)).isEmpty();
    }

    @Test
    @DisplayName("one org's review candidates never include another's")
    void reviewCandidatesAreOrgScoped() {
        UUID mine = seedReview(org, 1, "불량입니다", ReviewReplyState.UNKNOWN);
        seedReview(otherOrg, 1, "다른 회사 리뷰", ReviewReplyState.UNKNOWN);

        assertThat(candidateReviews(org)).containsExactly(mine);
    }


    // ------------------------------------------------------------------ the bootstrap fence

    @Test
    @DisplayName("the day the switch is flipped, an org's imported history is not today's work")
    void theBootstrapFenceHoldsBackTheBacklog() {
        // What the canonical Demo Org actually looked like: every eligible item real, unanswered, and
        // first observed in one historical backfill days before anyone enabled this feature.
        for (int i = 0; i < 5; i++) {
            seedInquiry(org, "UNANSWERED", InquiryOperationalState.ACTIVE, "ROOT",
                    DataOrigin.REAL, InquiryWorkItemPhase.OPEN);
        }
        assertThat(candidateWorkItems(org)).as("every clause about REALNESS passes").hasSize(5);

        // A boundary after the backfill selects none of them. Nothing about the rows changed; what
        // changed is the question being asked — "is this work" versus "is this work SellerOps' to
        // raise now".
        assertThat(candidateWorkItems(org, Instant.now().plusSeconds(60))).isEmpty();
    }

    @Test
    @DisplayName("the same fence holds for imported review history")
    void theBootstrapFenceHoldsBackReviewHistory() {
        seedReview(org, 1, "포장이 찢어져 있었습니다", ReviewReplyState.UNKNOWN);
        seedReview(org, 2, "생각보다 얇습니다", ReviewReplyState.UNKNOWN);

        assertThat(candidateReviews(org)).hasSize(2);
        assertThat(candidateReviews(org, Instant.now().plusSeconds(60))).isEmpty();
    }

    @Test
    @DisplayName("a capped tick spends its budget on the most recently observed work, not the oldest")
    void theOrderingIsNewestObservedFirst() {
        UUID older = seedInquiry(org, "UNANSWERED", InquiryOperationalState.ACTIVE, "ROOT",
                DataOrigin.REAL, InquiryWorkItemPhase.OPEN);
        UUID newer = seedInquiry(org, "UNANSWERED", InquiryOperationalState.ACTIVE, "ROOT",
                DataOrigin.REAL, InquiryWorkItemPhase.OPEN);
        // Persisted in order, so the second row's created_at is the later one. The ordering used to be
        // oldest-first, which meant a bounded tick would reliably investigate an org's stalest rows.
        touchCreatedAt(older, Instant.parse("2026-08-01T00:00:00Z"));
        touchCreatedAt(newer, Instant.parse("2026-08-20T00:00:00Z"));

        assertThat(candidateWorkItems(org)).containsExactly(newer, older);
    }

    /** Rewrite a work item's observation time — the column is not settable through the entity. */
    private void touchCreatedAt(UUID workItemId, Instant at) {
        entityManager.getEntityManager()
                .createQuery("update InquiryWorkItem w set w.createdAt = :at where w.id = :id")
                .setParameter("at", at).setParameter("id", workItemId).executeUpdate();
        entityManager.clear();
    }

    // ------------------------------------------------------------------ seeding

    /** Fence wide open — these cases are about the operational clauses, not the boundary. */
    private List<UUID> candidateWorkItems(UUID orgId) {
        return candidateWorkItems(orgId, Instant.EPOCH);
    }

    private List<UUID> candidateWorkItems(UUID orgId, Instant observedSince) {
        return workItems.findProactiveCandidates(orgId, observedSince, PageRequest.of(0, 50)).stream()
                .map(InquiryWorkItem::getId).toList();
    }

    private List<UUID> candidateReviews(UUID orgId) {
        return candidateReviews(orgId, Instant.EPOCH);
    }

    private List<UUID> candidateReviews(UUID orgId, Instant observedSince) {
        return reviews.findProactiveCandidates(orgId, observedSince, PageRequest.of(0, 50)).stream()
                .map(Review::getId).toList();
    }

    private UUID seedInquiry(UUID orgId, String status, InquiryOperationalState state, String threadRole,
                             DataOrigin origin, InquiryWorkItemPhase phase) {
        Inquiry q = new Inquiry();
        q.setOrgId(orgId);
        q.setChannelId(channel);
        q.setSellerAccountId(account);
        q.setTitle("문의 제목");
        q.setBody("문의 본문");
        q.setStatus(status);
        q.setDataOrigin(origin);
        q.setOperationalState(state);
        q.setThreadRole(threadRole);
        q.setReceivedAt(Instant.parse("2026-08-20T00:00:00Z"));
        UUID inquiryId = inquiries.save(q).getId();

        InquiryWorkItem w = new InquiryWorkItem();
        w.setOrgId(orgId);
        w.setInquiryId(inquiryId);
        w.setSellerAccountId(account);
        w.setChannelId(channel);
        w.setPhase(phase);
        return workItems.save(w).getId();
    }

    private UUID seedReview(UUID orgId, Integer rating, String body, ReviewReplyState replyState) {
        return reviews.save(review(orgId, rating, body, replyState)).getId();
    }

    private Review review(UUID orgId, Integer rating, String body, ReviewReplyState replyState) {
        Review r = new Review();
        r.setOrgId(orgId);
        r.setChannelId(channel);
        r.setRating(rating);
        r.setBody(body);
        r.setNegative(rating != null && rating <= 2);
        r.setReplyState(replyState);
        r.setReceivedAt(Instant.parse("2026-08-20T00:00:00Z"));
        return r;
    }
}
