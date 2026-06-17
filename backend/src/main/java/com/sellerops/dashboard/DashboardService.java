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
import java.util.ArrayList;
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
                inquiries.countByOrgIdAndReceivedAtAfter(orgId, since),
                unanswered,
                reviews.countByOrgIdAndReceivedAtAfter(orgId, since),
                negative,
                unanswered + negative,
                unanswered);

        OrderSummaryResponse orderSummary = orderService.summary(orgId);

        return new DashboardSummaryResponse(
                cards,
                buildTodoItems(unanswered, negative),
                buildTopProductIssues(orgId),
                inboxService.recentFeed(orgId, 8),
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

    private List<TopProductIssue> buildTopProductIssues(UUID orgId) {
        Map<UUID, String> productNames = products.findAllByOrgId(orgId).stream()
                .collect(Collectors.toMap(Product::getId, Product::getName, (a, b) -> a));
        Map<UUID, Long> negativeByProduct = reviews.findAllByOrgId(orgId).stream()
                .filter(Review::isNegative)
                .filter(r -> r.getProductId() != null)
                .collect(Collectors.groupingBy(Review::getProductId, Collectors.counting()));

        return negativeByProduct.entrySet().stream()
                .sorted(Map.Entry.<UUID, Long>comparingByValue().reversed())
                .limit(5)
                .map(e -> new TopProductIssue(
                        productNames.getOrDefault(e.getKey(), "-"), "부정 리뷰", e.getValue()))
                .toList();
    }
}
