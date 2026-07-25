package com.sellerops.reviewimport.dto;

import jakarta.validation.constraints.NotNull;
import java.time.LocalDate;

/**
 * What a discovery run found: the historical range the marketplace currently allows, and how that was
 * established.
 *
 * <p>{@code evidence} is required, not defaulted. A default would have to pick one of two claims of
 * different strength — that SellerOps read the range off the live controls, or that a human confirmed it —
 * and silently picking the stronger one is exactly the dishonesty this field exists to prevent.
 */
public record RecordDiscoveredRangeRequest(
        @NotNull LocalDate availableStart,
        @NotNull LocalDate availableEnd,
        /** MACHINE_DISCOVERED | OPERATOR_CONFIRMED. */
        @NotNull String evidence) {
}
