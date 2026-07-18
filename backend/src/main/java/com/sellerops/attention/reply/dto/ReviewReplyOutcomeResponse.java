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
 * <p>Deliberately carries NO body and NO channel claim — like {@code ReviewReplyApprovalResponse},
 * the record of an operator's report says only that it was recorded, never anything about NAVER.
 */
public record ReviewReplyOutcomeResponse(String actionRef, boolean recorded, boolean replayed) {
}
