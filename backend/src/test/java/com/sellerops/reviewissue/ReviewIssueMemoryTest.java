package com.sellerops.reviewissue;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sellerops.product.ProductRepository;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewRepository;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * The issue memory over a real (H2) database: extraction, idempotency, and the lifecycle fence.
 *
 * <p>⚠ This validates the JPA mapping, not the migration. The suite runs H2 with Flyway disabled
 * ({@code application-test.properties}), so {@code V31__review_issue_memory.sql} is never executed
 * here and a mismatch between it and these entities would still be green. That is what the
 * disposable-backend harness under {@code tools/review-issue-validation/} exists for.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class ReviewIssueMemoryTest {

    @Autowired ReviewRepository reviews;
    @Autowired ReviewIssueRepository issues;
    @Autowired ReviewIssueEvidenceRepository evidence;
    @Autowired ReviewIssueUnknownUnitRepository unknowns;
    @Autowired ReviewIssueStateEventRepository stateEvents;
    @Autowired ProductRepository products;

    private static final LocalDate REF = LocalDate.of(2026, 7, 25);

    private final UUID org = UUID.randomUUID();
    private final UUID channel = UUID.randomUUID();

    private ReviewIssueExtractionService extraction;
    private ReviewIssueSnapshotService snapshots;
    private ReviewIssueLifecycleService lifecycle;
    private ReviewIssueQueryService queries;

    @BeforeEach
    void setUp() {
        IssueSignatureExtractor extractor = new RuleBasedIssueSignatureExtractor(false);
        extraction = new ReviewIssueExtractionService(
                extractor, issues, evidence, unknowns, stateEvents);
        snapshots = new ReviewIssueSnapshotService(evidence);
        lifecycle = new ReviewIssueLifecycleService(issues, stateEvents, snapshots);
        queries = new ReviewIssueQueryService(
                issues, evidence, stateEvents, snapshots, reviews, products);
    }

    private Review review(String body, LocalDate on, UUID productId) {
        Review review = new Review();
        review.setOrgId(org);
        review.setChannelId(channel);
        review.setProductId(productId);
        review.setBody(body);
        review.setRating(5);
        review.setReceivedAt(on.atStartOfDay(ZoneOffset.UTC).toInstant());
        return reviews.save(review);
    }

    private ReviewIssue issueByKey(String signatureKey) {
        return issues.findByOrgIdAndSignatureKey(org, signatureKey).orElseThrow();
    }

    // ---- extraction --------------------------------------------------------------------------

    @Test
    void extractionCreatesAnIssueAndAttachesEvidence() {
        extraction.extract(review("배송이 너무 늦었어요", REF, null));

        ReviewIssue issue = issueByKey("배송:지연");
        assertThat(issue.getTitle()).isEqualTo("배송 지연");
        assertThat(issue.getSeverity()).isEqualTo(IssueSeverity.NORMAL);
        assertThat(issue.getLifecycleState()).isEqualTo(IssueLifecycleState.OBSERVING);
        assertThat(issue.getExtractorKind()).isEqualTo("RULE_BASED");
        assertThat(evidence.countByOrgIdAndIssueId(org, issue.getId())).isEqualTo(1);
    }

    /** A 5★ review whose complaint lives in one clause still produces evidence. */
    @Test
    void aComplaintInsideAPositiveReviewBecomesEvidenceWithoutTouchingTheRating() {
        Review saved = review("디자인은 예쁜데 배송이 너무 늦었어요", REF, null);
        extraction.extract(saved);

        assertThat(issues.findByOrgIdAndSignatureKey(org, "배송:지연")).isPresent();
        assertThat(reviews.findById(saved.getId()).orElseThrow().getRating()).isEqualTo(5);
    }

    /** The import path is resumable, so the same review legitimately arrives more than once. */
    @Test
    void reExtractingTheSameReviewChangesNothing() {
        Review saved = review("포장이 찌그러져 왔어요", REF, null);

        var first = extraction.extract(saved);
        var second = extraction.extract(saved);

        assertThat(first.changedAnything()).isTrue();
        assertThat(second.changedAnything()).isFalse();
        assertThat(issues.findByOrgIdAndDismissedFalse(org)).hasSize(1);
        assertThat(evidence.count()).isEqualTo(1);
    }

    @Test
    void oneReviewCanBecomeEvidenceForTwoIssues() {
        extraction.extract(review("포장이 찌그러져 왔어요. 설치도 너무 어려웠습니다", REF, null));

        assertThat(issues.findByOrgIdAndDismissedFalse(org))
                .extracting(ReviewIssue::getSignatureKey)
                .containsExactlyInAnyOrder("포장:파손", "설치:난이도");
    }

    @Test
    void twoReviewsWithTheSameComplaintShareOneIssue() {
        extraction.extract(review("배송이 늦었어요", REF, null));
        extraction.extract(review("배송이 너무 늦게 왔습니다", REF.minusDays(3), null));

        assertThat(issues.findByOrgIdAndDismissedFalse(org)).hasSize(1);
        assertThat(evidence.countByOrgIdAndIssueId(org, issueByKey("배송:지연").getId())).isEqualTo(2);
    }

    @Test
    void unattributableUnitsGoToTheUnknownPenWithTheirReason() {
        extraction.extract(review("불량이에요", REF, null));
        extraction.extract(review("설치가 정말 간편했어요", REF, null));

        assertThat(issues.findByOrgIdAndDismissedFalse(org)).isEmpty();
        assertThat(unknowns.countByOrgIdAndReason(org, UnknownReason.NO_ASPECT)).isEqualTo(1);
        assertThat(unknowns.countByOrgIdAndReason(org, UnknownReason.NO_PROBLEM)).isEqualTo(1);
    }

    @Test
    void theEvidenceSpanWidensAndNeverNarrows() {
        extraction.extract(review("배송이 늦었어요", REF.minusDays(10), null));
        extraction.extract(review("배송이 늦었어요 정말", REF, null));
        extraction.extract(review("배송이 늦게 왔어요", REF.minusDays(30), null));

        ReviewIssue issue = issueByKey("배송:지연");
        assertThat(issue.getFirstEvidenceOn()).isEqualTo(REF.minusDays(30));
        assertThat(issue.getLastEvidenceOn()).isEqualTo(REF);
    }

    /** The date bucket must recover the calendar date the channel displayed, not shift by a day. */
    @Test
    void theDateBucketIsTheChannelsCalendarDate() {
        extraction.extract(review("배송이 늦었어요", REF, null));

        assertThat(evidence.findAll().get(0).getOccurredOn()).isEqualTo(REF);
    }

    // ---- lifecycle ---------------------------------------------------------------------------

    private ReviewIssue seedNewIssueThatFires() {
        // Three pieces of evidence inside the NEW window, none before it.
        for (int day = 0; day < 3; day++) {
            extraction.extract(review("배송이 늦었어요 " + day, REF.minusDays(day), null));
        }
        return issueByKey("배송:지연");
    }

    @Test
    void aFiringJudgementRaisesAnObservingIssueForReview() {
        ReviewIssue issue = seedNewIssueThatFires();
        assertThat(IssueChangeRules.assess(snapshots.snapshot(org, issue.getId(), REF)).kinds())
                .contains(IssueChangeKind.NEW);

        var result = lifecycle.runAutomaticPass(org, REF);

        assertThat(result.raisedForReview()).isEqualTo(1);
        assertThat(issues.findById(issue.getId()).orElseThrow().getLifecycleState())
                .isEqualTo(IssueLifecycleState.NEEDS_REVIEW);
        assertThat(stateEvents.findByOrgIdAndIssueIdOrderByCreatedAtAsc(org, issue.getId()))
                .extracting(ReviewIssueStateEvent::getReason)
                .containsExactly(IssueStateReason.CREATED, IssueStateReason.NEW);
    }

    @Test
    void theAutomaticPassIsIdempotentForAGivenReferenceDate() {
        seedNewIssueThatFires();

        assertThat(lifecycle.runAutomaticPass(org, REF).raisedForReview()).isEqualTo(1);
        assertThat(lifecycle.runAutomaticPass(org, REF).raisedForReview()).isZero();
    }

    @Test
    void anIssueWithNothingFiringStaysObservingAndIsNotWarnedAbout() {
        extraction.extract(review("배송이 늦었어요", REF, null));

        assertThat(lifecycle.runAutomaticPass(org, REF).raisedForReview()).isZero();
        assertThat(issueByKey("배송:지연").getLifecycleState())
                .isEqualTo(IssueLifecycleState.OBSERVING);
    }

    @Test
    void theOperatorPathIsNeedsReviewThenActingThenVerifying() {
        ReviewIssue issue = seedNewIssueThatFires();
        lifecycle.runAutomaticPass(org, REF);

        lifecycle.startActing(org, issue.getId(), "테이프 공급처 확인");
        assertThat(issues.findById(issue.getId()).orElseThrow().getLifecycleState())
                .isEqualTo(IssueLifecycleState.ACTING);

        lifecycle.markRemediated(org, issue.getId(), "공급처 변경 완료");
        assertThat(issues.findById(issue.getId()).orElseThrow().getLifecycleState())
                .isEqualTo(IssueLifecycleState.VERIFYING);
        assertThat(lifecycle.history(org, issue.getId()))
                .extracting(ReviewIssueStateEvent::getNote)
                .contains("테이프 공급처 확인", "공급처 변경 완료");
    }

    @Test
    void statesCannotBeSkipped() {
        ReviewIssue issue = seedNewIssueThatFires();

        // Still OBSERVING — 조치 중 requires 확인 필요 first.
        assertThatThrownBy(() -> lifecycle.startActing(org, issue.getId(), null))
                .isInstanceOf(IllegalStateException.class);

        lifecycle.runAutomaticPass(org, REF);
        assertThatThrownBy(() -> lifecycle.markRemediated(org, issue.getId(), null))
                .isInstanceOf(IllegalStateException.class);
    }

    /**
     * The fence that matters: an issue that merely went quiet without recorded remediation must not
     * be reported as resolved. Slow sales, seasonality and a missed import all look like silence.
     */
    @Test
    void anIssueThatWentQuietWithoutRemediationIsNotResolved() {
        extraction.extract(review("배송이 늦었어요", REF.minusDays(200), null));
        ReviewIssue issue = issueByKey("배송:지연");
        assertThat(snapshots.quietLongEnoughToResolve(org, issue.getId(), REF)).isTrue();

        lifecycle.runAutomaticPass(org, REF);

        assertThat(issues.findById(issue.getId()).orElseThrow().getLifecycleState())
                .isEqualTo(IssueLifecycleState.OBSERVING);
    }

    @Test
    void aRemediatedIssueResolvesAfterEnoughQuietWeeks() {
        extraction.extract(review("배송이 늦었어요", REF.minusDays(200), null));
        ReviewIssue issue = issueByKey("배송:지연");
        issue.setLifecycleState(IssueLifecycleState.VERIFYING);
        issues.save(issue);

        assertThat(lifecycle.runAutomaticPass(org, REF).resolved()).isEqualTo(1);
        assertThat(issues.findById(issue.getId()).orElseThrow().getLifecycleState())
                .isEqualTo(IssueLifecycleState.RESOLVED);
    }

    @Test
    void aVerifyingIssueWithRecentEvidenceIsNotResolvedYet() {
        extraction.extract(review("배송이 늦었어요", REF.minusDays(3), null));
        ReviewIssue issue = issueByKey("배송:지연");
        issue.setLifecycleState(IssueLifecycleState.VERIFYING);
        issues.save(issue);

        assertThat(lifecycle.runAutomaticPass(org, REF).resolved()).isZero();
    }

    /** New evidence reopens the existing issue — it is not announced as a brand-new problem. */
    @Test
    void newEvidenceOnAResolvedIssueReopensItRatherThanMintingANewOne() {
        extraction.extract(review("배송이 늦었어요", REF.minusDays(100), null));
        ReviewIssue issue = issueByKey("배송:지연");
        issue.setLifecycleState(IssueLifecycleState.RESOLVED);
        issues.save(issue);

        var result = extraction.extract(review("배송이 또 늦었어요", REF, null));

        assertThat(result.issuesReopened()).isEqualTo(1);
        assertThat(result.issuesCreated()).isZero();
        assertThat(issues.findByOrgIdAndDismissedFalse(org)).hasSize(1);
        assertThat(issues.findById(issue.getId()).orElseThrow().getLifecycleState())
                .isEqualTo(IssueLifecycleState.OBSERVING);
        assertThat(lifecycle.history(org, issue.getId()))
                .extracting(ReviewIssueStateEvent::getReason)
                .contains(IssueStateReason.REOPENED);
    }

    /** A dismissed issue must not be recreated by the next pass and re-announced. */
    @Test
    void aDismissedIssueStaysStoredSoItIsNotRecreatedAsNew() {
        ReviewIssue issue = seedNewIssueThatFires();
        lifecycle.dismiss(org, issue.getId());

        extraction.extract(review("배송이 또 늦었어요", REF, null));

        assertThat(issues.findAll()).hasSize(1);
        assertThat(issues.findByOrgIdAndDismissedFalse(org)).isEmpty();
        assertThat(lifecycle.runAutomaticPass(org, REF).raisedForReview()).isZero();
    }

    @Test
    void aDismissedIssueCanBeRestoredToWhereItWas() {
        ReviewIssue issue = seedNewIssueThatFires();
        lifecycle.runAutomaticPass(org, REF);
        lifecycle.dismiss(org, issue.getId());

        lifecycle.restore(org, issue.getId());

        assertThat(issues.findById(issue.getId()).orElseThrow().getLifecycleState())
                .isEqualTo(IssueLifecycleState.NEEDS_REVIEW);
    }

    @Test
    void anotherOrgsIssueReadsAsAbsentRatherThanForbidden() {
        ReviewIssue issue = seedNewIssueThatFires();
        UUID otherOrg = UUID.randomUUID();

        assertThatThrownBy(() -> lifecycle.startActing(otherOrg, issue.getId(), null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("이슈를 찾을 수 없습니다.");
        assertThatThrownBy(() -> lifecycle.dismiss(otherOrg, UUID.randomUUID()))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("이슈를 찾을 수 없습니다.");
    }

    // ---- concentration -----------------------------------------------------------------------

    @Test
    void concentrationCountsOneProductsShareAndIgnoresUnattributedRows() {
        UUID product = UUID.randomUUID();
        for (int day = 0; day < 4; day++) {
            extraction.extract(review("배송이 늦었어요 " + day, REF.minusDays(day), product));
        }
        extraction.extract(review("배송이 늦었어요 x", REF.minusDays(5), UUID.randomUUID()));
        extraction.extract(review("배송이 늦었어요 y", REF.minusDays(6), null));

        ReviewIssue issue = issueByKey("배송:지연");
        IssueWindowSnapshot snapshot = snapshots.snapshot(org, issue.getId(), REF);

        // Six pieces of evidence, five attributed; the top product holds four of six.
        assertThat(snapshot.concentrationWindowTotal()).isEqualTo(6);
        assertThat(snapshot.concentrationTopProductCount()).isEqualTo(4);
        assertThat(snapshots.dominantProductId(org, issue.getId(), REF)).isEqualTo(product);
        assertThat(IssueChangeRules.assess(snapshot).has(IssueChangeKind.CONCENTRATED)).isTrue();
    }

    @Test
    void anIssueWhoseReviewsHaveNoProductCannotBeConcentrated() {
        for (int day = 0; day < 6; day++) {
            extraction.extract(review("배송이 늦었어요 " + day, REF.minusDays(day), null));
        }
        ReviewIssue issue = issueByKey("배송:지연");

        assertThat(snapshots.dominantProductId(org, issue.getId(), REF)).isNull();
        assertThat(IssueChangeRules.assess(snapshots.snapshot(org, issue.getId(), REF))
                .has(IssueChangeKind.CONCENTRATED)).isFalse();
    }

    // ---- persistence window ------------------------------------------------------------------

    @Test
    void activeWeeksAreCountedFromRealEvidenceDates() {
        for (int week = 0; week < 4; week++) {
            extraction.extract(review("배송이 늦었어요 w" + week, REF.minusDays(7L * week), null));
        }
        ReviewIssue issue = issueByKey("배송:지연");

        IssueWindowSnapshot snapshot = snapshots.snapshot(org, issue.getId(), REF);
        assertThat(snapshot.activeWeeksInLookback()).isEqualTo(4);
        assertThat(IssueChangeRules.isPersistent(snapshot)).isTrue();
    }

    @Test
    void evidenceIsScopedByOrgSoAnotherOrgCannotInflateAJudgement() {
        extraction.extract(review("배송이 늦었어요", REF, null));
        ReviewIssue issue = issueByKey("배송:지연");

        Review foreign = new Review();
        foreign.setOrgId(UUID.randomUUID());
        foreign.setChannelId(channel);
        foreign.setBody("배송이 늦었어요");
        foreign.setRating(1);
        foreign.setReceivedAt(REF.atStartOfDay(ZoneOffset.UTC).toInstant());
        extraction.extract(reviews.save(foreign));

        assertThat(evidence.countByOrgIdAndIssueId(org, issue.getId())).isEqualTo(1);
        assertThat(issues.findAll()).hasSize(2);
    }

    @Test
    void anEmptyOrgProducesNoIssuesAndNoJudgements() {
        assertThat(issues.findByOrgIdAndDismissedFalse(org)).isEmpty();
        assertThat(lifecycle.runAutomaticPass(org, REF))
                .isEqualTo(new ReviewIssueLifecycleService.AutomaticPassResult(0, 0));
    }

    @Test
    void distinctEvidenceDatesAreDistinct() {
        extraction.extract(review("배송이 늦었어요 a", REF, null));
        extraction.extract(review("배송이 늦었어요 b", REF, null));
        ReviewIssue issue = issueByKey("배송:지연");

        List<LocalDate> dates = evidence.distinctEvidenceDates(
                org, issue.getId(), REF.minusDays(30), REF);
        assertThat(dates).containsExactly(REF);
    }

    @Test
    void aReviewWithAnUnparseableFutureDateStillBucketsToItsOwnDay() {
        LocalDate future = LocalDate.of(2030, 1, 15);
        extraction.extract(review("배송이 늦었어요", future, null));

        assertThat(evidence.findAll().get(0).getOccurredOn()).isEqualTo(future);
        // A future-dated review is outside every trailing window, so nothing fires from it.
        assertThat(IssueChangeRules.assess(
                snapshots.snapshot(org, issueByKey("배송:지연").getId(), REF)).kinds()).isEmpty();
    }

    // ---- the read side --------------------------------------------------------------------------

    /**
     * Dismissal survives on purpose (so the next extraction does not recreate the issue and announce
     * it as new), which is exactly why it has to be readable back. Without this the operator could
     * never reach a dismissed issue again — a one-way door.
     */
    @Test
    void theDismissedListIsReadableSoDismissalIsUndoable() {
        ReviewIssue issue = seedNewIssueThatFires();
        lifecycle.dismiss(org, issue.getId());

        assertThat(queries.list(org, REF, false)).isEmpty();
        assertThat(queries.list(org, REF, true))
                .extracting(v -> v.title())
                .containsExactly("배송 지연");

        lifecycle.restore(org, issue.getId());
        assertThat(queries.list(org, REF, false)).hasSize(1);
        assertThat(queries.list(org, REF, true)).isEmpty();
    }

    /** Severity outranks a firing judgement: minor friction rising must not displace broken product. */
    @Test
    void theListIsOrderedBySeverityBeforeChange() {
        extraction.extract(review("포장이 깨져서 왔어요", REF.minusDays(60), null));   // HIGH, quiet
        for (int day = 0; day < 3; day++) {
            extraction.extract(review("설치가 어려워요 " + day, REF.minusDays(day), null)); // LOW, NEW
        }

        assertThat(queries.list(org, REF, false)).extracting(v -> v.severity())
                .containsExactly("HIGH", "LOW");
    }

    /** The quote is re-derived and masked at read time; the evidence table stores no text. */
    @Test
    void evidenceCarriesTheMaskedOpinionUnitRatherThanTheWholeBody() {
        extraction.extract(review("디자인은 예쁜데 배송이 너무 늦었어요", REF, null));
        ReviewIssue issue = issueByKey("배송:지연");

        var detail = queries.detail(org, issue.getId(), REF);

        assertThat(detail.evidence()).hasSize(1);
        assertThat(detail.evidence().get(0).quote()).isEqualTo("배송이 너무 늦었어요");
        assertThat(detail.evidence().get(0).quote()).doesNotContain("디자인은 예쁜데");
    }

    @Test
    void anotherOrgsIssueDetailReadsAsAbsent() {
        ReviewIssue issue = seedNewIssueThatFires();

        assertThatThrownBy(() -> queries.detail(UUID.randomUUID(), issue.getId(), REF))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("이슈를 찾을 수 없습니다.");
    }

    @Test
    void extractionOfAnEmptyBodyIsANoOp() {
        Review blank = new Review();
        blank.setOrgId(org);
        blank.setChannelId(channel);
        blank.setBody("   ");
        blank.setReceivedAt(Instant.parse("2026-07-25T00:00:00Z"));

        assertThat(extraction.extract(reviews.save(blank)).changedAnything()).isFalse();
    }
}
