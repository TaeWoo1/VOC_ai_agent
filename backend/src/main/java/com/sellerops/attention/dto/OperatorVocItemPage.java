package com.sellerops.attention.dto;

import java.time.LocalDate;
import java.util.List;

/**
 * One page of the attention-signal drill-down: metadata-only {@link OperatorVocItem}
 * rows plus paging and the echoed window. Reads no server clock — the
 * [{@code fromDate}, {@code toDate}] window is the as-of context (no generatedAt) —
 * matching {@link OperatorAttentionSummary}.
 *
 * <p><b>Two totals, and they are not interchangeable.</b> {@code total} is the number of rows
 * matching everything the caller asked for, INCLUDING an active category filter — it is what the
 * pager pages through. {@code unfilteredTotal} ignores the category filter and is the denominator
 * the breakdown below is comparable to. They are equal only when no category filter is applied,
 * which is exactly why a client (or a test) must not use one where the other belongs: the mistake
 * is invisible in the common case and wrong the moment a facet is chosen.
 *
 * <p>{@code categoryCounts} and {@code unclassifiedCount} are always computed over the window
 * UNFILTERED, so choosing a facet does not collapse the facet list to the chosen option. Together
 * they satisfy {@code sum(categoryCounts) + unclassifiedCount == unfilteredTotal}.
 *
 * <p><b>That identity has exactly one documented exception</b>, and it is stated rather than
 * assumed away: a row whose stored category is NOT in {@code ItemAnalysisCategories} is omitted from
 * {@code categoryCounts} (it could only be offered as a facet the API then rejects with a 400) while
 * {@code unfilteredTotal} still counts it, so the two sides fall short by that many rows. Such a row
 * is a writer-side bug — every writer in this system emits one of nine fixed labels, pinned by
 * {@code ItemAnalysisCategoriesTest} — and it is logged at WARN when seen. The row itself is never
 * hidden: it stays in the list, carrying its category. A client must therefore treat the identity as
 * a property of healthy data, not as an arithmetic guarantee to divide by.
 *
 * <p>{@code unclassifiedCount} is a COVERAGE fact — rows with no {@code item_analyses} row at all
 * (analysis failed, the row predates analysis, or a duplicate re-import only refreshed reply
 * state). It is not the 기타 category, which is a stored verdict and appears in
 * {@code categoryCounts} like any other.
 *
 * <p>Both are empty/zero for a source that cannot classify at all (Cafe24 community articles have
 * no analyses), which is a capability limit rather than a claim that nothing is classified.
 */
public record OperatorVocItemPage(
        String signalType,
        LocalDate fromDate,
        LocalDate toDate,
        int page,
        int size,
        long total,
        long unfilteredTotal,
        List<CategoryCount> categoryCounts,
        long unclassifiedCount,
        List<OperatorVocItem> items) {
}
