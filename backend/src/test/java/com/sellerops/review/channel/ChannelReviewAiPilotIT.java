package com.sellerops.review.channel;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.itemanalysis.ItemAnalysisRepository;
import com.sellerops.product.ProductRepository;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewReplyState;
import com.sellerops.review.ReviewRepository;
import com.sellerops.review.channel.dto.ChannelReviewItemView;
import com.sellerops.review.channel.dto.ChannelReviewPageView;
import com.sellerops.review.triage.ReviewTriageRules;
import com.sellerops.review.triage.ReviewTriageTier;
import com.sellerops.review.triage.feedback.AiTriageCurrent;
import com.sellerops.review.triage.feedback.AiTriageCurrentRepository;
import com.sellerops.review.triage.pilot.AiTriagePilotProperties;
import com.sellerops.review.triage.pilot.AiTriagePilotService;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import com.sellerops.sync.SyncJobRepository;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * RUBRIC v2 §13.7's pilot on the read path, checked over the rule's ENTIRE input space — the same
 * move {@link ChannelReviewTriageIT} makes for the rule alone.
 *
 * <p>The claim under test is item 2 of that section: the ordering, the filter and the summary all
 * take {@code min(rules rank, ai rank)}, and there is no expression that lowers a review the rule
 * already ranks 확인 필요. Checked by writing an {@code AiTriageCurrent} row for every (rating × body)
 * combination, in every combination of {@code aiAttention} true/false, and asserting per row.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class ChannelReviewAiPilotIT {

    @Autowired ReviewRepository reviews;
    @Autowired ProductRepository products;
    @Autowired SellerAccountRepository accounts;
    @Autowired ChannelRepository channels;
    @Autowired SyncJobRepository syncJobs;
    @Autowired ItemAnalysisRepository analyses;
    @Autowired AiTriageCurrentRepository aiCurrent;

    private static final List<String> BODIES = List.of("", "   ", "본문이 있는 상품평입니다");
    private static final List<Integer> RATINGS = new ArrayList<>(java.util.Arrays.asList(null, 1, 2, 3, 4, 5));

    private final UUID org = UUID.randomUUID();
    private SellerAccount account;
    private UUID channelId;

    @BeforeEach
    void setUp() {
        Channel ch = new Channel();
        ch.setCode("NAVER");
        ch.setNameKo("네이버");
        ch.setStatus(ChannelStatus.AVAILABLE);
        ch.setSupportsInquiry(true);
        ch.setSupportsReview(true);
        ch.setSupportsOrder(true);
        ch.setSupportsSales(true);
        ch.setSupportsProduct(true);
        ch.setSortOrder(0);
        channels.save(ch);
        SellerAccount acc = new SellerAccount();
        acc.setOrgId(org);
        acc.setChannelId(ch.getId());
        acc.setConnectionStatus(ChannelStatus.CONNECTED);
        acc.setFileUpload(false);
        account = accounts.save(acc);
        channelId = ch.getId();
    }

    private ChannelReviewService serviceWith(boolean pilotOnForOrg) {
        AiTriagePilotProperties props = new AiTriagePilotProperties(pilotOnForOrg,
                pilotOnForOrg ? org.toString() : "", "OPENAI", "m", pilotOnForOrg ? "key" : "", true, 4000, "low", 100);
        // A gate is needed only to run; the read path asks isEnabledFor(), which is properties + a
        // non-null gate. Hand it a gate around a classifier that is never called.
        AiTriagePilotService pilot = new AiTriagePilotService(props, reviews, accounts, channels, aiCurrent, null,
                pilotOnForOrg ? new com.sellerops.review.triage.llm.NaverOnlyClassifierGate(
                        new com.sellerops.review.triage.llm.ReviewTriageClassifier() {
                            @Override public String version() { return "test/v"; }
                            @Override public Result classify(Input input) { throw new AssertionError("never called"); }
                        }) : null);
        return new ChannelReviewService(reviews, products, accounts, syncJobs, analyses, aiCurrent, pilot);
    }

    private Review review(Integer rating, String body) {
        Review r = new Review();
        r.setOrgId(org);
        r.setChannelId(channelId);
        r.setBody(body);
        r.setRating(rating);
        r.setNegative(rating != null && rating <= 2);
        r.setReceivedAt(LocalDate.of(2026, 6, 1).atStartOfDay(ZoneOffset.UTC).toInstant());
        r.setContentHash(UUID.randomUUID().toString());
        r.setDedupKeyVersion(2);
        r.setReplyState(ReviewReplyState.UNKNOWN);
        r.setMediaCount(0);
        r.setCreatedAt(Instant.now());
        return reviews.save(r);
    }

    private void mark(Review r, boolean attention) {
        AiTriageCurrent c = new AiTriageCurrent();
        c.setOrgId(org);
        c.setReviewId(r.getId());
        c.setPredictionId(UUID.randomUUID());
        c.setAiAttention(attention);
        c.setClassifierVersion("test/v");
        c.setPredictedAt(Instant.now());
        aiCurrent.save(c);
    }

    private static ReviewTriageTier finalTier(ChannelReviewItemView item) {
        return item.aiMark() != null ? ReviewTriageTier.NEEDS_ATTENTION : item.triage().tier();
    }

    @Test
    @DisplayName("the mark can only ADD: over every (rating × body × mark), final = min(rules, ai), never lower")
    void theMarkIsAdditiveOverTheWholeInputSpace() {
        // Every combination the rule can see, three times: unmarked, marked false, marked true.
        List<Review> unmarked = new ArrayList<>();
        List<Review> markedFalse = new ArrayList<>();
        List<Review> markedTrue = new ArrayList<>();
        for (Integer rating : RATINGS) {
            for (String body : BODIES) {
                unmarked.add(review(rating, body));
                Review f = review(rating, body);
                mark(f, false);
                markedFalse.add(f);
                Review t = review(rating, body);
                mark(t, true);
                markedTrue.add(t);
            }
        }
        ChannelReviewService service = serviceWith(true);
        ChannelReviewPageView page = service.list(org, account.getId(), null, null, 0, 100);
        assertThat(page.items()).hasSize(3 * RATINGS.size() * BODIES.size());

        for (ChannelReviewItemView item : page.items()) {
            ReviewTriageTier rules = ReviewTriageRules.tier(item.rating(), item.textless() ? "" : "본문이 있는 상품평입니다");
            assertThat(item.triage().tier()).as("the rules tier on the row is the rule's").isEqualTo(rules);
            boolean isMarkedTrue = markedTrue.stream().anyMatch(r -> r.getId().equals(item.id()));
            if (rules == ReviewTriageTier.NEEDS_ATTENTION) {
                // A rules positive is NEVER marked — there is nothing to add — and never lowered.
                assertThat(item.aiMark()).as("no mark on a rules 확인 필요, rating %s", item.rating()).isNull();
                assertThat(finalTier(item)).isEqualTo(ReviewTriageTier.NEEDS_ATTENTION);
            } else if (isMarkedTrue) {
                assertThat(item.aiMark()).as("marked true → AI 확인 필요, rating %s", item.rating()).isNotNull();
                assertThat(finalTier(item)).isEqualTo(ReviewTriageTier.NEEDS_ATTENTION);
            } else {
                // Unmarked, or marked false: exactly the rule.
                assertThat(item.aiMark()).isNull();
                assertThat(finalTier(item)).isEqualTo(rules);
            }
        }

        // The ordering agrees: every AI-marked non-rules-positive sorts in the top band, before any
        // row whose final tier is not 확인 필요. And the filter tier=NEEDS_ATTENTION returns exactly the
        // rows whose final tier is 확인 필요 — rules positives PLUS marked promotions.
        List<ReviewTriageTier> order = page.items().stream().map(ChannelReviewAiPilotIT::finalTier).toList();
        int attention = (int) order.stream().filter(t -> t == ReviewTriageTier.NEEDS_ATTENTION).count();
        assertThat(order.subList(0, attention)).as("every 확인 필요 — rule's or AI's — sorts before any other row")
                .containsOnly(ReviewTriageTier.NEEDS_ATTENTION);
        assertThat(order.subList(attention, order.size())).doesNotContain(ReviewTriageTier.NEEDS_ATTENTION);

        ChannelReviewPageView filtered = service.list(org, account.getId(), null, "NEEDS_ATTENTION", 0, 100);
        long expected = page.items().stream().filter(i -> finalTier(i) == ReviewTriageTier.NEEDS_ATTENTION).count();
        assertThat(filtered.items()).hasSize((int) expected);
        assertThat(filtered.triageSummary().needsAttention()).isEqualTo(expected);
        // And the AI count is the marked promotions only — a subset, never an addition.
        long promoted = page.items().stream().filter(i -> i.aiMark() != null).count();
        assertThat(filtered.triageSummary().aiAttention()).isEqualTo(promoted);
        assertThat(promoted).isLessThan(expected);
        // Tiers still partition: needsAttention + watch + fyi = the record.
        assertThat(filtered.triageSummary().needsAttention() + filtered.triageSummary().watch()
                + filtered.triageSummary().fyi()).isEqualTo(page.items().size());
    }

    @Test
    @DisplayName("an org NOT opted in reads exactly as before the pilot existed, even with rows in the table")
    void anOrgSwitchedOffForgetsTheMarksEverywhere() {
        for (Integer rating : RATINGS) {
            for (String body : BODIES) {
                mark(review(rating, body), true);
            }
        }
        ChannelReviewService service = serviceWith(false);
        ChannelReviewPageView page = service.list(org, account.getId(), null, null, 0, 100);
        assertThat(page.items()).allSatisfy(i -> assertThat(i.aiMark()).isNull());
        assertThat(page.triageSummary().aiAttention()).isZero();
        // The ordering forgot them too — the top band is only the rules positives. Otherwise a row
        // would sort to the top with a WATCH chip and no mark to say why.
        long rulesPositives = page.items().stream()
                .filter(i -> i.triage().tier() == ReviewTriageTier.NEEDS_ATTENTION).count();
        assertThat(page.triageSummary().needsAttention()).isEqualTo(rulesPositives);
        assertThat(page.items().subList(0, (int) rulesPositives))
                .allSatisfy(i -> assertThat(i.triage().tier()).isEqualTo(ReviewTriageTier.NEEDS_ATTENTION));
        assertThat(service.list(org, account.getId(), null, "NEEDS_ATTENTION", 0, 100).items())
                .hasSize((int) rulesPositives);
    }

    @Test
    @DisplayName("the detail carries the same mark the list row did")
    void detailAgreesWithList() {
        Review r = review(5, "본문이 있는 상품평입니다");
        mark(r, true);
        ChannelReviewService service = serviceWith(true);
        assertThat(service.detail(org, account.getId(), r.getId()).aiMark()).isNotNull();
        assertThat(service.detail(org, account.getId(), r.getId()).triage().tier()).isEqualTo(ReviewTriageTier.FYI);
    }
}
