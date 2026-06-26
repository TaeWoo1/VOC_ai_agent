package com.sellerops.collect;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.collect.dto.AccountDashboardSummary;
import com.sellerops.collect.dto.ArticleListResponse;
import com.sellerops.collect.dto.CommunityArticleView;
import com.sellerops.common.ApiException;
import com.sellerops.community.Cafe24CommunityArticle;
import com.sellerops.community.Cafe24CommunityArticleRepository;
import com.sellerops.connector.ChannelConnectionStatus;
import com.sellerops.connector.ChannelConnectionStatusRepository;
import com.sellerops.order.OrderDailySummary;
import com.sellerops.order.OrderDailySummaryRepository;
import com.sellerops.order.OrderService;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * The operator read views over collected channel data: the per-account dashboard
 * summary (window-scoped order/sales + review/inquiry counts + sync state) and the
 * metadata-only article drill-down — over a real (H2) DB.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class ChannelOperationsServiceTest {

    @Autowired SellerAccountRepository sellerAccounts;
    @Autowired ChannelRepository channels;
    @Autowired ChannelConnectionStatusRepository connectionStatus;
    @Autowired Cafe24CommunityArticleRepository articles;
    @Autowired OrderDailySummaryRepository orders;

    private ChannelOperationsService service;
    private final UUID org = UUID.randomUUID();
    private long nextArticleNo = 1000L;

    private static final LocalDate FROM = LocalDate.parse("2026-05-01");
    private static final LocalDate TO = LocalDate.parse("2026-05-31");

    @BeforeEach
    void setUp() {
        service = new ChannelOperationsService(
                sellerAccounts, channels, connectionStatus, articles, new OrderService(orders, channels));
    }

    @Test
    void dashboardAggregatesWindowScopedOrdersArticlesAndSyncState() {
        Fixture f = seedChannelAndAccount("CAFE24");

        // Orders: two in-window for this channel, one out-of-window, one other channel.
        order(f.channelId, "2026-05-05", 3, 30_000);
        order(f.channelId, "2026-05-20", 2, 20_000);
        order(f.channelId, "2026-04-01", 9, 99_000);          // before window
        order(UUID.randomUUID(), "2026-05-10", 7, 77_000);    // other channel

        // Reviews: two in-window, one out-of-window.
        article(f, "REVIEW", "2026-05-10T12:00:00+09:00", "PENDING", 5);
        article(f, "REVIEW", "2026-05-12T12:00:00+09:00", "UNKNOWN", 4);
        article(f, "REVIEW", "2026-04-01T12:00:00+09:00", "PENDING", 3); // before window
        // Inquiries: one PENDING (unanswered) + one ANSWERED in-window, one unknown-date.
        article(f, "PRODUCT_INQUIRY", "2026-05-15T12:00:00+09:00", "PENDING", null);
        article(f, "PRODUCT_INQUIRY", "2026-05-16T12:00:00+09:00", "ANSWERED", null);
        articleUnknownDate(f, "PRODUCT_INQUIRY", "PENDING");  // excluded from counts

        connection(f.accountId, "CONNECTED", Instant.parse("2026-05-21T00:00:00Z"));

        AccountDashboardSummary s = service.accountDashboard(org, f.accountId, FROM, TO);

        assertThat(s.sellerAccountId()).isEqualTo(f.accountId);
        assertThat(s.channelId()).isEqualTo(f.channelId);
        assertThat(s.channelNameKo()).isEqualTo("카페24");
        assertThat(s.fromDate()).isEqualTo(FROM);
        assertThat(s.toDate()).isEqualTo(TO);
        assertThat(s.orderCount()).isEqualTo(5);
        assertThat(s.salesAmount()).isEqualTo(50_000);
        assertThat(s.newReviews()).isEqualTo(2);
        assertThat(s.newInquiries()).isEqualTo(2);
        // Only the confirmed PENDING token counts as unanswered (ANSWERED + unknown-date excluded).
        assertThat(s.unansweredInquiries()).isEqualTo(1);
        assertThat(s.lastSyncState()).isEqualTo("CONNECTED");
        assertThat(s.lastSuccessAt()).isEqualTo(Instant.parse("2026-05-21T00:00:00Z"));
    }

    @Test
    void dashboardOnAnEmptyAccountIsAllZerosAndNotCollected() {
        Fixture f = seedChannelAndAccount("CAFE24");

        AccountDashboardSummary s = service.accountDashboard(org, f.accountId, FROM, TO);

        assertThat(s.orderCount()).isZero();
        assertThat(s.salesAmount()).isZero();
        assertThat(s.newReviews()).isZero();
        assertThat(s.newInquiries()).isZero();
        assertThat(s.unansweredInquiries()).isZero();
        assertThat(s.lastSyncState()).isEqualTo("NOT_COLLECTED");
        assertThat(s.lastSuccessAt()).isNull();
    }

    @Test
    void dashboardRejectsAnInvertedWindow() {
        Fixture f = seedChannelAndAccount("CAFE24");
        assertThatThrownBy(() -> service.accountDashboard(org, f.accountId, TO, FROM))
                .isInstanceOf(ApiException.class);
    }

    @Test
    void dashboardIsOrgScopedSoACrossOrgAccountReadsAsNotFound() {
        Fixture f = seedChannelAndAccount("CAFE24");
        assertThatThrownBy(() -> service.accountDashboard(UUID.randomUUID(), f.accountId, FROM, TO))
                .isInstanceOf(ApiException.class);
    }

    @Test
    void articleDrillDownDistinguishesReviewFromInquiryAndIsMetadataOnly() {
        Fixture f = seedChannelAndAccount("CAFE24");
        article(f, "REVIEW", "2026-05-10T12:00:00+09:00", "PENDING", 5);
        article(f, "REVIEW", "2026-05-12T12:00:00+09:00", "UNKNOWN", 4);
        article(f, "PRODUCT_INQUIRY", "2026-05-15T12:00:00+09:00", "PENDING", null);

        ArticleListResponse reviews = service.accountArticles(org, f.accountId, "REVIEW", 0, 20);
        assertThat(reviews.type()).isEqualTo("REVIEW");
        assertThat(reviews.total()).isEqualTo(2);
        assertThat(reviews.items()).extracting(CommunityArticleView::type).containsOnly("REVIEW");
        // Metadata only: a known-date row exposes a KST calendar date, never content.
        assertThat(reviews.items()).extracting(CommunityArticleView::sourceCreatedDate)
                .containsExactlyInAnyOrder("2026-05-10", "2026-05-12");

        ArticleListResponse inquiries = service.accountArticles(org, f.accountId, "INQUIRY", 0, 20);
        assertThat(inquiries.type()).isEqualTo("INQUIRY");
        assertThat(inquiries.total()).isEqualTo(1);
        assertThat(inquiries.items()).singleElement()
                .satisfies(v -> {
                    assertThat(v.type()).isEqualTo("INQUIRY");
                    assertThat(v.replyStatus()).isEqualTo("PENDING");
                });
    }

    @Test
    void articleDrillDownPaginates() {
        Fixture f = seedChannelAndAccount("CAFE24");
        for (int i = 0; i < 3; i++) {
            article(f, "REVIEW", "2026-05-1" + i + "T12:00:00+09:00", "PENDING", 5);
        }

        ArticleListResponse firstPage = service.accountArticles(org, f.accountId, "REVIEW", 0, 2);
        assertThat(firstPage.size()).isEqualTo(2);
        assertThat(firstPage.items()).hasSize(2);
        assertThat(firstPage.total()).isEqualTo(3);

        ArticleListResponse secondPage = service.accountArticles(org, f.accountId, "REVIEW", 1, 2);
        assertThat(secondPage.items()).hasSize(1);
    }

    @Test
    void articleDrillDownRejectsAnUnknownType() {
        Fixture f = seedChannelAndAccount("CAFE24");
        assertThatThrownBy(() -> service.accountArticles(org, f.accountId, "ONE_TO_ONE", 0, 20))
                .isInstanceOf(ApiException.class);
    }

    // --- fixtures ------------------------------------------------------------

    private record Fixture(UUID channelId, UUID accountId) {
    }

    private Fixture seedChannelAndAccount(String code) {
        Channel ch = new Channel();
        ch.setCode(code);
        ch.setNameKo("카페24");
        ch.setStatus(ChannelStatus.CONNECTED);
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
        sellerAccounts.save(acc);
        return new Fixture(ch.getId(), acc.getId());
    }

    private void order(UUID channelId, String date, int count, long sales) {
        OrderDailySummary o = new OrderDailySummary();
        o.setOrgId(org);
        o.setChannelId(channelId);
        o.setSummaryDate(LocalDate.parse(date));
        o.setOrderCount(count);
        o.setSalesAmount(sales);
        orders.save(o);
    }

    private void article(Fixture f, String sourceKind, String sourceCreatedAt, String replyStatus, Integer rating) {
        saveArticle(f, sourceKind, Instant.parse(toInstant(sourceCreatedAt)), replyStatus, rating);
    }

    private void articleUnknownDate(Fixture f, String sourceKind, String replyStatus) {
        saveArticle(f, sourceKind, null, replyStatus, null);
    }

    private void saveArticle(Fixture f, String sourceKind, Instant sourceCreatedAt,
                             String replyStatus, Integer rating) {
        Cafe24CommunityArticle a = new Cafe24CommunityArticle();
        a.setOrgId(org);
        a.setSellerAccountId(f.accountId);
        a.setChannelId(f.channelId);
        a.setBoardNo("REVIEW".equals(sourceKind) ? 4 : 6);
        // Natural key is (channel, account, board, article_no); keep it unique per row.
        a.setArticleNo(nextArticleNo++);
        a.setSourceKind(sourceKind);
        a.setReplyStatus(replyStatus);
        a.setRating(rating);
        a.setSourceCreatedAt(sourceCreatedAt);
        a.setSourceHash("h-" + a.getArticleNo());
        a.setCollectedAt(Instant.parse("2026-05-25T00:00:00Z"));
        articles.save(a);
    }

    /** Offset timestamp string → UTC instant string for Instant.parse. */
    private static String toInstant(String offsetDateTime) {
        return java.time.OffsetDateTime.parse(offsetDateTime).toInstant().toString();
    }

    private void connection(UUID accountId, String state, Instant lastSuccessAt) {
        ChannelConnectionStatus c = new ChannelConnectionStatus();
        c.setOrgId(org);
        c.setSellerAccountId(accountId);
        c.setState(state);
        c.setLastSuccessAt(lastSuccessAt);
        connectionStatus.save(c);
    }
}
