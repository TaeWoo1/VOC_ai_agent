package com.sellerops.collect.dto;

import jakarta.validation.constraints.NotBlank;

/** "지금 수집하기" — run one data type for a seller account right now. */
public record ManualSyncRequest(@NotBlank String dataType) {
}
