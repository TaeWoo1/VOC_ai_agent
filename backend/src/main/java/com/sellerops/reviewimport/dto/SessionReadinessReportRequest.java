package com.sellerops.reviewimport.dto;

import jakarta.validation.constraints.NotBlank;

/**
 * What the local-agent runtime reports after a session-readiness probe.
 *
 * <p>Sanitized by construction: only the readiness state and the probe moment, both closed enum sets
 * (mirroring {@code contracts/session-readiness/v1}). No account id, cookie, token, URL, or page text — the
 * account is resolved server-side from the opaque launch ref in the path, not sent here.
 */
public record SessionReadinessReportRequest(
        @NotBlank String state,
        @NotBlank String reason) {
}
