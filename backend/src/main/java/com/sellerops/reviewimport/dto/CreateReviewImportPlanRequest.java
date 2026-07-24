package com.sellerops.reviewimport.dto;

import jakarta.validation.constraints.NotNull;
import java.time.LocalDate;
import java.util.UUID;

/**
 * Start a historical review import for one seller account over an operator-chosen period. The period is
 * taken verbatim (no SellerOps depth clamp); any earlier-than-reachable portion surfaces later as MISSING
 * coverage. Segmentation is fixed calendar months (V1).
 */
public record CreateReviewImportPlanRequest(
        @NotNull UUID sellerAccountId,
        @NotNull UUID channelId,
        @NotNull LocalDate requestedStart,
        @NotNull LocalDate requestedEnd) {
}
