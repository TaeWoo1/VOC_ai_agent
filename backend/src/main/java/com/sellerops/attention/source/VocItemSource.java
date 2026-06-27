package com.sellerops.attention.source;

import com.sellerops.attention.AttentionSignalType;
import com.sellerops.attention.VocWindowSnapshot;
import java.time.LocalDate;
import java.util.UUID;

/**
 * Channel-generic read source behind the operator attention surface. One
 * implementation per collected-VOC store (today only Cafe24 community articles);
 * the registry picks the source for an account's channel, so
 * {@code OperatorAttentionService} no longer depends on any channel-specific
 * repository. A channel with no source resolves to a safe empty state — never a
 * fabricated signal.
 *
 * <p>Contract notes: the window arrives as an already-validated, inclusive
 * {@code [from, to]} pair of calendar dates ({@code OperatorAttentionService} runs
 * {@code BackfillWindow.of} first); each adapter applies its own channel-policy time
 * zone. {@code page}/{@code size} arrive already clamped. No raw body is exposed —
 * rows are the metadata-only {@link com.sellerops.attention.dto.OperatorVocItem}
 * shape, with any preview produced read-time and fail-closed by the adapter.
 */
public interface VocItemSource {

    /** True if this source serves the given channel code (e.g. Cafe24 → {@code "CAFE24"}). */
    boolean supports(String channelCode);

    /** Exact window-scoped review/inquiry counts for the account, for the attention signals. */
    VocWindowSnapshot snapshot(UUID orgId, UUID accountId, LocalDate from, LocalDate to);

    /**
     * One clamped page of metadata-only rows behind a chosen signal type, over the
     * same window. {@code channelCode}/{@code channelNameKo} are stamped onto each
     * row by the adapter (channel identity is resolved generically upstream).
     */
    VocItemSlice items(UUID orgId, UUID accountId, String channelCode, String channelNameKo,
                       AttentionSignalType signalType, LocalDate from, LocalDate to, int page, int size);
}
