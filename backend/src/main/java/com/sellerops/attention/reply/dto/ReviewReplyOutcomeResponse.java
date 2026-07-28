package com.sellerops.attention.reply.dto;

/**
 * The outcome of recording an operator-reported reply submission.
 *
 * <p>{@code actionRef} echoes the row, so a client can match a response to its request without
 * relying on ordering.
 *
 * <p>{@code recorded} is true whenever the outcome now stands (a fresh append or a replay of one).
 * {@code replayed} distinguishes "this command had already been applied; nothing was written" from a
 * fresh write — both are 200, because a replay is a success. A command id reused for a DIFFERENT
 * outcome is the conflict, and it never reaches this record (it is a 409).
 *
 * <p>{@code issueMemoryRefreshed} reports whether the best-effort Review Issue Memory refresh that
 * follows a reported submission SUCCEEDED. {@code null} means "not attempted" — an aborted outcome or
 * a replay, which trigger no refresh. {@code false} means the refresh was attempted and failed: the
 * reported result STILL STANDS (the refresh never rolls it back), but the surface must say the
 * analysis is not yet up to date rather than let a stale issue view read as "변화 없음". It is NOT a
 * channel claim and NOT a completion signal.
 *
 * <p>Deliberately carries NO body and NO channel claim — like {@code ReviewReplyApprovalResponse},
 * the record of an operator's report says only that it was recorded, never anything about NAVER.
 */
public record ReviewReplyOutcomeResponse(String actionRef, boolean recorded, boolean replayed,
                                         Boolean issueMemoryRefreshed) {

    /** The same outcome, with the best-effort issue-memory refresh result attached by the orchestrator. */
    public ReviewReplyOutcomeResponse withIssueMemoryRefreshed(boolean refreshed) {
        return new ReviewReplyOutcomeResponse(actionRef, recorded, replayed, refreshed);
    }
}
