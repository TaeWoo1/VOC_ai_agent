package com.sellerops.attention.source;

import com.sellerops.attention.dto.CategoryCount;
import com.sellerops.attention.dto.OperatorVocItem;
import java.util.List;

/**
 * One page worth of metadata-only VOC rows a {@link VocItemSource} produced for a
 * drill-down, plus the totals and the window's classification breakdown.
 * Deliberately leaner than {@link com.sellerops.attention.dto.OperatorVocItemPage}: the
 * source returns the rows and the counts, and {@code OperatorAttentionService} wraps them
 * in the public page envelope (signal type, echoed window, paging). Keeps the generic
 * paging contract out of the channel adapters.
 *
 * <p>{@code total} respects an active category filter; {@code unfilteredTotal},
 * {@code categoryCounts} and {@code unclassifiedCount} never do — see
 * {@link com.sellerops.attention.dto.OperatorVocItemPage} for why the two totals must not be
 * used interchangeably.
 */
public record VocItemSlice(List<OperatorVocItem> items, long total, long unfilteredTotal,
                           List<CategoryCount> categoryCounts, long unclassifiedCount) {

    private static final VocItemSlice EMPTY = new VocItemSlice(List.of(), 0L, 0L, List.of(), 0L);

    /** A source that has nothing to show for this window (or an unsupported channel). */
    public static VocItemSlice empty() {
        return EMPTY;
    }

    /**
     * A slice from a source that cannot classify its rows at all — every row is unclassified and
     * there is no breakdown to offer. A capability limit, stated once here rather than restated by
     * each such adapter.
     */
    public static VocItemSlice unclassifiable(List<OperatorVocItem> items, long total) {
        return new VocItemSlice(items, total, total, List.of(), total);
    }
}
