package com.sellerops.reviewissue;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sellerops.attention.VocItemRef;
import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.common.ApiException;
import com.sellerops.product.ProductRepository;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewReplyState;
import com.sellerops.review.ReviewRepository;
import com.sellerops.reviewissue.dto.ReviewIssueReplyCandidateView;
import com.sellerops.reviewissue.dto.ReviewIssueReplyCandidatesView;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
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
 * The Issue → 근거 → 리뷰 선택 bridge: an issue's evidence reviews resolved for the reply flow, over a
 * real (H2) database. Proves the actionRef/account resolution, the already-answered exclusion, the
 * fail-closed ambiguity, cross-org non-disclosure, and the DRAFT-honesty labelling.
 *
 * <p>⚠ JPA mapping, not the migration — the suite runs H2 with Flyway disabled, so V32 is not executed
 * here (the disposable-backend harness covers that).
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class ReviewIssueReplyCandidatesServiceTest {

    @Autowired ReviewRepository reviews;
    @Autowired ReviewIssueRepository issues;
    @Autowired ReviewIssueEvidenceRepository evidence;
    @Autowired ReviewIssueUnknownUnitRepository unknowns;
    @Autowired ReviewIssueStateEventRepository stateEvents;
    @Autowired ProductRepository products;
    @Autowired SellerAccountRepository sellerAccounts;
    @Autowired ChannelRepository channels;

    private static final LocalDate REF = LocalDate.of(2026, 7, 25);
    private final UUID org = UUID.randomUUID();

    private UUID channel;
    private UUID account;
    private ReviewIssueExtractionService extraction;
    private ReviewIssueReplyCandidatesService candidates;

    @BeforeEach
    void setUp() {
        extraction = new ReviewIssueExtractionService(
                new RuleBasedIssueSignatureExtractor(false), issues, evidence, unknowns, stateEvents);
        candidates = new ReviewIssueReplyCandidatesService(
                issues, evidence, reviews, products, sellerAccounts);
        channel = seedChannel();
        account = seedAccount(org, channel);
    }

    private UUID seedChannel() {
        Channel ch = new Channel();
        ch.setCode("NAVER");
        ch.setNameKo("네이버 스마트스토어");
        ch.setStatus(ChannelStatus.AVAILABLE);
        ch.setSupportsReview(true);
        ch.setSortOrder(0);
        return channels.save(ch).getId();
    }

    private UUID seedAccount(UUID orgId, UUID channelId) {
        SellerAccount acc = new SellerAccount();
        acc.setOrgId(orgId);
        acc.setChannelId(channelId);
        acc.setConnectionStatus(ChannelStatus.CONNECTED);
        acc.setFileUpload(true);
        return sellerAccounts.save(acc).getId();
    }

    private Review review(String body) {
        Review r = new Review();
        r.setOrgId(org);
        r.setChannelId(channel);
        r.setRating(2);
        r.setBody(body);
        r.setNegative(true);
        r.setReceivedAt(REF.atStartOfDay(ZoneOffset.UTC).toInstant());
        return reviews.save(r);
    }

    private UUID issueId() {
        return issues.findByOrgIdAndSignatureKey(org, "배송:지연").orElseThrow().getId();
    }

    @Test
    void candidatesSurfaceTheEvidenceReviewResolvedForReply() {
        Review saved = review("배송이 너무 늦었어요");
        extraction.extract(saved);

        ReviewIssueReplyCandidatesView view = candidates.candidates(org, issueId());

        assertThat(view.extractorKind()).isEqualTo("RULE_BASED");
        assertThat(view.thresholdsVersion()).isEqualTo(ReviewIssueThresholds.CONTRACT_VERSION);
        assertThat(view.selectableCount()).isEqualTo(1);
        assertThat(view.candidates()).hasSize(1);

        ReviewIssueReplyCandidateView c = view.candidates().get(0);
        assertThat(c.reviewId()).isEqualTo(saved.getId());
        assertThat(c.actionRef()).isEqualTo(VocItemRef.forReview(saved.getId()));
        assertThat(c.rating()).isEqualTo(2);
        assertThat(c.reviewDate()).isEqualTo(REF);
        assertThat(c.quote()).isNotBlank();
        assertThat(c.accountId()).isEqualTo(account);
        assertThat(c.accountAmbiguous()).isFalse();
        assertThat(c.reportedSubmitted()).isFalse();
        assertThat(c.selectable()).isTrue();
    }

    @Test
    void anAlreadyAnsweredReviewStaysListedButIsNotSelectable() {
        Review saved = review("배송이 너무 늦었어요");
        extraction.extract(saved);
        saved.setReplyState(ReviewReplyState.ANSWERED);
        reviews.save(saved);

        ReviewIssueReplyCandidatesView view = candidates.candidates(org, issueId());

        assertThat(view.candidates()).hasSize(1);
        ReviewIssueReplyCandidateView c = view.candidates().get(0);
        assertThat(c.channelReplyState()).isEqualTo("ANSWERED");
        assertThat(c.selectable()).isFalse();
        assertThat(view.selectableCount()).isZero();
    }

    @Test
    void twoAccountsOnAChannelFailClosedRatherThanGuessTheAccount() {
        seedAccount(org, channel); // now two accounts on the same channel
        extraction.extract(review("배송이 너무 늦었어요"));

        ReviewIssueReplyCandidateView c = candidates.candidates(org, issueId()).candidates().get(0);

        assertThat(c.accountId()).isNull();
        assertThat(c.accountAmbiguous()).isTrue();
        assertThat(c.selectable()).isFalse();
    }

    @Test
    void aCrossOrgIssueIsNotFoundRatherThanProbeable() {
        extraction.extract(review("배송이 너무 늦었어요"));
        UUID id = issueId();

        assertThatThrownBy(() -> candidates.candidates(UUID.randomUUID(), id))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("이슈를 찾을 수 없습니다");
    }

    @Test
    void oneCandidatePerReviewEvenWhenTheReviewIsEvidenceForTheIssueMoreThanOnce() {
        // Two clauses, same issue signature → two evidence rows for ONE review; the candidate list
        // dedupes to one selectable review, not two.
        extraction.extract(review("배송이 너무 늦었어요. 배송이 또 지연됐어요"));

        ReviewIssueReplyCandidatesView view = candidates.candidates(org, issueId());
        assertThat(view.candidates()).hasSize(1);
    }
}
