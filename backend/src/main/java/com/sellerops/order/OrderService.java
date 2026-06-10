package com.sellerops.order;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.order.dto.ChannelSalesShare;
import com.sellerops.order.dto.OrderSummaryResponse;
import com.sellerops.order.dto.SalesTrendPoint;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class OrderService {

    private static final int WINDOW_DAYS = 7;

    private final OrderDailySummaryRepository orders;
    private final ChannelRepository channels;

    public OrderService(OrderDailySummaryRepository orders, ChannelRepository channels) {
        this.orders = orders;
        this.channels = channels;
    }

    @Transactional(readOnly = true)
    public OrderSummaryResponse summary(UUID orgId) {
        LocalDate today = LocalDate.now();
        LocalDate from = today.minusDays(WINDOW_DAYS - 1L);
        List<OrderDailySummary> rows =
                orders.findAllByOrgIdAndSummaryDateGreaterThanEqualOrderBySummaryDateAsc(orgId, from);

        List<SalesTrendPoint> trend = buildTrend(rows, from, today);
        List<ChannelSalesShare> share = buildChannelShare(rows);

        long totalOrders = trend.stream().mapToLong(SalesTrendPoint::orderCount).sum();
        long totalSales = trend.stream().mapToLong(SalesTrendPoint::salesAmount).sum();
        return new OrderSummaryResponse(totalOrders, totalSales, trend, share);
    }

    private List<SalesTrendPoint> buildTrend(List<OrderDailySummary> rows, LocalDate from, LocalDate to) {
        Map<LocalDate, long[]> agg = new LinkedHashMap<>(); // date -> [orderCount, salesAmount]
        for (LocalDate d = from; !d.isAfter(to); d = d.plusDays(1)) {
            agg.put(d, new long[]{0L, 0L});
        }
        for (OrderDailySummary row : rows) {
            long[] cell = agg.get(row.getSummaryDate());
            if (cell != null) {
                cell[0] += row.getOrderCount();
                cell[1] += row.getSalesAmount();
            }
        }
        List<SalesTrendPoint> trend = new ArrayList<>();
        agg.forEach((date, cell) -> trend.add(new SalesTrendPoint(date, (int) cell[0], cell[1])));
        return trend;
    }

    private List<ChannelSalesShare> buildChannelShare(List<OrderDailySummary> rows) {
        Map<UUID, String> names = channels.findAll().stream()
                .collect(Collectors.toMap(Channel::getId, Channel::getNameKo, (a, b) -> a));
        Map<UUID, Long> byChannel = rows.stream().collect(Collectors.groupingBy(
                OrderDailySummary::getChannelId,
                Collectors.summingLong(OrderDailySummary::getSalesAmount)));
        long total = byChannel.values().stream().mapToLong(Long::longValue).sum();

        return byChannel.entrySet().stream()
                .sorted(Map.Entry.<UUID, Long>comparingByValue().reversed())
                .map(e -> new ChannelSalesShare(
                        names.getOrDefault(e.getKey(), "기타"),
                        e.getValue(),
                        total == 0 ? 0 : (int) Math.round(e.getValue() * 100.0 / total)))
                .toList();
    }
}
