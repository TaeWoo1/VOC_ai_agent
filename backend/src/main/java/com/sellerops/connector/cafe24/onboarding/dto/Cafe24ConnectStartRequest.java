package com.sellerops.connector.cafe24.onboarding.dto;

import jakarta.validation.constraints.NotBlank;

/**
 * "Connect Cafe24" start request. Only the seller's {@code mallId} is needed — the
 * per-mall consent URL host is built from it; the app OAuth identity is server config.
 */
public record Cafe24ConnectStartRequest(@NotBlank String mallId) {
}
