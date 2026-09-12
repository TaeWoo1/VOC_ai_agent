package com.sellerops.dashboard;

import com.sellerops.dashboard.dto.DashboardCards;
import com.sellerops.dashboard.dto.DashboardSummaryResponse;
import com.sellerops.dashboard.dto.TopProductIssue;
import com.sellerops.inbox.InboxService;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.order.OrderDailySummaryRepository;
import com.sellerops.order.OrderService;
import com.sellerops.order.dto.OrderSummaryResponse;
import com.sellerops.product.Product;
import com.sellerops.product.ProductRepository;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewRepository;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class DashboardService {

    private final InquiryRepository inquiries;
    private final ReviewRepository reviews;
    private final OrderDailySummaryRepository orders;
    private final ProductRepository products;
    private final OrderService orderService;
    private final InboxService inboxService;

    public DashboardService(InquiryRepository inquiries, ReviewRepository reviews,
                            OrderDailySummaryRepository orders, ProductRepository products,
                            OrderService orderService, InboxService inboxService) {
        this.inquiries = inquiries;
        this.reviews = reviews;
        this.orders = orders;
        this.products = products;
        this.orderService = orderService;
        this.inboxService = inboxService;
    }

    @Transactional(readOnly = true)
    public DashboardSummaryResponse summary(UUID orgId) {
        Instant since = Instant.now().minus(Duration.ofHours(24));
        LocalDate today = LocalDate.now();

        // 미답변 문의 counts the seller's WORKLOAD, so a 비밀글 counts: it is an inquiry someone has
        // to answer, and being secret says who may READ it, not whether it is work. This card used to
        // subtract them and published the result under the same name the overview KPI uses for the
        // whole corpus — two numbers, one label, and no way for a seller to tell which was wrong.
        // Inquiries the seller dismissed and rows excluded as source thread replies are still out:
        // the repository's ACTIVE predicate carries that, so 홈, Today Inbox, the report and the
        // Operator all count the same corpus.
        long unanswered = inquiries.countByOrgIdAndStatus(orgId, "UNANSWERED");
        long negative = reviews.countByOrgIdAndNegativeTrue(orgId);

        int todayOrders = 0;
        long todaySales = 0;
        for (var row : orders.findAllByOrgIdAndSummaryDate(orgId, today)) {
            todayOrders += row.getOrderCount();
            todaySales += row.getSalesAmount();
        }

        DashboardCards cards = new DashboardCards(
                todayOrders,
                todaySales,
                // Same reason as 미답변 above: a 비밀글 that arrived today is work that arrived today.
                inquiries.countByOrgIdAndReceivedAtAfter(orgId, since),
                unanswered,
                reviews.countByOrgIdAndReceivedAtAfter(orgId, since),
                negative);

        OrderSummaryResponse orderSummary = orderService.summary(orgId);

        return new DashboardSummaryResponse(
                cards,
                buildTodoItems(unanswered, negative),
                buildTopProductIssues(orgId),
                inboxService.recentFeed(orgId, 8, false),
                orderSummary.trend(),
                orderSummary.channelShare());
    }

    private List<String> buildTodoItems(long unanswered, long negative) {
        List<String> items = new ArrayList<>();
        if (unanswered > 0) {
            items.add("미답변 문의 " + unanswered + "건을 확인하세요.");
        }
        if (negative > 0) {
            items.add("부정 리뷰 " + negative + "건을 확인하세요.");
        }
        if (items.isEmpty()) {
            items.add("오늘 급히 확인할 일이 없습니다.");
        }
        return items;
    }

    /**
     * The negative-review roll-up, unchanged in what it counts.
     *
     * <p>Same corpus (every review this org holds that the read filters admit), same predicate
     * ({@link Review#isNegative()}), same grouping key (the canonical {@code product_id}), same
     * order and same top-5 cap as before. What is added is what the rows already knew and the DTO
     * dropped: the canonical id, and the span of the very rows being counted.
     *
     * <p>Reviews with no product link are excluded rather than grouped under a null key — a gap in
     * product mapping is not a product, the same rule {@code ProductEvidenceCount} states for issue
     * evidence.
     */
    /**
     * Public so the Overview's insights can rest on the SAME roll-up the summary card shows.
     *
     * <p>A second implementation of "which product has the most negative reviews" is a second answer,
     * and the two would diverge the first time either grouping key changed.
     */
    @Transactional(readOnly = true)
    public List<TopProductIssue> topProductIssues(UUID orgId) {
        return buildTopProductIssues(orgId);
    }

    private List<TopProductIssue> buildTopProductIssues(UUID orgId) {
        Map<UUID, String> productNames = products.findAllByOrgId(orgId).stream()
                .collect(Collectors.toMap(Product::getId, Product::getName, (a, b) -> a));
        /*
         * REAL only (Chat-first Agent Shell Completion v1 §3-C).
         *
         * This list becomes 「{상품} 부정 리뷰 N건」 — a sentence the home briefing states as a fact
         * about the seller's shop, with a date range attached. N is a count of review ROWS, so a
         * seeded row lands inside it, and on this deployment eleven of them do. The rule the previous
         * package wrote for the unanswered count is the same rule here: a manufactured row may appear
         * in a chart of what the shop did, never in a number that tells the seller they have a
         * problem. The dashboard's other reads are untouched — this narrows one insight's corpus, not
         * the review screens or the issue extractor's evidence.
         */
        Map<UUID, List<Review>> negativeByProduct = reviews.findAllByOrgId(orgId).stream()
                .filter(r -> r.getDataOrigin() == com.sellerops.common.DataOrigin.REAL)
                .filter(Review::isNegative)
                .filter(r -> r.getProductId() != null)
                .collect(Collectors.groupingBy(Review::getProductId));

        return negativeByProduct.entrySet().stream()
                .sorted(Comparator.<Map.Entry<UUID, List<Review>>>comparingInt(
                        e -> e.getValue().size()).reversed())
                .limit(5)
                .map(e -> new TopProductIssue(
                        e.getKey(),
                        // Null, not "-": the catalogue either holds a name for this id or it does not.
                        productNames.get(e.getKey()),
                        "부정 리뷰",
                        e.getValue().size(),
                        e.getValue().stream().map(DashboardService::receivedOn)
                                .min(Comparator.naturalOrder()).orElse(null),
                        e.getValue().stream().map(DashboardService::receivedOn)
                                .max(Comparator.naturalOrder()).orElse(null)))
                .toList();
    }

    /**
     * The calendar date a review was received.
     *
     * <p>UTC, because that is the zone the ingest wrote the value in — {@code DateParse
     * .instantAtStartOfDay} pins the channel's calendar date to UTC midnight, so reading it back in
     * UTC recovers that exact date and reading it in another zone would shift some rows by a day.
     * Same rule as {@code ReviewIssueExtractionService.occurredOn}, so the negative roll-up and the
     * issue evidence date the same review identically.
     */
    private static LocalDate receivedOn(Review review) {
        return review.getReceivedAt().atOffset(ZoneOffset.UTC).toLocalDate();
    }
}
