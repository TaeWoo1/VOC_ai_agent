package com.sellerops.review.recent;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.common.ApiException;
import com.sellerops.common.DataOrigin;
import com.sellerops.connector.ConnectorCapabilityRepository;
import com.sellerops.coverage.ChannelCoverageService;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.order.OrderDailySummaryRepository;
import com.sellerops.product.Product;
import com.sellerops.product.ProductRepository;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewReplyState;
import com.sellerops.review.ReviewRepository;
import com.sellerops.review.recent.dto.RecentReviewItemView;
import com.sellerops.review.recent.dto.RecentReviewsResponse;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import com.sellerops.reviewimport.ReviewImportSegmentAttemptRepository;
import com.sellerops.sync.SyncJobRepository;
import com.sellerops.sync.SyncScheduleRepository;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * 「오늘 새 리뷰」 is a window over REAL rows across the channels the seller can see, and the answer
 * carries the coverage that says whether the window was actually read.
 *
 * <p>What is under test is mostly what this read REFUSES: a seeded review never appears as something
 * a buyer wrote, a row outside the window never leaks in on either edge, and a channel filter narrows
 * rather than silently widening. The coverage list is asserted to be REVIEW rows only, because the
 * caller turns it into a per-channel freshness verdict and an INQUIRY row in that list would be a
 * verdict about the wrong thing.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class RecentReviewServiceTest {

    private static final LocalDate TODAY = LocalDate.of(2026, 8, 27);
    private static final Clock CLOCK = Clock.fixed(TODAY.atStartOfDay(ZoneOffset.UTC).toInstant().plusSeconds(3600),
            ZoneOffset.UTC);
    private static final String BODY = "배송도 빠르고 포장도 꼼꼼해서 만족합니다";

    @Autowired ReviewRepository reviews;
    @Autowired ProductRepository products;
    @Autowired SellerAccountRepository accounts;
    @Autowired ChannelRepository channels;
    @Autowired ConnectorCapabilityRepository capabilities;
    @Autowired SyncScheduleRepository schedules;
    @Autowired SyncJobRepository syncJobs;
    @Autowired InquiryRepository inquiries;
    @Autowired OrderDailySummaryRepository orders;
    @Autowired ReviewImportSegmentAttemptRepository acquisitions;

    private final UUID org = UUID.randomUUID();
    private RecentReviewService service;
    private Channel coupang;
    private Channel cafe24;
    private Channel naver;

    @BeforeEach
    void setUp() {
        ChannelCoverageService coverage = new ChannelCoverageService(channels, capabilities, accounts, schedules,
                syncJobs, inquiries, reviews, orders, acquisitions);
        service = new RecentReviewService(reviews, products, accounts, channels, coverage, CLOCK);
        coupang = channel("COUPANG");
        cafe24 = channel("CAFE24");
        naver = channel("NAVER");
        account(coupang);
        account(cafe24);
        // NAVER exists in the catalogue but this org never connected it.
    }

    // ---------------------------------------------------------------- fixtures

    private Channel channel(String code) {
        Channel ch = new Channel();
        ch.setCode(code);
        ch.setNameKo(code + "몰");
        ch.setStatus(ChannelStatus.AVAILABLE);
        ch.setSupportsInquiry(true);
        ch.setSupportsReview(true);
        ch.setSupportsOrder(true);
        ch.setSupportsSales(true);
        ch.setSupportsProduct(true);
        ch.setSortOrder(0);
        return channels.save(ch);
    }

    private SellerAccount account(Channel ch) {
        SellerAccount acc = new SellerAccount();
        acc.setOrgId(org);
        acc.setChannelId(ch.getId());
        acc.setConnectionStatus(ChannelStatus.CONNECTED);
        acc.setFileUpload(false);
        return accounts.save(acc);
    }

    private Product product(String name) {
        Product p = new Product();
        p.setOrgId(org);
        p.setName(name);
        p.setSku(UUID.randomUUID().toString().substring(0, 8));
        p.setStatus("ACTIVE");
        return products.save(p);
    }

    private Review review(Channel ch, String body, int rating, LocalDate writtenOn, Product product,
                          DataOrigin origin) {
        Review r = new Review();
        r.setOrgId(org);
        r.setChannelId(ch.getId());
        r.setProductId(product == null ? null : product.getId());
        r.setBody(body);
        r.setRating(rating);
        r.setNegative(rating <= 2);
        r.setReceivedAt(writtenOn.atStartOfDay(ZoneOffset.UTC).toInstant());
        r.setContentHash(UUID.randomUUID().toString());
        r.setDedupKeyVersion(2);
        r.setReplyState(ReviewReplyState.UNKNOWN);
        r.setMediaCount(0);
        r.setCreatedAt(Instant.now());
        r.setDataOrigin(origin);
        return reviews.save(r);
    }

    private Review real(Channel ch, int rating, LocalDate on) {
        return review(ch, BODY, rating, on, null, DataOrigin.REAL);
    }

    // ---------------------------------------------------------------- tests

    @Test
    @DisplayName("only REAL rows are listed and counted — a seeded review is not something a buyer wrote")
    void realOnly() {
        real(coupang, 5, TODAY);
        review(coupang, BODY, 1, TODAY, null, DataOrigin.DEMO_SEED);
        review(cafe24, BODY, 1, TODAY, null, DataOrigin.VERIFY_FIXTURE);

        RecentReviewsResponse page = service.recent(org, TODAY, TODAY, false, null, null, null);

        assertThat(page.total()).isEqualTo(1);
        assertThat(page.items()).hasSize(1);
        assertThat(page.items().get(0).rating()).isEqualTo(5);
    }

    @Test
    @DisplayName("the window is [from, to] inclusive on calendar days and excludes both outer edges")
    void windowBounds() {
        LocalDate from = TODAY.minusDays(2);
        real(coupang, 5, from.minusDays(1));        // the day before — out
        Review first = real(coupang, 5, from);      // first day — in
        Review last = real(cafe24, 4, TODAY);       // last day — in
        real(cafe24, 4, TODAY.plusDays(1));         // tomorrow — out

        RecentReviewsResponse page = service.recent(org, from, TODAY, false, null, null, null);

        assertThat(page.from()).isEqualTo(from);
        assertThat(page.to()).isEqualTo(TODAY);
        assertThat(page.total()).isEqualTo(2);
        assertThat(page.items()).extracting(RecentReviewItemView::id).containsExactly(last.getId(), first.getId());
        assertThat(page.items().get(0).writtenOn()).isEqualTo(TODAY);
    }

    @Test
    @DisplayName("no dates means everything held — an absent lower bound is NO lower bound")
    void noDatesIsUnbounded() {
        // Conversation Contract Correctness v2: this read used to substitute a seven-day window, so a
        // question with no period in it ("별점 낮은 리뷰 보여줘") was answered about a week. The caller
        // stopped inventing a window for that reason and the invention had simply moved down a layer.
        real(coupang, 5, TODAY.minusDays(6));
        real(coupang, 5, TODAY.minusDays(7));

        RecentReviewsResponse page = service.recent(org, null, null, false, null, null, null);

        assertThat(page.from()).isEqualTo(LocalDate.of(1970, 1, 1));
        assertThat(page.to()).isEqualTo(TODAY);
        assertThat(page.total()).isEqualTo(2);
    }

    @Test
    @DisplayName("negativeOnly keeps the negative rows and the count agrees with the rows")
    void negativeOnly() {
        real(coupang, 5, TODAY);
        Review bad = real(coupang, 1, TODAY);
        real(cafe24, 4, TODAY);
        Review worse = real(cafe24, 2, TODAY.minusDays(1));

        RecentReviewsResponse page = service.recent(org, TODAY.minusDays(1), TODAY, true, null, null, null);

        assertThat(page.negativeOnly()).isTrue();
        assertThat(page.total()).isEqualTo(2);
        assertThat(page.items()).extracting(RecentReviewItemView::id).containsExactly(bad.getId(), worse.getId());
        assertThat(page.items()).allMatch(RecentReviewItemView::negative);
    }

    @Test
    @DisplayName("a channel filter narrows the rows, the count and the coverage to that channel")
    void channelFilter() {
        real(coupang, 5, TODAY);
        Review c24 = real(cafe24, 5, TODAY);

        RecentReviewsResponse page = service.recent(org, TODAY, TODAY, false, "cafe24", null, null);

        assertThat(page.total()).isEqualTo(1);
        assertThat(page.items()).extracting(RecentReviewItemView::id).containsExactly(c24.getId());
        assertThat(page.items().get(0).channelCode()).isEqualTo("CAFE24");
        assertThat(page.items().get(0).channelNameKo()).isEqualTo("CAFE24몰");
        assertThat(page.coverage()).extracting(row -> row.channelCode()).containsExactly("CAFE24");
    }

    @Test
    @DisplayName("an unknown channel is refused, never widened to all channels")
    void unknownChannelIsRefused() {
        assertThatThrownBy(() -> service.recent(org, TODAY, TODAY, false, "ESM", null, null))
                .isInstanceOf(ApiException.class);
    }

    @Test
    @DisplayName("size caps the merged rows across channels while total still counts the whole window")
    void sizeCap() {
        for (int i = 0; i < 4; i++) {
            real(coupang, 5, TODAY.minusDays(i));
            real(cafe24, 5, TODAY.minusDays(i));
        }

        RecentReviewsResponse page = service.recent(org, TODAY.minusDays(6), TODAY, false, null, null, 3);

        assertThat(page.total()).isEqualTo(8);
        assertThat(page.items()).hasSize(3);
        assertThat(page.items()).extracting(RecentReviewItemView::writtenOn)
                .as("newest first across both channels").containsExactly(TODAY, TODAY, TODAY.minusDays(1));
        assertThat(service.recent(org, TODAY.minusDays(6), TODAY, false, null, null, 500).items())
                .as("the ceiling is the ceiling").hasSizeLessThanOrEqualTo(RecentReviewService.MAX_SIZE);
    }

    @Test
    @DisplayName("productId narrows, and the product name rides along org-scoped")
    void productFilterAndName() {
        Product molding = product("평면 몰딩 2호");
        Review mine = review(coupang, BODY, 5, TODAY, molding, DataOrigin.REAL);
        review(coupang, BODY, 5, TODAY, product("다른 상품"), DataOrigin.REAL);

        RecentReviewsResponse page = service.recent(org, TODAY, TODAY, false, null, molding.getId(), null);

        assertThat(page.total()).isEqualTo(1);
        assertThat(page.items()).extracting(RecentReviewItemView::id).containsExactly(mine.getId());
        assertThat(page.items().get(0).productName()).isEqualTo("평면 몰딩 2호");
        assertThat(page.items().get(0).preview()).isNotBlank();
    }

    @Test
    @DisplayName("a rating-only review has no preview rather than a blank one")
    void textlessHasNoPreview() {
        review(coupang, "", 3, TODAY, null, DataOrigin.REAL);

        RecentReviewsResponse page = service.recent(org, TODAY, TODAY, false, null, null, null);

        assertThat(page.items()).hasSize(1);
        assertThat(page.items().get(0).preview()).isNull();
    }

    @Test
    @DisplayName("coverage is the REVIEW row of every visible channel — including the one never connected")
    void coverageIsReviewOnlyAndComplete() {
        real(coupang, 5, TODAY);

        RecentReviewsResponse page = service.recent(org, TODAY, TODAY, false, null, null, null);

        assertThat(page.coverage()).isNotEmpty();
        assertThat(page.coverage()).allMatch(row -> "REVIEW".equals(row.dataType()));
        assertThat(page.coverage()).extracting(row -> row.channelCode())
                .containsExactlyInAnyOrder("NAVER", "COUPANG", "CAFE24");
        assertThat(page.coverage()).filteredOn(row -> "NAVER".equals(row.channelCode()))
                .allMatch(row -> !row.connected());
        assertThat(page.items()).as("the unconnected channel contributed no rows").hasSize(1);
    }
}
