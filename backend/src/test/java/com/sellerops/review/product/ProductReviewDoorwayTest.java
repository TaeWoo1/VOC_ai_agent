package com.sellerops.review.product;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.channel.ProductChannels;
import com.sellerops.common.ApiException;
import com.sellerops.customermemory.CustomerMemoryEntryRepository;
import com.sellerops.identity.ExecutableIdentityResolver;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.itemanalysis.ItemAnalysisRepository;
import com.sellerops.product.ChannelProductRepository;
import com.sellerops.product.Product;
import com.sellerops.product.ProductQueryService;
import com.sellerops.product.ProductRepository;
import com.sellerops.product.ProductSignalsService;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewRepository;
import com.sellerops.review.product.dto.ProductReviewPageView;
import com.sellerops.reviewissue.ReviewIssueEvidenceRepository;
import com.sellerops.reviewissue.ReviewIssueQueryService;
import com.sellerops.reviewissue.ReviewIssueRepository;
import com.sellerops.reviewissue.ReviewIssueSnapshotService;
import com.sellerops.reviewissue.ReviewIssueStateEventRepository;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * 상품 화면의 리뷰 숫자를 누르면 그 숫자가 센 리뷰가 나온다.
 *
 * <p><b>This is the whole claim of the doorway</b> and it is asserted against the two services
 * together, not against either one's own arithmetic: {@code ProductSignalsService} prints the figure,
 * {@code ProductReviewsService} opens the list, and a test that only checked "the list returns rows"
 * would have passed on the defect this package exists to close.
 *
 * <p>That defect was real and measured. The org-wide window read
 * ({@code RecentReviewService}) is narrowed to {@link ProductChannels#VISIBLE_CODES}, and the figure is
 * not, so on the demo org eight products carried reviews the figure counted and that read could not
 * return — 「리뷰 2」 over an empty list. The case below reproduces exactly that shape.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class ProductReviewDoorwayTest {

    @Autowired ProductRepository products;
    @Autowired ChannelProductRepository listings;
    @Autowired ReviewRepository reviews;
    @Autowired InquiryRepository inquiries;
    @Autowired ItemAnalysisRepository analyses;
    @Autowired ReviewIssueEvidenceRepository evidence;
    @Autowired CustomerMemoryEntryRepository memory;
    @Autowired ChannelRepository channels;
    @Autowired SellerAccountRepository accounts;
    @Autowired ReviewIssueRepository issues;
    @Autowired ReviewIssueStateEventRepository stateEvents;

    private final UUID org = UUID.randomUUID();
    private ProductReviewsService door;
    private ProductSignalsService signals;

    @BeforeEach
    void setUp() {
        ProductQueryService productQuery = new ProductQueryService(products, listings);
        door = new ProductReviewsService(reviews, productQuery, channels, accounts,
                ExecutableIdentityResolver.unresolved());
        ReviewIssueQueryService issueQuery = new ReviewIssueQueryService(issues, evidence, stateEvents,
                new ReviewIssueSnapshotService(evidence), reviews, products);
        signals = new ProductSignalsService(productQuery, issueQuery, evidence, analyses, reviews, inquiries,
                memory, channels);
    }

    @Test
    @DisplayName("the door opens exactly the rows the figure counted")
    void totalMatchesTheFigure() {
        UUID naver = channel("NAVER", "네이버 스마트스토어");
        Product product = product("합성-몰딩-1호");
        review(naver, product.getId(), "붙이는 부분이 떨어졌어요", 1);
        review(naver, product.getId(), "배송도 빠르고 만족합니다", 5);

        long figure = signals.signals(org, product.getId(), null).volume().reviews();
        ProductReviewPageView opened = door.page(org, product.getId(), null, null);

        assertThat(figure).isEqualTo(2);
        assertThat(opened.total()).isEqualTo(figure);
        assertThat(opened.items()).hasSize(2);
        assertThat(opened.items()).allSatisfy(row -> assertThat(row.productId()).isEqualTo(product.getId()));
    }

    @Test
    @DisplayName("a review on a channel the 리뷰 screen cannot show is still behind the number that counted it")
    void nonVisibleChannelReviewsAreNotLostBehindTheDoor() {
        UUID gmarket = channel("GMARKET", "G마켓/옥션");
        assertThat(ProductChannels.isVisible("GMARKET"))
                .as("the premise: this channel is outside the seller-visible set the window read uses")
                .isFalse();
        Product product = product("합성-종이컵보관함");
        review(gmarket, product.getId(), "잘 쓰고 있습니다", 5);
        review(gmarket, product.getId(), "생각보다 작아요", 3);

        long figure = signals.signals(org, product.getId(), null).volume().reviews();
        ProductReviewPageView opened = door.page(org, product.getId(), null, null);

        assertThat(figure).isEqualTo(2);
        assertThat(opened.total())
                .as("2 rows counted, 2 rows behind the door — the empty-list-under-a-figure-of-2 defect")
                .isEqualTo(figure);
        assertThat(opened.items()).hasSize(2);
    }

    @Test
    @DisplayName("a fixture row is behind neither the figure nor the door")
    void syntheticRowsStayOutOfBothSides() {
        UUID naver = channel("NAVER", "네이버 스마트스토어");
        Product product = product("합성-몰딩-1호");
        review(naver, product.getId(), "판매자의 진짜 리뷰", 5);
        Review fixture = review(naver, product.getId(), "업로드 테스트로 들어온 행", 5);
        fixture.setDataOrigin(com.sellerops.common.DataOrigin.VERIFY_FIXTURE);
        reviews.saveAndFlush(fixture);

        long figure = signals.signals(org, product.getId(), null).volume().reviews();
        ProductReviewPageView opened = door.page(org, product.getId(), null, null);

        assertThat(figure).as("the seller's own number counts the seller's own rows").isEqualTo(1);
        assertThat(opened.total()).isEqualTo(1);
        assertThat(opened.items()).singleElement()
                .satisfies(row -> assertThat(row.preview()).contains("판매자의 진짜 리뷰"));
    }

    @Test
    @DisplayName("another product's reviews never appear — the scope is the binding, not the name")
    void noOtherProductContamination() {
        UUID naver = channel("NAVER", "네이버 스마트스토어");
        Product mine = product("합성-몰딩-1호");
        Product theirs = product("합성-몰딩-1호");   // the same catalogue name, deliberately
        review(naver, mine.getId(), "이 상품 리뷰", 5);
        review(naver, theirs.getId(), "다른 상품 리뷰", 5);
        review(naver, null, "상품을 알 수 없는 리뷰", 5);

        ProductReviewPageView opened = door.page(org, mine.getId(), null, null);

        assertThat(opened.total()).isEqualTo(1);
        assertThat(opened.items()).singleElement()
                .satisfies(row -> assertThat(row.productId()).isEqualTo(mine.getId()));
    }

    @Test
    @DisplayName("pages walk the whole record, newest first")
    void pagesWalkTheRecord() {
        UUID naver = channel("NAVER", "네이버 스마트스토어");
        Product product = product("합성-몰딩-1호");
        Review older = review(naver, product.getId(), "먼저 온 리뷰", 5);
        older.setReceivedAt(Instant.parse("2026-01-01T00:00:00Z"));
        reviews.save(older);
        Review newer = review(naver, product.getId(), "나중에 온 리뷰", 5);
        newer.setReceivedAt(Instant.parse("2026-08-01T00:00:00Z"));
        reviews.save(newer);

        ProductReviewPageView first = door.page(org, product.getId(), 0, 1);
        ProductReviewPageView second = door.page(org, product.getId(), 1, 1);

        assertThat(first.total()).isEqualTo(2);
        assertThat(first.items()).singleElement().satisfies(r -> assertThat(r.id()).isEqualTo(newer.getId()));
        assertThat(second.items()).singleElement().satisfies(r -> assertThat(r.id()).isEqualTo(older.getId()));
    }

    @Test
    @DisplayName("another org's product id is not found, and cannot be probed")
    void doorwayIsOrgScoped() {
        Product theirs = new Product();
        theirs.setOrgId(UUID.randomUUID());
        theirs.setName("남의 상품");
        theirs.setStatus("ACTIVE");
        Product saved = products.save(theirs);

        assertThatThrownBy(() -> door.page(org, saved.getId(), null, null))
                .isInstanceOf(ApiException.class)
                .hasMessage("상품을 찾을 수 없습니다.");
    }

    /* ───────────────────────────── fixtures ───────────────────────────── */

    private Product product(String name) {
        Product product = new Product();
        product.setOrgId(org);
        product.setName(name);
        product.setStatus("ACTIVE");
        return products.save(product);
    }

    private Review review(UUID channelId, UUID productId, String body, int rating) {
        Review review = new Review();
        review.setOrgId(org);
        review.setChannelId(channelId);
        review.setProductId(productId);
        review.setRating(rating);
        review.setBody(body);
        review.setNegative(rating <= 2);
        review.setReceivedAt(Instant.parse("2026-08-14T00:00:00Z"));
        return reviews.save(review);
    }

    private UUID channel(String code, String nameKo) {
        return channels.findByCode(code).map(Channel::getId).orElseGet(() -> {
            Channel channel = new Channel();
            channel.setCode(code);
            channel.setNameKo(nameKo);
            channel.setStatus(ChannelStatus.CONNECTED);
            channel.setSupportsInquiry(true);
            channel.setSupportsReview(true);
            channel.setSupportsOrder(true);
            return channels.save(channel).getId();
        });
    }
}
