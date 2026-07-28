package com.sellerops.attention.reply;

import java.time.LocalDate;
import java.util.UUID;

/**
 * The one seam by which the reply loop asks the Review Issue Memory to refresh after a reported
 * submission — dependency-inverted so the reply package never depends on issue internals. The
 * implementation lives in {@code com.sellerops.reviewissue}.
 *
 * <p><b>Best-effort, never a rollback.</b> A reported reply is durable truth on its own; refreshing
 * the issue analysis is a follow-on. The implementation runs it in its own transaction and reports
 * success as a boolean — a failure returns {@code false} and leaves the reported outcome untouched,
 * so the surface can say "분석은 아직 갱신되지 않았습니다" rather than let a stale view read as "변화 없음".
 */
public interface IssueMemoryRefreshPort {

    /**
     * Refresh the issue memory for this org as of {@code referenceDate}. Returns {@code true} on
     * success, {@code false} if the refresh failed (the caller's reported outcome still stands).
     */
    boolean refreshAfterReply(UUID orgId, LocalDate referenceDate);

    /**
     * A no-op that reports success — for wiring/tests where the issue-memory refresh is not under
     * test. It performs no refresh and claims none happened beyond a trivially-successful pass.
     */
    IssueMemoryRefreshPort NO_OP = (orgId, referenceDate) -> true;
}
