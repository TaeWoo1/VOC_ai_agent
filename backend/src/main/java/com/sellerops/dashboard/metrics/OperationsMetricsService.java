package com.sellerops.dashboard.metrics;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.common.ApiException;
import com.sellerops.common.SyntheticDataVisibility;
import com.sellerops.coverage.ChannelCoverageService;
import com.sellerops.coverage.ChannelDataState;
import com.sellerops.coverage.dto.ChannelCoverageRow;
import com.sellerops.dashboard.metrics.dto.ChannelMetricRow;
import com.sellerops.dashboard.metrics.dto.MetricExclusion;
import com.sellerops.dashboard.metrics.dto.MetricKpi;
import com.sellerops.dashboard.metrics.dto.MetricPeriod;
import com.sellerops.dashboard.metrics.dto.MetricPoint;
import com.sellerops.dashboard.metrics.dto.MetricSeries;
import com.sellerops.dashboard.metrics.dto.OperationsMetricsResponse;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The Overview dashboard's numbers — six KPIs, six daily series, one channel breakdown.
 *
 * <p><b>This service decides what may be counted; the screen only draws.</b> The rule that keeps a
 * blocked channel out of a total is one sentence in one method ({@link #counted}), because the
 * alternative — a frontend deciding per chart whether a zero is real — is how "네이버 문의 0건"
 * gets printed by a component nobody reviewed for that.
 *
 * <p><b>Coverage is consulted before arithmetic, not after.</b> Every total is assembled from the
 * channels that could actually report in this window, and every channel left out is named in
 * {@link OperationsMetricsResponse#exclusions()}. A channel's own row still carries whatever rows we
 * hold for it — being excluded from a total never erases data.
 */
@Service
public class OperationsMetricsService {

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");

    /** The comparison the product promises. Longer windows are allowed; this is the default. */
    static final int DEFAULT_DAYS = 7;
    /** A guard, not a product statement: beyond this the daily series stops being a readable chart. */
    static final int MAX_DAYS = 90;

    /**
     * What the revenue figure IS. Shipped with every response so no screen has to paraphrase it.
     *
     * <p>Derived from the three connectors' own mapping comments, not from a preference:
     * {@code NaverOrdersClient} ("initialPaymentAmount — the post-discount payment at order time",
     * {@code remainPaymentAmount} deliberately unused), {@code CoupangOrdersClient} (sum of
     * {@code orderItem.orderPrice}), {@code Cafe24OrderAggregator} ({@code payment_amount} per
     * distinct order id). None of the three subtracts a later cancellation or return.
     */
    static final String REVENUE_BASIS =
            "결제 시점 기준 결제금액 합계입니다. 취소·반품은 차감되지 않았고, 채널마다 금액 산정 기준이 조금씩 다릅니다.";

    /**
     * What the order COUNT is — and the warning that the three channels do not count the same thing.
     *
     * <p>NAVER counts 상품주문 rows, Coupang counts shipment boxes, Cafe24 counts distinct order ids.
     * Summing them yields a number whose unit changes per channel, so the total is labelled rather
     * than silently added up under one noun.
     */
    static final String ORDER_COUNT_BASIS =
            "채널마다 세는 단위가 다릅니다 — 네이버는 상품주문, 쿠팡은 배송건, 카페24는 주문 기준입니다.";

    private final ChannelRepository channels;
    private final ChannelCoverageService coverage;
    private final OperationsMetricsRepository metrics;

    public OperationsMetricsService(ChannelRepository channels, ChannelCoverageService coverage,
                                    OperationsMetricsRepository metrics) {
        this.channels = channels;
        this.coverage = coverage;
        this.metrics = metrics;
    }

    @Transactional(readOnly = true)
    public OperationsMetricsResponse metrics(UUID orgId, List<String> visibleChannelCodes, Integer days) {
        int window = days == null ? DEFAULT_DAYS : days;
        if (window < 1 || window > MAX_DAYS) {
            throw ApiException.badRequest("days must be between 1 and " + MAX_DAYS);
        }
        LocalDate to = LocalDate.now(KST);
        LocalDate from = to.minusDays(window - 1L);
        LocalDate previousTo = from.minusDays(1);
        LocalDate previousFrom = previousTo.minusDays(window - 1L);

        Map<UUID, Channel> byId = new LinkedHashMap<>();
        for (Channel channel : channels.findAll()) {
            if (visibleChannelCodes.contains(channel.getCode())) {
                byId.put(channel.getId(), channel);
            }
        }
        Map<String, ChannelDataState> states = new HashMap<>();
        Map<String, ChannelCoverageRow> coverageRows = new HashMap<>();
        for (ChannelCoverageRow row : coverage.coverage(orgId, visibleChannelCodes)) {
            states.put(key(row.channelCode(), row.dataType()), row.state());
            coverageRows.put(key(row.channelCode(), row.dataType()), row);
        }

        boolean synthetic = SyntheticDataVisibility.syntheticVisible();
        Window current = read(orgId, from, to, synthetic);
        Window previous = read(orgId, previousFrom, previousTo, synthetic);

        List<ChannelMetricRow> channelRows = new ArrayList<>();
        List<MetricExclusion> exclusions = new ArrayList<>();
        Totals totals = new Totals();
        Totals priorTotals = new Totals();

        for (Channel channel : byId.values()) {
            UUID id = channel.getId();
            String code = channel.getCode();
            ChannelDataState orderState = states.getOrDefault(key(code, "ORDER_SUMMARY"), ChannelDataState.NOT_CONNECTED);
            ChannelDataState inquiryState = states.getOrDefault(key(code, "INQUIRY"), ChannelDataState.NOT_CONNECTED);
            ChannelDataState reviewState = states.getOrDefault(key(code, "REVIEW"), ChannelDataState.NOT_CONNECTED);

            long[] order = current.orders.getOrDefault(id, new long[2]);
            long[] inquiry = current.inquiries.getOrDefault(id, new long[2]);
            long[] review = current.reviews.getOrDefault(id, new long[2]);

            boolean countOrders = counted(orderState, order[0] + order[1]);
            boolean countInquiries = counted(inquiryState, inquiry[0]);
            boolean countReviews = counted(reviewState, review[0]);

            channelRows.add(new ChannelMetricRow(code, channel.getNameKo(),
                    orderState, order[1], order[0], countOrders,
                    inquiryState, inquiry[0], unansweredNow(coverageRows, code), countInquiries,
                    reviewState, review[0], review[1], countReviews));

            accumulate(totals, countOrders, countInquiries, countReviews, order, inquiry, review);
            accumulate(priorTotals, countOrders, countInquiries, countReviews,
                    previous.orders.getOrDefault(id, new long[2]),
                    previous.inquiries.getOrDefault(id, new long[2]),
                    previous.reviews.getOrDefault(id, new long[2]));

            if (!countOrders) {
                exclusions.add(exclusion(code, channel.getNameKo(), "ORDER_SUMMARY", orderState));
            }
            if (!countInquiries) {
                exclusions.add(exclusion(code, channel.getNameKo(), "INQUIRY", inquiryState));
            }
            if (!countReviews) {
                exclusions.add(exclusion(code, channel.getNameKo(), "REVIEW", reviewState));
            }
        }

        long unansweredNow = channelRows.stream()
                .filter(ChannelMetricRow::countedInInquiries)
                .mapToLong(ChannelMetricRow::unansweredInquiries)
                .sum();

        List<MetricKpi> kpis = List.of(
                kpi("revenue", "매출", totals.revenue, "원", priorTotals.revenue, true,
                        excludedCount(exclusions, "ORDER_SUMMARY"), unproven(channelRows, "ORDER_SUMMARY")),
                kpi("orders", "주문", totals.orders, "건", priorTotals.orders, true,
                        excludedCount(exclusions, "ORDER_SUMMARY"), unproven(channelRows, "ORDER_SUMMARY")),
                kpi("inquiries", "문의", totals.inquiries, "건", priorTotals.inquiries, true,
                        excludedCount(exclusions, "INQUIRY"), unproven(channelRows, "INQUIRY")),
                // Not comparable, and the flag is the whole point: this is today's backlog, not a flow.
                kpi("unansweredInquiries", "미답변 문의", unansweredNow, "건", null, false,
                        excludedCount(exclusions, "INQUIRY"), unproven(channelRows, "INQUIRY")),
                kpi("reviews", "리뷰", totals.reviews, "건", priorTotals.reviews, true,
                        excludedCount(exclusions, "REVIEW"), unproven(channelRows, "REVIEW")),
                kpi("negativeReviews", "부정 리뷰", totals.negativeReviews, "건", priorTotals.negativeReviews, true,
                        excludedCount(exclusions, "REVIEW"), unproven(channelRows, "REVIEW")));

        List<MetricSeries> series = List.of(
                series("revenue", "매출", "원", current.dailyRevenue, from, to),
                series("orders", "주문", "건", current.dailyOrders, from, to),
                series("inquiries", "문의", "건", current.dailyInquiries, from, to),
                series("unansweredInquiries", "그중 아직 미답변", "건", current.dailyUnanswered, from, to),
                series("reviews", "리뷰", "건", current.dailyReviews, from, to),
                series("negativeReviews", "그중 부정", "건", current.dailyNegative, from, to));

        return new OperationsMetricsResponse(
                new MetricPeriod(from, to, previousFrom, previousTo, window),
                REVENUE_BASIS, ORDER_COUNT_BASIS, kpis, series, channelRows, exclusions);
    }

    /**
     * Whether this channel's contribution belongs inside a headline total.
     *
     * <p>Two ways to qualify, and no third. Either collection is provably current for this type — so a
     * zero from it is a MEASURED zero — or the channel actually contributed rows we hold, in which
     * case leaving them out would understate a real figure. A channel that is merely silent
     * (disconnected, blocked, unsupported, or armed-but-unproven with nothing in the window) is
     * excluded and named, never quietly added as a zero.
     */
    static boolean counted(ChannelDataState state, long rowsInWindow) {
        return state == ChannelDataState.OBSERVED_FRESH || state == ChannelDataState.ZERO
                || rowsInWindow > 0;
    }

    private static long unansweredNow(Map<String, ChannelCoverageRow> rows, String code) {
        ChannelCoverageRow row = rows.get(key(code, "INQUIRY"));
        return row == null || row.openRows() == null ? 0L : row.openRows();
    }

    private static void accumulate(Totals totals, boolean orders, boolean inquiries, boolean reviews,
                                   long[] order, long[] inquiry, long[] review) {
        if (orders) {
            totals.orders += order[0];
            totals.revenue += order[1];
        }
        if (inquiries) {
            totals.inquiries += inquiry[0];
        }
        if (reviews) {
            totals.reviews += review[0];
            totals.negativeReviews += review[1];
        }
    }

    private static int excludedCount(List<MetricExclusion> exclusions, String dataType) {
        return (int) exclusions.stream().filter(e -> e.dataType().equals(dataType)).count();
    }

    /** True when a counted channel's collection is not provably current — the total needs a caveat. */
    private static boolean unproven(List<ChannelMetricRow> rows, String dataType) {
        return rows.stream().anyMatch(row -> switch (dataType) {
            case "ORDER_SUMMARY" -> row.countedInOrders() && row.orderState() != ChannelDataState.OBSERVED_FRESH
                    && row.orderState() != ChannelDataState.ZERO;
            case "INQUIRY" -> row.countedInInquiries() && row.inquiryState() != ChannelDataState.OBSERVED_FRESH
                    && row.inquiryState() != ChannelDataState.ZERO;
            default -> row.countedInReviews() && row.reviewState() != ChannelDataState.OBSERVED_FRESH
                    && row.reviewState() != ChannelDataState.ZERO;
        });
    }

    private static MetricExclusion exclusion(String code, String nameKo, String dataType,
                                             ChannelDataState state) {
        String reason = switch (state) {
            case NOT_CONNECTED -> "연결되어 있지 않습니다";
            case BLOCKED -> "연결이 끊겨 수집이 멈췄습니다";
            case NOT_SUPPORTED -> "이 채널에는 자동 수집 경로가 없습니다";
            case OBSERVED_FRESHNESS_UNPROVEN -> "최근 자동 수집이 성공하지 못해 이 기간을 확인하지 못했습니다";
            // OBSERVED_FRESH / ZERO are always counted, so reaching here would be a bug, not a state.
            default -> "이 기간의 수집 결과를 확인하지 못했습니다";
        };
        return new MetricExclusion(code, nameKo, dataType, state, reason);
    }

    private static MetricKpi kpi(String key, String label, long value, String unit, Long previous,
                                 boolean comparable, int excluded, boolean freshnessUnproven) {
        Integer delta = null;
        if (comparable && previous != null && previous != 0L) {
            delta = (int) Math.round((value - previous) * 100.0 / previous);
        }
        return new MetricKpi(key, label, value, unit, comparable ? previous : null, delta, comparable,
                excluded, freshnessUnproven);
    }

    private static MetricSeries series(String key, String label, String unit, Map<LocalDate, Long> daily,
                                       LocalDate from, LocalDate to) {
        List<MetricPoint> points = new ArrayList<>();
        for (LocalDate d = from; !d.isAfter(to); d = d.plusDays(1)) {
            points.add(new MetricPoint(d, daily.getOrDefault(d, 0L)));
        }
        return new MetricSeries(key, label, unit, points);
    }

    private Window read(UUID orgId, LocalDate from, LocalDate to, boolean synthetic) {
        Window window = new Window();
        for (Object[] row : metrics.orderSeries(orgId, from, to, synthetic)) {
            UUID channelId = (UUID) row[0];
            LocalDate day = day(row[1]);
            long count = ((Number) row[2]).longValue();
            long amount = ((Number) row[3]).longValue();
            long[] cell = window.orders.computeIfAbsent(channelId, k -> new long[2]);
            cell[0] += count;
            cell[1] += amount;
            window.dailyOrders.merge(day, count, Long::sum);
            window.dailyRevenue.merge(day, amount, Long::sum);
        }
        for (Object[] row : metrics.inquirySeries(orgId, from, to, synthetic)) {
            UUID channelId = (UUID) row[0];
            LocalDate day = day(row[1]);
            long received = ((Number) row[2]).longValue();
            long unanswered = ((Number) row[3]).longValue();
            long[] cell = window.inquiries.computeIfAbsent(channelId, k -> new long[2]);
            cell[0] += received;
            cell[1] += unanswered;
            window.dailyInquiries.merge(day, received, Long::sum);
            window.dailyUnanswered.merge(day, unanswered, Long::sum);
        }
        for (Object[] row : metrics.reviewSeries(orgId, from, to, synthetic)) {
            UUID channelId = (UUID) row[0];
            LocalDate day = day(row[1]);
            long received = ((Number) row[2]).longValue();
            long negative = ((Number) row[3]).longValue();
            long[] cell = window.reviews.computeIfAbsent(channelId, k -> new long[2]);
            cell[0] += received;
            cell[1] += negative;
            window.dailyReviews.merge(day, received, Long::sum);
            window.dailyNegative.merge(day, negative, Long::sum);
        }
        return window;
    }

    /**
     * The day column, whichever shape the driver hands back.
     *
     * <p>A native {@code date} arrives as {@code java.sql.Date} on the current JDBC driver and as a
     * {@code LocalDate} on others; a cast to one of them is a runtime failure waiting for a driver
     * upgrade, and this read is the whole dashboard.
     */
    private static LocalDate day(Object value) {
        if (value instanceof LocalDate localDate) {
            return localDate;
        }
        if (value instanceof java.sql.Date sqlDate) {
            return sqlDate.toLocalDate();
        }
        throw new IllegalStateException("집계 날짜 형식을 해석할 수 없습니다: " + value.getClass());
    }

    private static String key(String channelCode, String dataType) {
        return channelCode + "|" + dataType;
    }

    /** One window's reads, per channel and per day. */
    private static final class Window {
        final Map<UUID, long[]> orders = new HashMap<>();      // [count, amount]
        final Map<UUID, long[]> inquiries = new HashMap<>();   // [received, unanswered]
        final Map<UUID, long[]> reviews = new HashMap<>();     // [received, negative]
        final Map<LocalDate, Long> dailyOrders = new HashMap<>();
        final Map<LocalDate, Long> dailyRevenue = new HashMap<>();
        final Map<LocalDate, Long> dailyInquiries = new HashMap<>();
        final Map<LocalDate, Long> dailyUnanswered = new HashMap<>();
        final Map<LocalDate, Long> dailyReviews = new HashMap<>();
        final Map<LocalDate, Long> dailyNegative = new HashMap<>();
    }

    private static final class Totals {
        long revenue;
        long orders;
        long inquiries;
        long reviews;
        long negativeReviews;
    }
}
