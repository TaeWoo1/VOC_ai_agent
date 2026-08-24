package com.sellerops.order;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ChannelOrderRepository extends JpaRepository<ChannelOrder, UUID> {

    /** Identity lookup — scoped by org AND account so a row can never be matched across the boundary. */
    Optional<ChannelOrder> findByOrgIdAndSellerAccountIdAndExternalOrderId(
            UUID orgId, UUID sellerAccountId, String externalOrderId);

    boolean existsByOrgIdAndSellerAccountIdAndExternalOrderId(
            UUID orgId, UUID sellerAccountId, String externalOrderId);

    List<ChannelOrder> findAllByOrgIdAndSellerAccountId(UUID orgId, UUID sellerAccountId);

    List<ChannelOrder> findAllByOrgIdAndChannelIdAndSummaryDate(
            UUID orgId, UUID channelId, LocalDate summaryDate);

    /** Per-channel order counts and the newest summary date — {@code [channelId, count, max(summaryDate)]}. */
    @org.springframework.data.jpa.repository.Query(
            "select o.channelId, count(o), max(o.summaryDate) from ChannelOrder o "
            + "where o.orgId = :orgId group by o.channelId")
    List<Object[]> countByChannel(@org.springframework.data.repository.query.Param("orgId") UUID orgId);
}
