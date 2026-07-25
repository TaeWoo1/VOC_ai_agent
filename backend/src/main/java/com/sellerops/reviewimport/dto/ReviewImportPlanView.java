package com.sellerops.reviewimport.dto;

import com.sellerops.reviewimport.ReviewImportPlan;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

/** A plan header for lists and detail. Status is derived from its segments. */
public record ReviewImportPlanView(
        UUID id,
        UUID sellerAccountId,
        UUID channelId,
        LocalDate requestedStart,
        LocalDate requestedEnd,
        String status,
        Instant createdAt) {

    public static ReviewImportPlanView from(ReviewImportPlan p) {
        return new ReviewImportPlanView(p.getId(), p.getSellerAccountId(), p.getChannelId(),
                p.getRequestedStart(), p.getRequestedEnd(), p.getStatus().name(), p.getCreatedAt());
    }
}
