package com.sellerops.collect.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.time.LocalDate;

/**
 * Operator-initiated bounded backfill for one data type over an explicit date
 * window. Distinct from {@link ManualSyncRequest} ("지금 수집하기", an incremental
 * run): a backfill always carries a window, which the connector seeds as the run's
 * starting cursor. The window is interpreted in the channel's platform zone
 * (Cafe24 = KST). Ordering and same-window idempotence are enforced downstream.
 */
public record BackfillRequest(@NotBlank String dataType,
                              @NotNull LocalDate startDate,
                              @NotNull LocalDate endDate) {
}
