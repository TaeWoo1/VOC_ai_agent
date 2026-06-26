package com.sellerops.attention.dto;

import java.time.LocalDate;
import java.util.List;

/**
 * One page of the attention-signal drill-down: metadata-only {@link OperatorVocItem}
 * rows plus paging and the echoed window. Reads no server clock — the
 * [{@code fromDate}, {@code toDate}] window is the as-of context (no generatedAt) —
 * matching {@link OperatorAttentionSummary}.
 */
public record OperatorVocItemPage(
        String signalType,
        LocalDate fromDate,
        LocalDate toDate,
        int page,
        int size,
        long total,
        List<OperatorVocItem> items) {
}
