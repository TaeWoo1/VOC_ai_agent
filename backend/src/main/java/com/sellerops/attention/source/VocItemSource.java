package com.sellerops.attention.source;

import com.sellerops.attention.AttentionCoverage;
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
     * Whether this source can SAFELY attribute attention for the account scope, or must decline to
     * answer rather than let an empty snapshot read as a false calm. The default is
     * {@link AttentionCoverage#COVERED} — a source with no attribution ambiguity always covers its
     * scope. A source whose store cannot attribute some scopes (today {@code IngestedReviewVocItemSource}
     * for a multi-account channel) overrides this; it is a read-time verdict over account/channel
     * metadata and MUST agree with what {@link #snapshot}/{@link #items} could actually attribute
     * (an uncertain scope returns empty counts, and this says why).
     */
    default AttentionCoverage coverage(UUID orgId, UUID accountId) {
        return AttentionCoverage.COVERED;
    }

    /**
     * One clamped page of metadata-only rows behind a chosen signal type, over the
     * same window. {@code channelCode}/{@code channelNameKo} are stamped onto each
     * row by the adapter (channel identity is resolved generically upstream).
     *
     * <p>{@code category} optionally narrows the page to one stored analysis category, or to
     * {@code ItemAnalysisCategories.UNCLASSIFIED} for rows with no analysis at all; {@code null}
     * means no narrowing. It arrives ALREADY VALIDATED — {@code OperatorAttentionService} rejects
     * an unrecognised value with a 400 — so an adapter never has to decide what an unknown category
     * means, and can never quietly answer "no rows" for a typo.
     */
    VocItemSlice items(UUID orgId, UUID accountId, String channelCode, String channelNameKo,
                       AttentionSignalType signalType, LocalDate from, LocalDate to,
                       String category, int page, int size);
}
