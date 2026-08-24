package com.sellerops.dashboard.metrics;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

/**
 * The per-(channel × day) reads the Overview dashboard is built from.
 *
 * <p><b>Native, and therefore explicit about synthetic rows.</b> Hibernate's auto-enabled
 * {@code realDataOnly} filter does not touch a native query, so every statement here repeats its
 * condition verbatim ({@code :syntheticVisible = true or data_origin = 'REAL'}) rather than relying
 * on a mechanism that is not in play. Forgetting it would put DEMO_SEED rows — this org holds 25
 * seeded orders and 30 seeded reviews — into a KPI a seller reads as their own.
 *
 * <p><b>The day is a KST calendar day, not a UTC one.</b> A 09:00 KST order is a 00:00 UTC order,
 * and bucketing by UTC would move a working morning onto the previous day for every channel. The
 * order summaries already carry a KST {@code summary_date} decided by the connector; the inquiry and
 * review reads convert their instants to the same zone so all three series share one calendar.
 *
 * <p><b>Zero days are not rows.</b> These queries return only days that happened; the caller fills the
 * gaps, because a missing row and a measured zero are the same shape here and only the caller knows
 * which channels were even able to report.
 */
@Repository
public interface OperationsMetricsRepository
        extends org.springframework.data.repository.Repository<com.sellerops.order.OrderDailySummary, UUID> {

    /** {@code [channelId, day, orderCount, salesAmount]} per KST day in range. */
    @Query(value = """
            select o.channel_id, o.summary_date, sum(o.order_count), sum(o.sales_amount)
            from order_daily_summaries o
            where o.org_id = :orgId and o.summary_date between :from and :to
              and (:syntheticVisible = true or o.data_origin = 'REAL')
            group by o.channel_id, o.summary_date
            """, nativeQuery = true)
    List<Object[]> orderSeries(@Param("orgId") UUID orgId, @Param("from") LocalDate from,
                               @Param("to") LocalDate to,
                               @Param("syntheticVisible") boolean syntheticVisible);

    /**
     * {@code [channelId, day, received, stillUnanswered]} per KST receipt day in range.
     *
     * <p>The second column is deliberately "받은 날 기준으로 아직 미답변인 것", not a historical
     * backlog reconstruction: this table holds one current status per inquiry, so any other reading
     * would be invented. The label on screen has to say so.
     *
     * <p>Dismissed inquiries are out ({@code operational_state = 'ACTIVE'}) — the same corpus the
     * inbox counts, so the chart and the queue cannot disagree.
     */
    @Query(value = """
            select q.channel_id,
                   (q.received_at at time zone 'Asia/Seoul')::date as day,
                   count(*),
                   count(*) filter (where q.status = 'UNANSWERED')
            from inquiries q
            where q.org_id = :orgId
              and q.operational_state = 'ACTIVE'
              and (q.received_at at time zone 'Asia/Seoul')::date between :from and :to
              and (:syntheticVisible = true or q.data_origin = 'REAL')
            group by q.channel_id, day
            """, nativeQuery = true)
    List<Object[]> inquirySeries(@Param("orgId") UUID orgId, @Param("from") LocalDate from,
                                 @Param("to") LocalDate to,
                                 @Param("syntheticVisible") boolean syntheticVisible);

    /** {@code [channelId, day, received, negative]} per KST receipt day in range. */
    @Query(value = """
            select r.channel_id,
                   (r.received_at at time zone 'Asia/Seoul')::date as day,
                   count(*),
                   count(*) filter (where r.is_negative)
            from reviews r
            where r.org_id = :orgId
              and (r.received_at at time zone 'Asia/Seoul')::date between :from and :to
              and (:syntheticVisible = true or r.data_origin = 'REAL')
            group by r.channel_id, day
            """, nativeQuery = true)
    List<Object[]> reviewSeries(@Param("orgId") UUID orgId, @Param("from") LocalDate from,
                                @Param("to") LocalDate to,
                                @Param("syntheticVisible") boolean syntheticVisible);
}
