package com.sellerops.order;

import com.sellerops.common.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.LocalDate;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

/** One row per (org, channel, day): order count + sales total. */
@Getter
@Setter
@Entity
@Table(name = "order_daily_summaries")
public class OrderDailySummary extends BaseEntity {

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    @Column(name = "channel_id", nullable = false)
    private UUID channelId;

    @Column(name = "summary_date", nullable = false)
    private LocalDate summaryDate;

    @Column(name = "order_count", nullable = false)
    private int orderCount;

    @Column(name = "sales_amount", nullable = false)
    private long salesAmount;
}
