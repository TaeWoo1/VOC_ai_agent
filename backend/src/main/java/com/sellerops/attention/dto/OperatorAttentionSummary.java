package com.sellerops.attention.dto;

import com.sellerops.attention.AttentionCoverage;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * Channel-generic attention summary for one account over the explicit
 * [{@code fromDate}, {@code toDate}] window. Reads no clock — the window is the
 * as-of context (no {@code generatedAt}). {@code items} are pre-sorted by severity
 * (HIGH → LOW).
 *
 * <p><b>An empty {@code items} list means "nothing needs attention" ONLY when
 * {@code coverage == COVERED}.</b> When {@code coverage} is uncertain (a multi-account channel, or a
 * channel with no attention source), the empty list means SellerOps could not safely determine the
 * attention state for this scope — the surface must say so, never render it as calm. See
 * {@link AttentionCoverage}.
 */
public record OperatorAttentionSummary(
        UUID sellerAccountId,
        String channel,
        LocalDate fromDate,
        LocalDate toDate,
        AttentionCoverage coverage,
        List<AttentionSignal> items) {
}
