package com.sellerops.collect;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.collect.dto.AccountDashboardSummary;
import com.sellerops.collect.dto.ArticleListResponse;
import com.sellerops.collect.dto.CommunityArticleView;
import com.sellerops.common.ApiException;
import com.sellerops.community.Cafe24CommunityArticle;
import com.sellerops.community.Cafe24CommunityArticleRepository;
import com.sellerops.community.CommunityReplyStatus;
import com.sellerops.connector.ChannelConnectionStatus;
import com.sellerops.connector.ChannelConnectionStatusRepository;
import com.sellerops.order.OrderService;
import com.sellerops.order.dto.OrderSummaryResponse;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Operator read views over what a connected channel account has collected: a
 * per-account dashboard summary and a drill-down list of collected community
 * articles. Channel-generic by intent — order/sales totals reuse the shared
 * {@link OrderService}; review/inquiry data currently comes from the Cafe24
 * community-article store (the only confirmed source today), behind generic DTOs
 * so other channels slot in without reshaping the UI.
 *
 * <p>The dashboard window is always supplied by the caller — this service never
 * reads a clock — and is interpreted in the channel policy zone ({@link #KST} for
 * Cafe24). The drill-down is metadata only: no article title/content/identifiers
 * leave this layer (see {@link CommunityArticleView}).
 */
@Service
public class ChannelOperationsService {

    /** Cafe24's explicit platform zone; "day" boundaries for the window are KST. */
    static final ZoneId KST = ZoneId.of("Asia/Seoul");
    /** Operator-facing drill-down types mapped to stored source kinds. */
    static final String SOURCE_KIND_REVIEW = "REVIEW";
    static final String SOURCE_KIND_INQUIRY = "PRODUCT_INQUIRY";
    /** Largest drill-down page we serve — guards against a pathological scan. */
    static final int MAX_PAGE_SIZE = 50;

    private final SellerAccountRepository sellerAccounts;
    private final ChannelRepository channels;
    private final ChannelConnectionStatusRepository connectionStatus;
    private final Cafe24CommunityArticleRepository articles;
    private final OrderService orderService;

    public ChannelOperationsService(SellerAccountRepository sellerAccounts, ChannelRepository channels,
                                    ChannelConnectionStatusRepository connectionStatus,
                                    Cafe24CommunityArticleRepository articles, OrderService orderService) {
        this.sellerAccounts = sellerAccounts;
        this.channels = channels;
        this.connectionStatus = connectionStatus;
        this.articles = articles;
        this.orderService = orderService;
    }

    /**
     * Dashboard summary for one account over the closed window [{@code from},
     * {@code to}] (validated here). Order/sales totals are the channel-scoped totals
     * for the window; review/inquiry counts are collected articles whose source date
     * falls in the window; {@code unansweredInquiries} counts only confirmed-PENDING
     * inquiries. Sync state/last success come from the connection-health row.
     */
    @Transactional(readOnly = true)
    public AccountDashboardSummary accountDashboard(UUID orgId, UUID accountId, LocalDate from, LocalDate to) {
        SellerAccount account = requireAccount(orgId, accountId);
        // Reuse the backfill window validator (closed, non-inverted, both bounds present).
        BackfillWindow window = BackfillWindow.of(from, to);
        Instant fromInstant = window.startDate().atStartOfDay(KST).toInstant();
        Instant toExclusive = window.endDate().plusDays(1).atStartOfDay(KST).toInstant();

        OrderSummaryResponse orders = orderService.summary(
                orgId, window.startDate(), window.endDate(), account.getChannelId());

        long newReviews = articles.countInWindow(
                orgId, accountId, SOURCE_KIND_REVIEW, fromInstant, toExclusive);
        long newInquiries = articles.countInWindow(
                orgId, accountId, SOURCE_KIND_INQUIRY, fromInstant, toExclusive);
        long unanswered = articles.countInWindowByReplyStatus(
                orgId, accountId, SOURCE_KIND_INQUIRY,
                CommunityReplyStatus.PENDING.name(), fromInstant, toExclusive);

        ChannelConnectionStatus health = connectionStatus.findBySellerAccountId(accountId).orElse(null);
        return new AccountDashboardSummary(
                accountId,
                account.getChannelId(),
                channelNameKo(account.getChannelId()),
                window.startDate(),
                window.endDate(),
                orders.totalSales7d(),
                orders.totalOrders7d(),
                newReviews,
                newInquiries,
                unanswered,
                health != null ? health.getState() : "NOT_COLLECTED",
                health != null ? health.getLastSuccessAt() : null);
    }

    /**
     * One page of collected articles for an account, filtered to a drill-down type
     * (REVIEW / INQUIRY), most-recently-collected first. Metadata only.
     */
    @Transactional(readOnly = true)
    public ArticleListResponse accountArticles(UUID orgId, UUID accountId, String type, int page, int size) {
        SellerAccount account = requireAccount(orgId, accountId);
        String sourceKind = sourceKindFor(type);
        int safeSize = Math.max(1, Math.min(size, MAX_PAGE_SIZE));
        int safePage = Math.max(0, page);
        String channelNameKo = channelNameKo(account.getChannelId());

        Page<Cafe24CommunityArticle> result =
                articles.findByOrgIdAndSellerAccountIdAndSourceKindOrderByCollectedAtDesc(
                        orgId, accountId, sourceKind, PageRequest.of(safePage, safeSize));
        List<CommunityArticleView> items = result.getContent().stream()
                .map(a -> toView(a, type, channelNameKo))
                .toList();
        return new ArticleListResponse(type, safePage, safeSize, result.getTotalElements(), items);
    }

    private CommunityArticleView toView(Cafe24CommunityArticle a, String type, String channelNameKo) {
        return new CommunityArticleView(
                type,
                channelNameKo,
                a.getRating(),
                a.getReplyStatus(),
                kstDate(a.getSourceCreatedAt()),
                kstDate(a.getCollectedAt()));
    }

    /** Instant → KST calendar date string (date only), or null when unknown. */
    private static String kstDate(Instant instant) {
        return instant == null ? null : instant.atZone(KST).toLocalDate().toString();
    }

    private String channelNameKo(UUID channelId) {
        return channels.findById(channelId).map(Channel::getNameKo).orElse(null);
    }

    /** Map an operator drill-down type to a stored source kind; reject anything else. */
    private static String sourceKindFor(String type) {
        if (type == null) {
            throw ApiException.badRequest("조회할 데이터 유형(type)을 지정해 주세요.");
        }
        return switch (type) {
            case "REVIEW" -> SOURCE_KIND_REVIEW;
            case "INQUIRY" -> SOURCE_KIND_INQUIRY;
            default -> throw ApiException.badRequest("지원되지 않는 데이터 유형입니다: " + type);
        };
    }

    private SellerAccount requireAccount(UUID orgId, UUID accountId) {
        // Org scoping at the query boundary — a cross-org id reads as absent.
        return sellerAccounts.findByIdAndOrgId(accountId, orgId)
                .orElseThrow(() -> ApiException.notFound("판매 계정을 찾을 수 없습니다."));
    }
}
