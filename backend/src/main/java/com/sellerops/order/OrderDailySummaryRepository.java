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
}
