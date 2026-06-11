package com.sellerops.order;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface OrderDailySummaryRepository extends JpaRepository<OrderDailySummary, UUID> {
    List<OrderDailySummary> findAllByOrgIdAndSummaryDateGreaterThanEqualOrderBySummaryDateAsc(
            UUID orgId, LocalDate from);

    List<OrderDailySummary> findAllByOrgIdAndSummaryDate(UUID orgId, LocalDate date);

    Optional<OrderDailySummary> findByOrgIdAndChannelIdAndSummaryDate(
            UUID orgId, UUID channelId, LocalDate summaryDate);
}
