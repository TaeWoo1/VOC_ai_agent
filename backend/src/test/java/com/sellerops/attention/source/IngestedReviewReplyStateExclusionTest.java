package com.sellerops.attention.source;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.tuple;

import com.sellerops.attention.AttentionSignalType;
import com.sellerops.attention.OperatorAttentionService;
import com.sellerops.attention.dto.AttentionSignal;
import com.sellerops.attention.dto.OperatorVocItemPage;
import com.sellerops.attention.reply.ReviewReplyApprovalRepository;
import com.sellerops.attention.reply.ReviewReplyDraftRepository;
import com.sellerops.attention.reply.ReviewReplyOutcomeRepository;
import com.sellerops.attention.triage.ReviewTriageRepository;
import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.community.Cafe24CommunityArticleRepository;
import com.sellerops.product.ProductRepository;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewReplyState;
import com.sellerops.itemanalysis.ItemAnalysisRepository;
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
 * The queue rule: a review the CHANNEL says is already answered stops asking for attention, while
 * arrivals keep reporting everything that came in.
 *
 * <p>Measured motivation: on a real export 33% of the low-rating rows were already answered, so the
 * "needs a look" count told an operator to look at work that was done — and pointed the guided reply
 * flow at reviews that already had a public reply.
 *
 * <p>The count and the drill-down are asserted TOGETHER in every case. A card that says N건 over a
 * list showing something else is the drift the window semantics exist to prevent, and it is exactly
 * what a one-sided change here would produce.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class IngestedReviewReplyStateExclusionTest {

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
    private UUID accountId;

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

        SellerAccount acc = new SellerAccount();
        acc.setOrgId(org);
        acc.setChannelId(channelId);
        acc.setConnectionStatus(ChannelStatus.CONNECTED);
        acc.setFileUpload(true);
        accountId = sellerAccounts.save(acc).getId();
    }

    private void seed(int rating, ReviewReplyState state, String body) {
        Review r = new Review();
        r.setOrgId(org);
        r.setChannelId(channelId);
        r.setRating(rating);
        r.setBody(body);
        r.setNegative(rating <= 2);
        r.setReceivedAt(Instant.parse("2026-05-10T00:00:00Z"));
        r.setReplyState(state);
        reviews.save(r);
    }

    private List<AttentionSignal> signals() {
        return attention.attention(org, accountId, FROM, TO).items();
    }

    private OperatorVocItemPage lowRatingRows() {
        return attention.attentionItems(org, accountId,
                AttentionSignalType.LOW_RATING_REVIEW.name(), FROM, TO, null, 0, 20);
    }

    @Test
    void anAnsweredLowRatingReviewLeavesTheQueueButStillCountsAsAnArrival() {
        seed(1, ReviewReplyState.PENDING, "합성 본문 A");
        seed(2, ReviewReplyState.ANSWERED, "합성 본문 B");   // already handled on the channel

        assertThat(signals())
                .extracting(AttentionSignal::type, AttentionSignal::severity, AttentionSignal::count)
                .containsExactly(
                        tuple("LOW_RATING_REVIEW", "HIGH", 1L),   // the 2★ answered row is gone…
                        tuple("NEW_REVIEW", "LOW", 2L));          // …but both still arrived

        // The list agrees with the count — one row, and it is the unanswered one.
        assertThat(lowRatingRows().total()).isEqualTo(1);
        assertThat(lowRatingRows().items()).singleElement()
                .satisfies(item -> assertThat(item.replyStatus()).isEqualTo("PENDING"));
    }

    @Test
    void theArrivalsLIST_alsoKeepsTheAnsweredRow() {
        // The count/list parity has to hold on BOTH lenses or the guarantee is half a guarantee: if
        // the exclusion ever leaked into the arrival lens, its count would say 2 and its list show 1.
        seed(1, ReviewReplyState.PENDING, "합성 본문 A");
        seed(2, ReviewReplyState.ANSWERED, "합성 본문 B");

        OperatorVocItemPage arrivals = attention.attentionItems(org, accountId,
                AttentionSignalType.NEW_REVIEW.name(), FROM, TO, null, 0, 20);

        assertThat(arrivals.total()).isEqualTo(2);
        assertThat(arrivals.items()).extracting(item -> item.replyStatus())
                .containsExactlyInAnyOrder("PENDING", "ANSWERED");
    }

    @Test
    void anUnknownStateStillNeedsALook() {
        // Never hide work behind an unknown: an absent statement is not evidence of an answer, and
        // every row that predates reply-state preservation is UNKNOWN by migration default.
        seed(1, ReviewReplyState.UNKNOWN, "합성 본문 C");

        assertThat(signals())
                .extracting(AttentionSignal::type, AttentionSignal::count)
                .contains(tuple("LOW_RATING_REVIEW", 1L));
        assertThat(lowRatingRows().total()).isEqualTo(1);
        assertThat(lowRatingRows().items()).singleElement()
                .satisfies(item -> assertThat(item.replyStatus()).isEqualTo("UNKNOWN"));
    }

    @Test
    void theMidBandIsExcludedTheSameWay() {
        seed(3, ReviewReplyState.ANSWERED, "합성 본문 D");
        seed(3, ReviewReplyState.PENDING, "합성 본문 E");

        assertThat(signals())
                .extracting(AttentionSignal::type, AttentionSignal::severity, AttentionSignal::count)
                .containsExactly(
                        tuple("LOW_RATING_REVIEW", "MEDIUM", 1L),
                        tuple("NEW_REVIEW", "LOW", 2L));
        assertThat(lowRatingRows().total()).isEqualTo(1);
    }

    @Test
    void aQueueEmptiedByAnswersRaisesNoLowRatingSignalAtAll() {
        // The absence is the point: an operator whose backlog is answered should see it gone, not a
        // card that says 0 or a list that contradicts one.
        seed(1, ReviewReplyState.ANSWERED, "합성 본문 F");
        seed(2, ReviewReplyState.ANSWERED, "합성 본문 G");

        assertThat(signals())
                .extracting(AttentionSignal::type)
                .containsExactly("NEW_REVIEW");
        assertThat(lowRatingRows().total()).isZero();
        assertThat(lowRatingRows().items()).isEmpty();
    }

    @Test
    void aHighRatedAnsweredReviewChangesNothingItWasNeverInTheQueue() {
        seed(5, ReviewReplyState.ANSWERED, "합성 본문 H");

        assertThat(signals())
                .extracting(AttentionSignal::type, AttentionSignal::count)
                .containsExactly(tuple("NEW_REVIEW", 1L));
    }
}
