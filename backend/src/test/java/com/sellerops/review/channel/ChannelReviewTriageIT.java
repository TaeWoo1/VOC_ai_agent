package com.sellerops.review.channel;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.tuple;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.itemanalysis.ItemAnalysis;
import com.sellerops.itemanalysis.ItemAnalysisCategories;
import com.sellerops.itemanalysis.ItemAnalysisRepository;
import com.sellerops.product.ProductRepository;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewReplyState;
import com.sellerops.review.ReviewRepository;
import com.sellerops.review.channel.dto.ChannelReviewPageView;
import com.sellerops.review.triage.ReviewTriageRules;
import com.sellerops.review.triage.ReviewTriageTier;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import com.sellerops.sync.SyncJobRepository;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * Review Triage v1 against a real database.
 *
 * <p>The load-bearing test is {@link #theDatabaseAndTheJavaRuleAgreeAboutEveryReviewItCanHold()}. The
 * tier rule necessarily exists twice — in Java to render a row, in JPQL to sort and count pages the
 * service never loads — and two copies of a rule drift. Rather than spot-check a case or two, it
 * enumerates the rule's ENTIRE input space and asserts the database agrees with
 * {@code ReviewTriageRules} about every one. Change one representation without the other and this
 * fails, naming the combination.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class ChannelReviewTriageIT {

    @Autowired ReviewRepository reviews;
    @Autowired ProductRepository products;
    @Autowired SellerAccountRepository accounts;
    @Autowired ChannelRepository channels;
    @Autowired SyncJobRepository syncJobs;
    @Autowired ItemAnalysisRepository analyses;

    /**
     * Every body form the database can hold, paired with what Java calls it.
     *
     * <p>A null body is absent on purpose: {@code reviews.body} is {@code not null}, so no ingest path
     * can produce one and no row can exist to disagree about. It is covered where it is reachable, in
     * {@code ReviewTriageRulesTest}.
     */
    private static final List<String> BODIES = List.of("", "   ", "본문이 있는 상품평입니다");
    private static final List<Integer> RATINGS = new ArrayList<>(java.util.Arrays.asList(null, 1, 2, 3, 4, 5));

    private ChannelReviewService service;
    private final UUID org = UUID.randomUUID();
    private SellerAccount account;
    private UUID channelId;

    @BeforeEach
    void setUp() {
        service = new ChannelReviewService(reviews, products, accounts, syncJobs, analyses);
        Channel ch = new Channel();
        ch.setCode("COUPANG");
        ch.setNameKo("쿠팡");
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

    private Review review(Integer rating, String body, LocalDate writtenOn) {
        Review r = new Review();
        r.setOrgId(org);
        r.setChannelId(channelId);
        r.setBody(body);
        r.setRating(rating);
        r.setNegative(rating != null && rating <= 2);
        r.setReceivedAt(writtenOn.atStartOfDay(ZoneOffset.UTC).toInstant());
        r.setContentHash(UUID.randomUUID().toString());
        r.setDedupKeyVersion(2);
        r.setReplyState(ReviewReplyState.UNKNOWN);
        r.setMediaCount(0);
        r.setCreatedAt(Instant.now());
        return reviews.save(r);
    }

    private void analyse(Review review, String category) {
        ItemAnalysis a = new ItemAnalysis();
        a.setOrgId(org);
        a.setSourceType("REVIEW");
        a.setSourceId(review.getId());
        a.setSummary("요약");
        a.setCategory(category);
        a.setSentiment("NEUTRAL");
        a.setUrgency("LOW");
        a.setRecommendedAction("확인 필요");
        a.setAnalyzerKind("RULE_BASED");
        a.setAnalyzerName("rule-based");
        a.setAnalyzerVersion("rules-v1");
        analyses.save(a);
    }

    /* ──────────────────── the two representations of one rule ──────────────────── */

    @Test
    void theDatabaseAndTheJavaRuleAgreeAboutEveryReviewItCanHold() {
        // One row per (rating × body) combination the database can hold — the rule's whole input space.
        List<Review> all = new ArrayList<>();
        LocalDate day = LocalDate.of(2026, 6, 1);
        for (Integer rating : RATINGS) {
            for (String body : BODIES) {
                all.add(review(rating, body, day));
            }
        }
        assertThat(all).hasSize(RATINGS.size() * BODIES.size());

        for (ReviewTriageTier tier : ReviewTriageTier.values()) {
            Set<UUID> expected = all.stream()
                    .filter(r -> ReviewTriageRules.tier(r.getRating(), r.getBody()) == tier)
                    .map(Review::getId)
                    .collect(Collectors.toSet());

            ChannelReviewPageView page = service.list(org, account.getId(), null, tier.name(), 0, 100);
            Set<UUID> fromDatabase = page.items().stream()
                    .map(i -> i.id())
                    .collect(Collectors.toSet());

            assertThat(fromDatabase)
                    .as("the JPQL rank and ReviewTriageRules must select the same rows for %s", tier)
                    .isEqualTo(expected);
            // And the count the summary reports is the same set again, not a fourth opinion.
            assertThat(tierCount(page, tier))
                    .as("summary count for %s", tier)
                    .isEqualTo(expected.size());
        }
    }

    @Test
    void everyRowAlsoCarriesTheTierItWasSelectedBy() {
        // The filter agreeing with the rule is not enough on its own: the note rendered onto the row
        // could still disagree with the query that found it, and the operator reads the note.
        for (Integer rating : RATINGS) {
            for (String body : BODIES) {
                review(rating, body, LocalDate.of(2026, 6, 1));
            }
        }
        ChannelReviewPageView page = service.list(org, account.getId(), null, null, 0, 100);
        assertThat(page.items()).hasSize(RATINGS.size() * BODIES.size());
        for (var item : page.items()) {
            assertThat(item.triage().tier())
                    .as("rating %s", item.rating())
                    .isEqualTo(ReviewTriageRules.tier(item.rating(),
                            item.textless() ? "" : "본문이 있는 상품평입니다"));
        }
    }

    /* ──────────────────────────────── the order ──────────────────────────────── */

    @Test
    void theListPutsWhatNeedsAttentionFirstAndTheNewestOfThoseAtTheTop() {
        Review oldComplaint = review(1, "접착력이 약합니다", LocalDate.of(2026, 6, 1));
        Review newComplaint = review(2, "포장이 찌그러졌습니다", LocalDate.of(2026, 6, 10));
        Review praise = review(5, "만족합니다", LocalDate.of(2026, 6, 20));
        Review ratingOnly = review(1, "", LocalDate.of(2026, 6, 15));

        List<UUID> order = service.list(org, account.getId(), null, null, 0, 20).items().stream()
                .map(i -> i.id()).toList();

        // 확인 필요 first (newest of them leading), then 지켜보기, then 참고 — the 5★ from the 20th
        // sits LAST despite being the newest row, which is the whole point of the default order.
        assertThat(order).containsExactly(
                newComplaint.getId(), oldComplaint.getId(), ratingOnly.getId(), praise.getId());
    }

    @Test
    void theOtherSortsStillMeanWhatTheyMeant() {
        review(1, "접착력이 약합니다", LocalDate.of(2026, 6, 1));
        review(5, "만족합니다", LocalDate.of(2026, 6, 20));

        assertThat(service.list(org, account.getId(), "newest", null, 0, 20).items().get(0).rating())
                .isEqualTo(5);
        assertThat(service.list(org, account.getId(), "lowest", null, 0, 20).items().get(0).rating())
                .isEqualTo(1);
    }

    @Test
    void anUnknownSortIsStillRefusedRatherThanQuietlyTriaged() {
        assertThatThrownBy(() -> service.list(org, account.getId(), "worst-first", null, 0, 20))
                .hasMessageContaining("정렬 방식");
    }

    @Test
    void anUnknownTierIsRefusedRatherThanIgnored() {
        // Ignoring it would show the whole record under a filter chip the operator believes is on.
        assertThatThrownBy(() -> service.list(org, account.getId(), null, "URGENT", 0, 20))
                .hasMessageContaining("알 수 없는 상품평 분류");
    }

    @Test
    void aTierFilterSurvivesAChangeOfSort() {
        review(1, "접착력이 약합니다", LocalDate.of(2026, 6, 1));
        review(5, "만족합니다", LocalDate.of(2026, 6, 20));

        for (String sort : new String[] {null, "attention", "newest", "lowest"}) {
            ChannelReviewPageView page =
                    service.list(org, account.getId(), sort, "NEEDS_ATTENTION", 0, 20);
            assertThat(page.items()).as("sort=%s", sort).hasSize(1);
            assertThat(page.items().get(0).rating()).isEqualTo(1);
        }
    }

    /* ─────────────────────────────── the summary ─────────────────────────────── */

    @Test
    void theSummaryCountsTheWholeRecordRatherThanThePageOnScreen() {
        for (int i = 0; i < 25; i++) {
            review(1, "접착력이 약합니다", LocalDate.of(2026, 6, 1).plusDays(i));
        }
        ChannelReviewPageView firstPage = service.list(org, account.getId(), null, null, 0, 20);

        assertThat(firstPage.items()).hasSize(20);
        // A per-page count would read as the work shrinking every time the operator turned a page.
        assertThat(firstPage.triageSummary().needsAttention()).isEqualTo(25);
    }

    @Test
    void theSummaryStaysUnfilteredSoThereIsAWayBack() {
        review(1, "접착력이 약합니다", LocalDate.of(2026, 6, 1));
        review(5, "만족합니다", LocalDate.of(2026, 6, 20));
        review(3, "그럭저럭입니다", LocalDate.of(2026, 6, 10));

        ChannelReviewPageView filtered =
                service.list(org, account.getId(), null, "NEEDS_ATTENTION", 0, 20);

        assertThat(filtered.items()).hasSize(1);
        // Recomputed under its own filter, the summary would read 1 / 0 / 0 and the other two chips
        // would offer the operator nothing to press.
        assertThat(filtered.triageSummary().needsAttention()).isEqualTo(1);
        assertThat(filtered.triageSummary().watch()).isEqualTo(1);
        assertThat(filtered.triageSummary().fyi()).isEqualTo(1);
    }

    @Test
    void aCategoryRepeatsOnlyOnceItClearsTheFloor() {
        // Two 설치 rows: real, but two co-occur by chance often enough to be noise.
        analyse(review(1, "부착이 잘 안 됩니다", LocalDate.of(2026, 6, 1)), "설치");
        analyse(review(1, "붙이기 어렵습니다", LocalDate.of(2026, 6, 2)), "설치");
        assertThat(service.list(org, account.getId(), null, null, 0, 20)
                .triageSummary().repeatedCategories()).isEmpty();

        analyse(review(1, "떨어졌습니다", LocalDate.of(2026, 6, 3)), "설치");
        assertThat(service.list(org, account.getId(), null, null, 0, 20)
                .triageSummary().repeatedCategories())
                .extracting(c -> c.category(), c -> c.count())
                .containsExactly(tuple("설치", 3L));
    }

    @Test
    void theAnalyzersShrugIsNeverReportedAsARepeatingIssue() {
        // 기타 means "we looked and it fitted nothing". Ranking it as the seller's top repeating issue
        // would turn a non-finding into the headline.
        for (int i = 0; i < 9; i++) {
            analyse(review(5, "좋아요", LocalDate.of(2026, 6, 1).plusDays(i)),
                    ItemAnalysisCategories.FALLBACK);
        }
        analyse(review(1, "부착이 잘 안 됩니다", LocalDate.of(2026, 6, 20)), "설치");
        analyse(review(1, "붙이기 어렵습니다", LocalDate.of(2026, 6, 21)), "설치");
        analyse(review(1, "떨어졌습니다", LocalDate.of(2026, 6, 22)), "설치");

        assertThat(service.list(org, account.getId(), null, null, 0, 20)
                .triageSummary().repeatedCategories())
                .extracting(c -> c.category())
                .containsExactly("설치");
    }

    @Test
    void theRowsRepeatCountIsTheChannelsCountNotThePages() {
        for (int i = 0; i < 25; i++) {
            analyse(review(1, "부착이 잘 안 됩니다", LocalDate.of(2026, 6, 1).plusDays(i)), "설치");
        }
        // Page 2 holds five rows; the count beside each of them still describes all 25.
        ChannelReviewPageView second = service.list(org, account.getId(), null, null, 1, 20);
        assertThat(second.items()).hasSize(5);
        assertThat(second.items().get(0).triage().reason()).contains("같은 분류 25건");
    }

    @Test
    void aReviewFromAnotherOrgNeverCountsTowardsThisOnesRepeats() {
        // item_analyses.source_id is a bare polymorphic reference with no FK, so the org clause in the
        // grouped count is authorization rather than tidiness.
        UUID otherOrg = UUID.randomUUID();
        for (int i = 0; i < 5; i++) {
            Review r = review(1, "부착이 잘 안 됩니다", LocalDate.of(2026, 6, 1).plusDays(i));
            ItemAnalysis a = new ItemAnalysis();
            a.setOrgId(otherOrg);
            a.setSourceType("REVIEW");
            a.setSourceId(r.getId());
            a.setSummary("요약");
            a.setCategory("설치");
            a.setSentiment("NEUTRAL");
            a.setUrgency("LOW");
            a.setRecommendedAction("확인 필요");
            a.setAnalyzerKind("RULE_BASED");
            a.setAnalyzerName("rule-based");
            a.setAnalyzerVersion("rules-v1");
            analyses.save(a);
        }

        ChannelReviewPageView page = service.list(org, account.getId(), null, null, 0, 20);
        assertThat(page.triageSummary().repeatedCategories()).isEmpty();
        assertThat(page.items().get(0).triage().tags()).isEmpty();
    }

    @Test
    void theDetailSaysTheSameThingTheListRowDid() {
        Review r = review(1, "부착 후 며칠 지나니 떨어졌어요", LocalDate.of(2026, 6, 1));
        analyse(r, "설치");
        analyse(review(1, "붙이기 어렵습니다", LocalDate.of(2026, 6, 2)), "설치");
        analyse(review(1, "잘 안 붙습니다", LocalDate.of(2026, 6, 3)), "설치");

        var fromList = service.list(org, account.getId(), null, null, 0, 20).items().stream()
                .filter(i -> i.id().equals(r.getId())).findFirst().orElseThrow();
        var fromDetail = service.detail(org, account.getId(), r.getId());

        assertThat(fromDetail.triage()).isEqualTo(fromList.triage());
    }

    private long tierCount(ChannelReviewPageView page, ReviewTriageTier tier) {
        return switch (tier) {
            case NEEDS_ATTENTION -> page.triageSummary().needsAttention();
            case WATCH -> page.triageSummary().watch();
            case FYI -> page.triageSummary().fyi();
        };
    }
}
