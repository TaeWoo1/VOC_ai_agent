package com.sellerops.order;

import com.sellerops.common.BaseEntity;
import com.sellerops.common.DataOrigin;
import com.sellerops.common.RealDataOnly;
import jakarta.persistence.Column;
import jakarta.persistence.Enumerated;
import jakarta.persistence.EnumType;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import org.hibernate.annotations.Filter;
import java.time.LocalDate;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

/** One row per (org, channel, day): order count + sales total. */
@Getter
@Setter
@Entity
@Table(name = "order_daily_summaries")
@Filter(name = RealDataOnly.NAME, condition = RealDataOnly.CONDITION)
public class OrderDailySummary extends BaseEntity {
    /**
     * Whether this row is the seller's own data or something the product manufactured about itself.
     * Enforced at read time by the auto-enabled {@code realDataOnly} filter above, so an ordinary
     * query cannot pick up synthetic rows by forgetting to exclude them.
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "data_origin", nullable = false)
    private DataOrigin dataOrigin = DataOrigin.REAL;

    public DataOrigin getDataOrigin() {
        return dataOrigin;
    }

    public void setDataOrigin(DataOrigin dataOrigin) {
        this.dataOrigin = dataOrigin;
    }


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
