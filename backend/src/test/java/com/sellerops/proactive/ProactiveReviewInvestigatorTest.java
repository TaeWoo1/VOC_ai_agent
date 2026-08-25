package com.sellerops.proactive;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.review.Review;
import com.sellerops.reviewissue.IssueLifecycleState;
import com.sellerops.reviewissue.IssueSeverity;
import com.sellerops.reviewissue.MatchConfidence;
import com.sellerops.reviewissue.ReviewIssue;
import com.sellerops.reviewissue.ReviewIssueEvidence;
import com.sellerops.reviewissue.ReviewIssueEvidenceRepository;
import com.sellerops.reviewissue.ReviewIssueRepository;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * <b>What a review investigation may claim.</b>
 *
 * <p>Two things are being pinned. First, that "이 문제가 반복되고 있다" is READ from the issue memory
 * another pipeline built, never inferred from the one review in hand — the difference between an
 * observation and a guess, and the seller cannot tell them apart from the card. Second, that the
 * recommendation never states the seller's own policy: SellerOps does not know whether this shop
 * refunds, and a card that implied it would put words in the seller's mouth in front of a customer.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class ProactiveReviewInvestigatorTest {

    @Autowired ReviewIssueRepository issues;
    @Autowired ReviewIssueEvidenceRepository evidence;

    private UUID org;
    private UUID product;
    private ProactiveReviewInvestigator investigator;

    @BeforeEach
    void setUp() {
        org = UUID.randomUUID();
        product = UUID.randomUUID();
        investigator = new ProactiveReviewInvestigator(issues, evidence);
    }

    @Test
    @DisplayName("a repeated issue is read from the issue memory, and named")
    void aRepeatIsReadNotInferred() {
        UUID issue = seedIssue("포장 파손", false);
        seedEvidence(issue, product, 3);

        ProactiveReviewInvestigator.Investigation found =
                investigator.investigate(org, review(1, "이번에도 찢어져서 왔어요", product));

        assertThat(found.reason()).isEqualTo(ProactiveReason.REPEAT_ISSUE_REVIEW);
        assertThat(found.repeatIssue()).isEqualTo("포장 파손");
        assertThat(found.repeatCount()).isEqualTo(3);
        assertThat(found.recommendation()).contains("포장 파손").contains("3건");
    }

    @Test
    @DisplayName("one occurrence is not a repetition")
    void asingleOccurrenceIsNotARepeat() {
        UUID issue = seedIssue("포장 파손", false);
        seedEvidence(issue, product, 1);

        ProactiveReviewInvestigator.Investigation found =
                investigator.investigate(org, review(1, "찢어져서 왔어요", product));

        assertThat(found.reason()).isEqualTo(ProactiveReason.SEVERE_NEGATIVE_REVIEW);
        assertThat(found.repeatIssue()).isNull();
    }

    @Test
    @DisplayName("an issue the seller dismissed is not raised again as a repetition")
    void aDismissedIssueIsNotRaised() {
        UUID issue = seedIssue("포장 파손", true);
        seedEvidence(issue, product, 5);

        ProactiveReviewInvestigator.Investigation found =
                investigator.investigate(org, review(2, "포장이 아쉽습니다", product));

        assertThat(found.reason()).isEqualTo(ProactiveReason.NEGATIVE_REVIEW);
        assertThat(found.repeatIssue()).isNull();
    }

    @Test
    @DisplayName("a review with no canonical product makes no claim about repetition, and says so")
    void noProductMeansNoRepeatClaim() {
        UUID issue = seedIssue("포장 파손", false);
        seedEvidence(issue, product, 4);

        ProactiveReviewInvestigator.Investigation found =
                investigator.investigate(org, review(2, "포장이 아쉽습니다", null));

        assertThat(found.repeatIssue()).isNull();
        assertThat(found.recommendation())
                .as("the gap is stated rather than hidden — the seller can close it by binding a product")
                .contains("상품과 연결되지 않아");
    }

    @Test
    @DisplayName("no recommendation ever states the seller's own policy")
    void itFabricatesNoPolicy() {
        UUID issue = seedIssue("배송 지연", false);
        seedEvidence(issue, product, 2);

        for (ProactiveReviewInvestigator.Investigation found : java.util.List.of(
                investigator.investigate(org, review(1, "너무 늦게 왔어요", product)),
                investigator.investigate(org, review(2, "조금 늦었습니다", null)),
                investigator.investigate(org, review(1, "최악", null)))) {
            assertThat(found.recommendation())
                    .as("SellerOps does not know this shop's refund, exchange or shipping terms")
                    .doesNotContain("환불")
                    .doesNotContain("교환")
                    .doesNotContain("보상")
                    .doesNotContain("가능합니다")
                    .doesNotContain("해 드리")
                    .isNotBlank();
        }
    }

    // ------------------------------------------------------------------ seeding

    private Review review(Integer rating, String body, UUID productId) {
        Review r = new Review();
        r.setId(UUID.randomUUID());
        r.setOrgId(org);
        r.setChannelId(UUID.randomUUID());
        r.setRating(rating);
        r.setBody(body);
        r.setNegative(true);
        r.setProductId(productId);
        r.setReceivedAt(Instant.parse("2026-08-20T00:00:00Z"));
        return r;
    }

    private UUID seedIssue(String title, boolean dismissed) {
        ReviewIssue issue = new ReviewIssue();
        issue.setOrgId(org);
        issue.setSignatureKey(UUID.randomUUID().toString().substring(0, 32));
        issue.setTitle(title);
        issue.setAspect("포장");
        issue.setProblem("파손");
        issue.setSeverity(IssueSeverity.HIGH);
        issue.setLifecycleState(IssueLifecycleState.OBSERVING);
        issue.setExtractorKind("RULE");
        issue.setExtractorVersion("v1");
        issue.setDismissed(dismissed);
        return issues.save(issue).getId();
    }

    private void seedEvidence(UUID issueId, UUID productId, int rows) {
        for (int i = 0; i < rows; i++) {
            ReviewIssueEvidence row = new ReviewIssueEvidence();
            row.setOrgId(org);
            row.setIssueId(issueId);
            row.setReviewId(UUID.randomUUID());
            row.setUnitOrdinal(i);
            row.setProductId(productId);
            row.setOccurredOn(LocalDate.of(2026, 8, 20));
            row.setMatchConfidence(MatchConfidence.EXACT_SIGNATURE);
            evidence.save(row);
        }
    }
}
