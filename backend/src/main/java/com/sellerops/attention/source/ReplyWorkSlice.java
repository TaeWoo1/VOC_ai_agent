package com.sellerops.attention.source;

import com.sellerops.attention.dto.OperatorVocItem;
import java.util.List;

/**
 * The two sections of the 내 답변 작업 worklist, as read from one source.
 *
 * <p>{@code todo} is the operator's committed, not-yet-reported reply work (worst-first);
 * {@code recentlyReported} is the bounded, most-recently-reported-first record of replies they
 * reported posting. Every {@code recentlyReported} row is {@code UNVERIFIED} by construction — there
 * is no read-back oracle for a public reply — so a caller may present it as "기록함 · 확인 안 함" and
 * never as 완료.
 *
 * <p>Both empty is the honest answer for a scope this source cannot attribute; the caller pairs it
 * with the coverage verdict rather than letting an empty list read as "no work".
 */
public record ReplyWorkSlice(List<OperatorVocItem> todo, List<OperatorVocItem> recentlyReported) {

    private static final ReplyWorkSlice EMPTY = new ReplyWorkSlice(List.of(), List.of());

    public static ReplyWorkSlice empty() {
        return EMPTY;
    }
}
