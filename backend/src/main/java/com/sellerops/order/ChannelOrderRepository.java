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

    /**
     * The exact order this inquiry's reference names, matched on EITHER identifier space.
     *
     * <p>Two spaces because channels name orders twice. NAVER's inquiry resource returns a required
     * {@code orderId} (the payment unit, stored here as {@code parentOrderId}) and an optional
     * {@code productOrderIdList} (the per-line unit, stored as {@code externalOrderId}); Cafe24's
     * board article carries only the payment-unit {@code order_id}. A join written against one column
     * silently answers "not found" for every source that names the other.
     *
     * <p>Ordered so a payment-unit reference that spans several lines resolves the same way twice —
     * the caller refuses a multi-row match rather than picking from it, and a stable order is what
     * makes that refusal reproducible rather than racy.
     */
    @org.springframework.data.jpa.repository.Query(
            "select o from ChannelOrder o where o.orgId = :orgId and o.sellerAccountId = :accountId "
            + "and (o.externalOrderId = :ref or o.parentOrderId = :ref) "
            + "order by o.externalOrderId asc")
    List<ChannelOrder> findAllByReference(
            @org.springframework.data.repository.query.Param("orgId") UUID orgId,
            @org.springframework.data.repository.query.Param("accountId") UUID accountId,
            @org.springframework.data.repository.query.Param("ref") String reference);

    /** Per-channel order counts and the newest summary date — {@code [channelId, count, max(summaryDate)]}. */
    @org.springframework.data.jpa.repository.Query(
            "select o.channelId, count(o), max(o.summaryDate) from ChannelOrder o "
            + "where o.orgId = :orgId group by o.channelId")
    List<Object[]> countByChannel(@org.springframework.data.repository.query.Param("orgId") UUID orgId);
}
