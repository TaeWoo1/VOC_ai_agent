package com.sellerops.attention.source;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.attention.AttentionCoverage;
import com.sellerops.attention.OperatorAttentionService;
import com.sellerops.attention.dto.OperatorAttentionSummary;
import com.sellerops.attention.reply.ReviewReplyApprovalRepository;
import com.sellerops.attention.reply.ReviewReplyDraftRepository;
import com.sellerops.attention.reply.ReviewReplyOutcomeRepository;
import com.sellerops.attention.triage.ReviewTriageRepository;
import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.community.Cafe24CommunityArticleRepository;
import com.sellerops.itemanalysis.ItemAnalysisRepository;
import com.sellerops.product.ProductRepository;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewReplyState;
import com.sellerops.review.ReviewRepository;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
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
 * The false-calm guard: the attention summary carries a {@link AttentionCoverage} verdict so an
 * empty signal list is never mistaken for "nothing needs attention" when SellerOps could not
 * actually attribute the reviews.
 *
 * <p>Three scopes, one seed shape, over a real (H2) DB:
 * <ul>
 *   <li>single-account NAVER with a low-rating review → {@code COVERED} + a real signal;</li>
 *   <li>single-account NAVER with no reviews in window → {@code COVERED} + empty (a MEASURED zero —
 *       the existing behavior must be preserved, not swept into "uncertain");</li>
 *   <li>a second NAVER account in the same org → {@code UNCERTAIN_MULTI_ACCOUNT} + empty — reviews
 *       carry no {@code seller_account_id}, so the surface declines to answer.</li>
 * </ul>
 * The unsupported-channel case ({@code UNCERTAIN_UNSUPPORTED_CHANNEL}) is covered by
 * {@code EsmAttentionEmptyStateTest}.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class AttentionCoverageTest {

    @Autowired ReviewRepository reviews;
    @Autowired ChannelRepository channels;
    @Autowired SellerAccountRepository sellerAccounts;
    @Autowired ProductRepository products;
    @Autowired ReviewTriageRepository triage;
    @Autowired ReviewReplyDraftRepository replyDrafts;
    @Autowired ReviewReplyApprovalRepository replyApprovals;
    @Autowired ReviewReplyOutcomeRepository replyOutcomes;
    @Autowired ItemAnalysisRepository itemAnalyses;
    @Autowired Cafe24CommunityArticleRepository communityArticles;

    private OperatorAttentionService attention;
    private final UUID org = UUID.randomUUID();
    private UUID channelId;

    private static final Instant WHEN = Instant.parse("2026-05-10T00:00:00Z");
    private static final LocalDate FROM = LocalDate.parse("2026-05-01");
    private static final LocalDate TO = LocalDate.parse("2026-05-31");

    @BeforeEach
    void setUp() {
        attention = new OperatorAttentionService(sellerAccounts, channels,
                new VocItemSourceRegistry(List.of(
                        new Cafe24VocItemSource(communityArticles),
                        new IngestedReviewVocItemSource(reviews, sellerAccounts, products, triage,
                                replyDrafts, replyApprovals, replyOutcomes, itemAnalyses))));
        Channel ch = new Channel();
        ch.setCode("NAVER");
        ch.setNameKo("네이버 스마트스토어");
        ch.setStatus(ChannelStatus.AVAILABLE);
        ch.setSortOrder(0);
        channelId = channels.save(ch).getId();
    }

    private UUID naverAccount() {
        SellerAccount acc = new SellerAccount();
        acc.setOrgId(org);
        acc.setChannelId(channelId);
        acc.setConnectionStatus(ChannelStatus.CONNECTED);
        acc.setFileUpload(true);
        return sellerAccounts.save(acc).getId();
    }

    private void seedLowRatingReview() {
        Review r = new Review();
        r.setOrgId(org);
        r.setChannelId(channelId);
        r.setRating(1);
        r.setBody("합성 저평점 리뷰");
        r.setNegative(true);
        r.setReceivedAt(WHEN);
        r.setReplyState(ReviewReplyState.PENDING);
        reviews.save(r);
    }

    @Test
    void singleAccountNaverWithALowRatingReviewIsCoveredAndRaisesTheSignal() {
        UUID accountId = naverAccount();
        seedLowRatingReview();

        OperatorAttentionSummary s = attention.attention(org, accountId, FROM, TO);

        assertThat(s.coverage()).isEqualTo(AttentionCoverage.COVERED);
        assertThat(s.items()).anyMatch(i -> "LOW_RATING_REVIEW".equals(i.type()));
    }

    @Test
    void singleAccountNaverWithNoReviewsIsCoveredWithAMeasuredEmpty() {
        UUID accountId = naverAccount();
        // No reviews seeded — a genuine zero. This MUST stay COVERED (an empty list here honestly
        // means nothing needs a look); the false-calm guard must not swallow the real empty state.

        OperatorAttentionSummary s = attention.attention(org, accountId, FROM, TO);

        assertThat(s.coverage()).isEqualTo(AttentionCoverage.COVERED);
        assertThat(s.items()).isEmpty();
    }

    @Test
    void aSecondNaverAccountInTheOrgMakesTheScopeUncertainNotEmpty() {
        UUID accountId = naverAccount();
        naverAccount(); // a SECOND account on the same NAVER channel — reviews cannot be attributed
        seedLowRatingReview(); // a real 1★ review exists, but which account owns it is unknowable

        OperatorAttentionSummary s = attention.attention(org, accountId, FROM, TO);

        // ⚠ The 1★ review is real; a false calm would hide it behind an empty "nothing needs a look".
        assertThat(s.coverage()).isEqualTo(AttentionCoverage.UNCERTAIN_MULTI_ACCOUNT);
        assertThat(s.items()).isEmpty(); // no fabricated or mis-attributed signal
    }
}
