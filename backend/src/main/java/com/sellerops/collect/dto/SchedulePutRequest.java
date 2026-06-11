package com.sellerops.collect.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

/**
 * Upsert one (seller account x data type) schedule. Slice 6 supports INTERVAL
 * cadence only — there is no cadenceKind field on purpose; CRON arrives later.
 */
public record SchedulePutRequest(
        @NotBlank String dataType,
        @NotNull Integer intervalMinutes,
        boolean enabled) {
}
