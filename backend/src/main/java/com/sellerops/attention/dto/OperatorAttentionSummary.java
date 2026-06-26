package com.sellerops.attention.dto;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * Channel-generic attention summary for one account over the explicit
 * [{@code fromDate}, {@code toDate}] window. Reads no clock — the window is the
 * as-of context (no {@code generatedAt}). {@code items} are pre-sorted by severity
 * (HIGH → LOW); an empty list means nothing currently needs attention.
 */
public record OperatorAttentionSummary(
        UUID sellerAccountId,
        String channel,
        LocalDate fromDate,
        LocalDate toDate,
        List<AttentionSignal> items) {
}
