package com.sellerops.reviewissue;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sellerops.common.ApiException;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewRepository;
import com.sellerops.reviewissue.dto.ReviewIssueFeedbackResponse;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * Issue candidate feedback (유용함 / 관련 없음 / 나중에 보기) over a real (H2) database: idempotency,
 * conflict on reuse, cross-org non-disclosure, and the invariant that it is OFFLINE EVAL DATA — it
 * moves no lifecycle state.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class ReviewIssueFeedbackServiceTest {

    @Autowired ReviewRepository reviews;
    @Autowired ReviewIssueRepository issues;
    @Autowired ReviewIssueEvidenceRepository evidence;
    @Autowired ReviewIssueUnknownUnitRepository unknowns;
    @Autowired ReviewIssueStateEventRepository stateEvents;
    @Autowired ReviewIssueFeedbackRepository feedbackRepo;

    private static final Clock FIXED = Clock.fixed(Instant.parse("2026-07-25T00:00:00Z"), ZoneOffset.UTC);
    private static final String ACTOR = "SELLER:" + UUID.randomUUID();
    private final UUID org = UUID.randomUUID();
    private final UUID channel = UUID.randomUUID();

    private ReviewIssueExtractionService extraction;
    private ReviewIssueFeedbackService feedback;

    @BeforeEach
    void setUp() {
        extraction = new ReviewIssueExtractionService(
                new RuleBasedIssueSignatureExtractor(false), issues, evidence, unknowns, stateEvents);
        feedback = new ReviewIssueFeedbackService(feedbackRepo, issues, FIXED);
    }

    private UUID seedIssue() {
        Review r = new Review();
        r.setOrgId(org);
        r.setChannelId(channel);
        r.setRating(2);
        r.setBody("배송이 너무 늦었어요");
        r.setNegative(true);
        r.setReceivedAt(LocalDate.of(2026, 7, 25).atStartOfDay(ZoneOffset.UTC).toInstant());
        extraction.extract(reviews.save(r));
        return issues.findByOrgIdAndSignatureKey(org, "배송:지연").orElseThrow().getId();
    }

    @Test
    void feedbackIsRecordedAndIsIdempotentOnTheCommandId() {
        UUID issue = seedIssue();
        String command = UUID.randomUUID().toString();

        ReviewIssueFeedbackResponse first = feedback.record(org, issue, "USEFUL", command, ACTOR);
        ReviewIssueFeedbackResponse replay = feedback.record(org, issue, "USEFUL", command, ACTOR);

        assertThat(first.replayed()).isFalse();
        assertThat(first.kind()).isEqualTo("USEFUL");
        assertThat(replay.replayed()).isTrue();
        assertThat(feedbackRepo.count()).isEqualTo(1);
    }

    @Test
    void reusingACommandIdForADifferentKindConflicts() {
        UUID issue = seedIssue();
        String command = UUID.randomUUID().toString();
        feedback.record(org, issue, "USEFUL", command, ACTOR);

        assertThatThrownBy(() -> feedback.record(org, issue, "NOT_RELEVANT", command, ACTOR))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("이미 다른 피드백");
    }

    @Test
    void feedbackChangesNoLifecycleState() {
        UUID issue = seedIssue();
        var before = issues.findById(issue).orElseThrow();
        var stateBefore = before.getLifecycleState();

        feedback.record(org, issue, "NOT_RELEVANT", UUID.randomUUID().toString(), ACTOR);

        var after = issues.findById(issue).orElseThrow();
        assertThat(after.getLifecycleState()).isEqualTo(stateBefore);
        assertThat(after.isDismissed()).isFalse();
    }

    @Test
    void aCrossOrgIssueIsNotFound() {
        UUID issue = seedIssue();
        assertThatThrownBy(() ->
                feedback.record(UUID.randomUUID(), issue, "USEFUL", UUID.randomUUID().toString(), ACTOR))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("이슈를 찾을 수 없습니다");
    }

    @Test
    void anUnknownKindIsRejected() {
        UUID issue = seedIssue();
        assertThatThrownBy(() ->
                feedback.record(org, issue, "SOMETHING_ELSE", UUID.randomUUID().toString(), ACTOR))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("알 수 없는 피드백");
    }

    @Test
    void aBlankCommandIdIsRejected() {
        UUID issue = seedIssue();
        assertThatThrownBy(() -> feedback.record(org, issue, "LATER", "  ", ACTOR))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("commandId");
    }
}
