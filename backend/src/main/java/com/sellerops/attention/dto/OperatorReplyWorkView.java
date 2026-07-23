package com.sellerops.attention.dto;

import com.sellerops.attention.AttentionCoverage;
import java.util.List;
import java.util.UUID;

/**
 * The 내 답변 작업 worklist for one account — the operator's OWN committed reply work, and the
 * bounded record of what they recently reported posting.
 *
 * <p><b>Not window-scoped, on purpose.</b> The arrival worklist answers "what came in" over a chosen
 * window; this answers "what did I commit to", which must survive a reload, a window change and a
 * new session. A draft the seller started is theirs until they finish or abandon it.
 *
 * <p>{@code todo} is committed-and-not-yet-reported, worst-first. {@code recentlyReported} is bounded
 * and most-recently-reported-first, and every row in it is {@code UNVERIFIED} — SellerOps never
 * confirmed the channel accepted the reply, so it may be shown as "기록함 · 확인 안 함" and never as
 * 완료.
 *
 * <p>{@code coverage} carries the same false-calm guard as the attention summary: when it is
 * uncertain, empty lists mean the scope could not be attributed, NOT that there is no work.
 */
public record OperatorReplyWorkView(
        UUID sellerAccountId,
        String channel,
        AttentionCoverage coverage,
        List<OperatorVocItem> todo,
        List<OperatorVocItem> recentlyReported) {
}
