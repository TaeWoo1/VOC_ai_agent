package com.sellerops.review.channel;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sellerops.attention.reply.ReviewReplyApprovalRepository;
import com.sellerops.attention.reply.ReviewReplyDraftRepository;
import com.sellerops.attention.reply.ReviewReplyWorkLookup;
import com.sellerops.attention.triage.ReviewTriageRepository;
import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.common.ApiException;
import com.sellerops.itemanalysis.ItemAnalysis;
import com.sellerops.itemanalysis.ItemAnalysisRepository;
import com.sellerops.product.ProductRepository;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewReplyState;
import com.sellerops.review.ReviewRepository;
import com.sellerops.review.channel.dto.ChannelReviewPageView;
import com.sellerops.review.channel.dto.ReviewRecordPageView;
import com.sellerops.review.triage.ReviewTriageTier;
import com.sellerops.review.triage.feedback.AiTriageCurrentRepository;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import com.sellerops.sync.SyncJobRepository;
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
 * <b>The organisation's review record is the channel record over more channels — and nothing else</b>
 * (UI/UX v2 Phase 2).
 *
 * <p>Every assertion here compares the new read with the one it widens, on the same rows: the order is the same
 * tier-rank order across channels, a tier filter selects the same rows the per-channel filter does, a channel
 * filter reproduces the channel record exactly, the summary is the sum of the channel summaries, and a row's
 * 「같은 분류 N건」 is still counted within its own channel.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class ReviewRecordIT {

    @Autowired ReviewRepository reviews;
    @Autowired ProductRepository products;
    @Autowired SellerAccountRepository accounts;
    @Autowired ChannelRepository channels;
    @Autowired SyncJobRepository syncJobs;
    @Autowired ItemAnalysisRepository analyses;
    @Autowired AiTriageCurrentRepository aiCurrent;
    @Autowired com.sellerops.review.triage.feedback.TriageCorrectionRepository triageCorrections;
    @Autowired com.sellerops.review.triage.feedback.TriageCorrectionAuditRepository triageCorrectionAudit;
    @Autowired ReviewTriageRepository triages;
    @Autowired ReviewReplyDraftRepository drafts;
    @Autowired ReviewReplyApprovalRepository approvals;

    private ChannelReviewService service;
    private final UUID org = UUID.randomUUID();
    private Channel naver;
    private Channel coupang;
    private SellerAccount naverAccount;
    private SellerAccount coupangAccount;

    @BeforeEach
    void setUp() {
        service = new ChannelReviewService(reviews, products, accounts, syncJobs, analyses, aiCurrent,
                ChannelReviewTriageIT.pilotOff(), channels, new ReviewReplyWorkLookup(triages, drafts, approvals),
                triageCorrections, triageCorrectionAudit);
        naver = channel("NAVER", "네이버 스마트스토어");
        coupang = channel("COUPANG", "쿠팡");
        naverAccount = account(naver);
        coupangAccount = account(coupang);
    }

    @Test
    void ordersEveryChannelByTheSameTierRank_andCarriesEachRowsChannel() {
        Review naverFine = review(naver, 5, "좋아요", LocalDate.of(2026, 9, 10));
        Review coupangBad = review(coupang, 1, "부러져서 왔어요", LocalDate.of(2026, 9, 1));
        Review naverBad = review(naver, 2, "접착이 약해요", LocalDate.of(2026, 9, 5));

        ReviewRecordPageView page = service.record(org, null, null, null, 0, 20);

        assertThat(page.total()).isEqualTo(3);
        assertThat(page.channels()).containsExactly("NAVER", "COUPANG");
        // 확인 필요 first (both low ratings, newest first within the tier), then the rest — across channels.
        assertThat(page.items()).extracting(r -> r.review().id())
                .containsExactly(naverBad.getId(), coupangBad.getId(), naverFine.getId());
        assertThat(page.items()).extracting(ReviewRecordPageView.Row::channelCode)
                .containsExactly("NAVER", "COUPANG", "NAVER");
    }

    @Test
    void aChannelFilterReproducesThatChannelsOwnRecord() {
        review(naver, 5, "좋아요", LocalDate.of(2026, 9, 10));
        review(naver, 1, "", LocalDate.of(2026, 9, 9));
        review(naver, 2, "접착이 약해요", LocalDate.of(2026, 9, 5));
        review(coupang, 1, "부러져서 왔어요", LocalDate.of(2026, 9, 1));

        for (String sort : new String[] {"attention", "newest", "lowest"}) {
            ReviewRecordPageView org = service.record(this.org, "naver", sort, null, 0, 20);
            ChannelReviewPageView channel = service.list(this.org, naverAccount.getId(), sort, null, 0, 20);
            assertThat(org.items()).extracting(r -> r.review().id())
                    .as("sort=%s", sort)
                    .containsExactlyElementsOf(channel.items().stream().map(i -> i.id()).toList());
            assertThat(org.total()).isEqualTo(channel.total());
            assertThat(org.triageSummary()).isEqualTo(channel.triageSummary());
        }
    }

    @Test
    void aTierFilterSelectsTheSameRowsAsEachChannelsFilter_andTheSummaryIsTheirSum() {
        review(naver, 5, "좋아요", LocalDate.of(2026, 9, 10));
        review(naver, 2, "접착이 약해요", LocalDate.of(2026, 9, 5));
        review(coupang, 1, "부러져서 왔어요", LocalDate.of(2026, 9, 1));
        review(coupang, 3, "", LocalDate.of(2026, 9, 2));

        ReviewRecordPageView attention = service.record(org, null, null, ReviewTriageTier.NEEDS_ATTENTION.name(), 0, 20);
        long perChannel = service.list(org, naverAccount.getId(), null, "NEEDS_ATTENTION", 0, 20).total()
                + service.list(org, coupangAccount.getId(), null, "NEEDS_ATTENTION", 0, 20).total();
        assertThat(attention.total()).isEqualTo(perChannel).isEqualTo(2);

        // The summary stays UNFILTERED, exactly as the channel page's does, and sums the channels.
        var n = service.list(org, naverAccount.getId(), null, null, 0, 20).triageSummary();
        var c = service.list(org, coupangAccount.getId(), null, null, 0, 20).triageSummary();
        assertThat(attention.triageSummary().needsAttention()).isEqualTo(n.needsAttention() + c.needsAttention());
        assertThat(attention.triageSummary().watch()).isEqualTo(n.watch() + c.watch());
        assertThat(attention.triageSummary().fyi()).isEqualTo(n.fyi() + c.fyi());
    }

    @Test
    void aRowsSameCategoryCountIsCountedWithinItsOwnChannel() {
        Review a = review(naver, 2, "접착이 약해요", LocalDate.of(2026, 9, 5));
        analyse(a, "접착");
        analyse(review(naver, 2, "또 떨어져요", LocalDate.of(2026, 9, 4)), "접착");
        analyse(review(coupang, 2, "접착 불량", LocalDate.of(2026, 9, 3)), "접착");

        ReviewRecordPageView page = service.record(org, null, null, null, 0, 20);
        var row = page.items().stream().filter(r -> r.review().id().equals(a.getId())).findFirst().orElseThrow();
        var channelRow = service.list(org, naverAccount.getId(), null, null, 0, 20).items().stream()
                .filter(i -> i.id().equals(a.getId())).findFirst().orElseThrow();
        // The same note as on the channel record — 2 in NAVER, not 3 across the organisation.
        assertThat(row.review().triage()).isEqualTo(channelRow.triage());
    }

    @Test
    void pagesAreTotalAndDoNotRepeatAcrossChannels() {
        for (int i = 0; i < 7; i++) {
            review(i % 2 == 0 ? naver : coupang, 2, "불만 " + i, LocalDate.of(2026, 9, 1));
        }
        ReviewRecordPageView first = service.record(org, null, "attention", null, 0, 4);
        ReviewRecordPageView second = service.record(org, null, "attention", null, 1, 4);
        assertThat(first.total()).isEqualTo(7);
        List<UUID> seen = new java.util.ArrayList<>();
        first.items().forEach(r -> seen.add(r.review().id()));
        second.items().forEach(r -> seen.add(r.review().id()));
        assertThat(seen).hasSize(7).doesNotHaveDuplicates();
    }

    @Test
    void anUnknownChannelIsRefusedRatherThanWidened() {
        assertThatThrownBy(() -> service.record(org, "GMARKET", null, null, 0, 20)).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> service.record(org, null, "random", null, 0, 20)).isInstanceOf(ApiException.class);
    }

    @Test
    void anotherOrganisationsReviewsAreNotInTheRecord() {
        review(naver, 1, "우리 리뷰", LocalDate.of(2026, 9, 1));
        Review foreign = review(naver, 1, "남의 리뷰", LocalDate.of(2026, 9, 1));
        foreign.setOrgId(UUID.randomUUID());
        reviews.save(foreign);

        assertThat(service.record(org, null, null, null, 0, 20).items())
                .extracting(r -> r.review().id())
                .doesNotContain(foreign.getId());
    }

    // ── fixtures ────────────────────────────────────────────────────────────────────────────────────────────

    private Channel channel(String code, String name) {
        return channels.findByCode(code).orElseGet(() -> {
            Channel ch = new Channel();
            ch.setCode(code);
            ch.setNameKo(name);
            ch.setStatus(ChannelStatus.AVAILABLE);
            ch.setSupportsInquiry(true);
            ch.setSupportsReview(true);
            ch.setSupportsOrder(true);
            ch.setSupportsSales(true);
            ch.setSupportsProduct(true);
            ch.setSortOrder(code.equals("NAVER") ? 0 : 1);
            return channels.save(ch);
        });
    }

    private SellerAccount account(Channel ch) {
        SellerAccount acc = new SellerAccount();
        acc.setOrgId(org);
        acc.setChannelId(ch.getId());
        acc.setConnectionStatus(ChannelStatus.CONNECTED);
        acc.setFileUpload(false);
        return accounts.save(acc);
    }

    private Review review(Channel ch, Integer rating, String body, LocalDate writtenOn) {
        Review r = new Review();
        r.setOrgId(org);
        r.setChannelId(ch.getId());
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
}
