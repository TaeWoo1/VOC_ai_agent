package com.sellerops.reviewissue;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.product.ProductRepository;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewRepository;
import com.sellerops.reviewissue.dto.ReviewIssueView;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * <b>What an active repeated-problem list puts first, and what it does not put on at all.</b>
 *
 * <p>Pilot QA Pass 3 measured the demo org's product page: its five visible rows held <b>6</b> evidence
 * and the eight folded behind 「문제 8건 더 보기」 held <b>40</b>, because every HIGH-severity issue there
 * has one or two rows while the largest repeated problem is NORMAL. The same read also carried three
 * issues with <b>zero</b> evidence — rows the re-extractor had reconciled away — sitting among the ones
 * asking for attention.
 *
 * <p>Both are properties of the ORDER and the MEMBERSHIP of a list, which no assertion about one issue
 * can see, so they are pinned here over a real database.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class IssueOrderingTest {

    @Autowired ReviewRepository reviews;
    @Autowired ReviewIssueRepository issues;
    @Autowired ReviewIssueEvidenceRepository evidence;
    @Autowired ReviewIssueStateEventRepository stateEvents;
    @Autowired ProductRepository products;

    private static final LocalDate REF = LocalDate.of(2026, 9, 7);

    private final UUID org = UUID.randomUUID();
    private final UUID channel = UUID.randomUUID();

    private ReviewIssueQueryService queries;

    @BeforeEach
    void setUp() {
        queries = new ReviewIssueQueryService(issues, evidence, stateEvents,
                new ReviewIssueSnapshotService(evidence), reviews, products);
    }

    @Test
    void theMostRepeatedProblemIsFirstEvenWhenAnotherIsMoreSevere() {
        UUID severeAndRare = issue("배송", "파손", IssueSeverity.HIGH);
        UUID mildAndRepeated = issue("접착", "부족", IssueSeverity.NORMAL);
        evidenceRows(severeAndRare, 1);
        evidenceRows(mildAndRepeated, 5);

        List<ReviewIssueView> list = queries.list(org, REF);

        assertThat(list).extracting(ReviewIssueView::title)
                .containsExactly("접착 부족", "배송 파손");
        // Severity is not hidden — it is still on the row, and it still decides a tie.
        assertThat(list.get(1).severity()).isEqualTo("HIGH");
    }

    @Test
    void severityStillDecidesBetweenTwoProblemsSeenEquallyOften() {
        UUID mild = issue("설치", "어려움", IssueSeverity.LOW);
        UUID severe = issue("배송", "파손", IssueSeverity.HIGH);
        evidenceRows(mild, 3);
        evidenceRows(severe, 3);

        assertThat(queries.list(org, REF)).extracting(ReviewIssueView::title)
                .containsExactly("배송 파손", "설치 어려움");
    }

    @Test
    void anIssueWhoseEvidenceWasAllRetractedLeavesTheWorklistButKeepsItsRecord() {
        UUID live = issue("접착", "부족", IssueSeverity.NORMAL);
        UUID emptied = issue("크기", "어려움", IssueSeverity.LOW);
        evidenceRows(live, 2);

        assertThat(queries.list(org, REF)).extracting(ReviewIssueView::id).containsExactly(live);
        // Not deleted, not dismissed: the row and its history are still there, and its own page opens.
        assertThat(issues.findById(emptied)).isPresent();
        assertThat(queries.issueView(org, emptied, REF).evidenceCount()).isZero();
    }

    @Test
    void theSetAsideListIsARecordOfDecisionsAndKeepsWhatWasPutThere() {
        UUID dismissed = issue("포장", "부족", IssueSeverity.NORMAL);
        ReviewIssue row = issues.findById(dismissed).orElseThrow();
        row.setDismissed(true);
        issues.save(row);

        // Zero evidence, and still listed — an operator's decision does not disappear because the
        // extractor later withdrew the rows behind it.
        assertThat(queries.list(org, REF, true)).extracting(ReviewIssueView::id).containsExactly(dismissed);
        assertThat(queries.list(org, REF, false)).isEmpty();
    }

    private UUID issue(String aspect, String problem, IssueSeverity severity) {
        ReviewIssue row = new ReviewIssue();
        row.setOrgId(org);
        row.setSignatureKey(aspect + ":" + problem);
        row.setTitle(aspect + " " + problem);
        row.setAspect(aspect);
        row.setProblem(problem);
        row.setSeverity(severity);
        row.setLifecycleState(IssueLifecycleState.OBSERVING);
        row.setExtractorKind("RULE_BASED");
        row.setExtractorVersion("issue-rules-v2");
        return issues.save(row).getId();
    }

    private void evidenceRows(UUID issueId, int count) {
        LocalDate on = LocalDate.of(2026, 9, 1);
        for (int i = 0; i < count; i += 1) {
            Review source = new Review();
            source.setOrgId(org);
            source.setChannelId(channel);
            source.setBody("같은 문제가 또 있었습니다");
            source.setRating(2);
            source.setReceivedAt(Instant.parse("2026-09-01T00:00:00Z"));
            source = reviews.save(source);

            ReviewIssueEvidence row = new ReviewIssueEvidence();
            row.setOrgId(org);
            row.setIssueId(issueId);
            row.setReviewId(source.getId());
            row.setUnitOrdinal(0);
            row.setOccurredOn(on);
            row.setMatchConfidence(MatchConfidence.EXACT_SIGNATURE);
            evidence.save(row);
        }
        ReviewIssue issue = issues.findById(issueId).orElseThrow();
        issue.setFirstEvidenceOn(on);
        issue.setLastEvidenceOn(on);
        issues.save(issue);
    }
}
