package com.sellerops.order;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface OrderDailySummaryRepository extends JpaRepository<OrderDailySummary, UUID> {
    List<OrderDailySummary> findAllByOrgIdAndSummaryDateBetweenOrderBySummaryDateAsc(
            UUID orgId, LocalDate from, LocalDate to);

    List<OrderDailySummary> findAllByOrgIdAndChannelIdAndSummaryDateBetweenOrderBySummaryDateAsc(
            UUID orgId, UUID channelId, LocalDate from, LocalDate to);

    List<OrderDailySummary> findAllByOrgIdAndSummaryDate(UUID orgId, LocalDate date);

    Optional<OrderDailySummary> findByOrgIdAndChannelIdAndSummaryDate(
            UUID orgId, UUID channelId, LocalDate summaryDate);

    /**
     * Per-channel order totals and the newest day held — {@code [channelId, sum(orderCount), max(date)]}.
     *
     * <b>This table, not {@code channel_orders}, is what ORDER_SUMMARY coverage is about.</b> The two
     * stores are filled by different connectors: NAVER and Coupang write per-order rows AND daily
     * summaries, Cafe24 writes only the summary its aggregator produces. Reading coverage off the
     * per-order table therefore reported {@code CAFE24 ORDER_SUMMARY = ZERO} — a measured zero, the one
     * state that licenses "없습니다" — over ₩308,082 of real Cafe24 orders the dashboard was showing on
     * the same screen. The data type is named ORDER_SUMMARY; its rows live here.
     */
    @org.springframework.data.jpa.repository.Query(
            "select o.channelId, sum(o.orderCount), max(o.summaryDate) from OrderDailySummary o "
            + "where o.orgId = :orgId group by o.channelId")
    List<Object[]> countByChannel(@org.springframework.data.repository.query.Param("orgId") UUID orgId);
}
