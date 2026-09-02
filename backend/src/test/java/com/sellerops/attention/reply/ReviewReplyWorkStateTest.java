package com.sellerops.attention.reply;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * Approval Path v1 §2 — the state a worklist row reports, and the query it is read from.
 *
 * <p>What is pinned here is the ONE distinction the older boolean could not make. The drill-down has
 * always carried {@code hasReplyPreparation}, which is true for a draft, true for a standing approval
 * and true for a WITHDRAWN one — correct for deciding whether to keep a panel on screen, and useless
 * for telling a seller which review is waiting on them. A withdrawal that still read as 「승인됨」 would
 * hide exactly the row the seller has to come back to, and an approval that still read as 「승인 대기」
 * would send them to a review that needs nothing.
 *
 * <p>Hermetic: no network, no marketplace, no model.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class ReviewReplyWorkStateTest {

    @Autowired ReviewReplyApprovalRepository approvals;

    private final UUID org = UUID.randomUUID();

    @Test
    @DisplayName("a standing approval outranks the draft flag; without one, a draft is what is waiting")
    void theThreeStates() {
        assertThat(ReviewReplyWorkState.of(false, false)).isEqualTo(ReviewReplyWorkState.DRAFT_NEEDED);
        assertThat(ReviewReplyWorkState.of(true, false)).isEqualTo(ReviewReplyWorkState.AWAITING_APPROVAL);
        assertThat(ReviewReplyWorkState.of(true, true)).isEqualTo(ReviewReplyWorkState.APPROVED);
        // An approval can only stand on a draft, but that is a service rule and not a schema one, so
        // the derivation states its answer rather than assuming the pair cannot occur.
        assertThat(ReviewReplyWorkState.of(false, true)).isEqualTo(ReviewReplyWorkState.APPROVED);
    }

    @Test
    @DisplayName("the standing-approval read excludes a withdrawn one — its neighbour deliberately does not")
    void withdrawnIsNotStanding() {
        UUID approved = UUID.randomUUID();
        UUID withdrawn = UUID.randomUUID();
        approvals.save(approval(approved, ReviewReplyApprovalState.APPROVED));
        approvals.save(approval(withdrawn, ReviewReplyApprovalState.WITHDRAWN));
        List<UUID> both = List.of(approved, withdrawn);

        assertThat(approvals.findReviewIdsWithStandingApproval(org, both)).containsExactly(approved);
        // The older question, unchanged: both rows ARE the operator's work, and the panel still mounts
        // on the withdrawn one so the draft behind it stays readable.
        assertThat(approvals.findReviewIdsWithApproval(org, both)).containsExactlyInAnyOrder(approved, withdrawn);
    }

    @Test
    @DisplayName("another org's standing approval is not in this org's answer")
    void orgScoped() {
        UUID review = UUID.randomUUID();
        approvals.save(approval(review, ReviewReplyApprovalState.APPROVED));
        assertThat(approvals.findReviewIdsWithStandingApproval(UUID.randomUUID(), List.of(review))).isEmpty();
    }

    private ReviewReplyApproval approval(UUID reviewId, ReviewReplyApprovalState state) {
        ReviewReplyApproval row = new ReviewReplyApproval();
        row.setOrgId(org);
        row.setReviewId(reviewId);
        row.setState(state);
        // The binding is null iff WITHDRAWN — the same check constraint production carries.
        row.setApprovedVersion(state == ReviewReplyApprovalState.APPROVED ? 1 : null);
        row.setApprovedFingerprint(state == ReviewReplyApprovalState.APPROVED ? "f".repeat(64) : null);
        row.setDecidedBy("SELLER:" + UUID.randomUUID());
        row.setDecidedAt(Instant.parse("2026-09-03T00:00:00Z"));
        return row;
    }
}
