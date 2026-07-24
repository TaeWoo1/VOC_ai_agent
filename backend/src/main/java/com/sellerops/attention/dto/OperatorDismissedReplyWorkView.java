package com.sellerops.attention.dto;

import com.sellerops.attention.AttentionCoverage;
import java.util.List;
import java.util.UUID;

/**
 * One page of the 제외한 작업 recovery list for one account — the reviews the operator has set aside
 * from their reply to-do, so they can bring one back (복원).
 *
 * <p><b>Not window-scoped, on purpose</b> — like the whole reply-work read. A review set aside long
 * ago stays reachable here regardless of age; a set-aside review must never become permanently
 * unreachable.
 *
 * <p>{@code items} are ordered most-recently-set-aside first. {@code page}/{@code size} echo the read
 * position, and {@code hasMore} says a further page exists so the surface can offer "더 보기" instead
 * of hiding older items behind a cap.
 *
 * <p>{@code coverage} carries the same false-calm guard as the attention summary: when it is
 * uncertain, an empty page means the scope could not be attributed, NOT that nothing is set aside.
 *
 * <p><b>These rows assert nothing about a reply</b> — being on this list means "set aside", never
 * "completed"; each row's draft and history are intact, which is exactly why it can be restored.
 */
public record OperatorDismissedReplyWorkView(
        UUID sellerAccountId,
        String channel,
        AttentionCoverage coverage,
        List<OperatorVocItem> items,
        int page,
        int size,
        boolean hasMore) {
}
