package com.sellerops.reviewimport;

import com.sellerops.common.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import java.time.LocalDate;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

/**
 * One operator-chosen historical review-import for a seller account. Holds the REQUESTED period verbatim
 * (the earliest reachable date is discovered per-segment from the live export UI, not clamped here). Its
 * {@link #status} is derived from its segments. See {@code V27__review_import_plan.sql}.
 */
@Getter
@Setter
@Entity
@Table(name = "review_import_plan")
public class ReviewImportPlan extends BaseEntity {

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    @Column(name = "seller_account_id", nullable = false)
    private UUID sellerAccountId;

    @Column(name = "channel_id", nullable = false)
    private UUID channelId;

    @Column(name = "requested_start", nullable = false)
    private LocalDate requestedStart;

    @Column(name = "requested_end", nullable = false)
    private LocalDate requestedEnd;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private ReviewImportPlanStatus status = ReviewImportPlanStatus.DRAFT;
}
