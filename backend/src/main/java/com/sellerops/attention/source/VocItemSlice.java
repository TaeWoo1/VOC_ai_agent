package com.sellerops.attention.source;

import com.sellerops.attention.dto.OperatorVocItem;
import java.util.List;

/**
 * One page worth of metadata-only VOC rows a {@link VocItemSource} produced for a
 * drill-down, plus the total matching count. Deliberately leaner than
 * {@link com.sellerops.attention.dto.OperatorVocItemPage}: the source returns just
 * the rows + total, and {@code OperatorAttentionService} wraps them in the public
 * page envelope (signal type, echoed window, paging). Keeps the generic paging
 * contract out of the channel adapters.
 */
public record VocItemSlice(List<OperatorVocItem> items, long total) {

    private static final VocItemSlice EMPTY = new VocItemSlice(List.of(), 0L);

    /** A source that has nothing to show for this window (or an unsupported channel). */
    public static VocItemSlice empty() {
        return EMPTY;
    }
}
