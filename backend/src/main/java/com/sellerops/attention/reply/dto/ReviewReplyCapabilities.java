package com.sellerops.attention.reply.dto;

/**
 * What this operator may do with this review's reply right now — computed server-side, so the
 * gate is stated once rather than re-derived by every client.
 *
 * <p>The rule depends on the triage disposition AND whether a draft exists AND whether an
 * approval stands; a client re-deriving that from the fields it happens to have is how two
 * surfaces drift into disagreeing about what is allowed. The server still enforces every rule
 * independently — this is for rendering affordances, never for authorization. Like
 * {@code actionRef}, it describes; it does not permit.
 *
 * <p><b>The asymmetry is the point.</b> Leaving {@code RESPONSE_NEEDED} blocks forward motion
 * ({@code canSave}, {@code canApprove}, {@code canCopy}, {@code canStartSubmissionRun}) but never
 * {@code canWithdraw}: withdrawal is the one operation that reduces commitment, and blocking it would
 * strand a review in APPROVED with no exit — frozen against editing by its own approval, and frozen
 * against withdrawal by the gate.
 *
 * <p><b>{@code canWithdraw=false} is not a prediction of the response code.</b> It is exactly
 * {@code approved} — "an approval stands right now, so there is something to withdraw" — and a false
 * value covers two situations that answer a withdrawal DIFFERENTLY:
 *
 * <ol>
 *   <li><b>No approval was ever recorded for this review.</b> Withdrawing is a 409
 *       ({@code 승인된 초안이 없습니다}) — there is no exit to take, and the request is refused.
 *   <li><b>An approval was recorded and has already been withdrawn.</b> Withdrawing again, under a
 *       new command id, is 200 with {@code replayed=true}: the state the caller asked for is the
 *       state that holds, nothing is written, and no audit row is appended (see
 *       {@code ReviewReplyApprovalWriter}, which decides this under its row lock).
 * </ol>
 *
 * <p>Both are "no new transition is available", which is all this flag claims. The second is 200
 * because the alternative is interleaving-dependent: two identical concurrent withdrawals both see
 * {@code canWithdraw=true}, and if the loser were a 409 its answer would depend on which read the
 * database served first — same two callers, same intent, two contracts.
 *
 * <p>Nothing else was softened. A withdrawal on a review with no approval row still conflicts (1
 * above), and a command id already spent on a DIFFERENT decision still conflicts
 * ({@code ReviewReplyApprovalService.replay}). Neither state is terminal in the state-machine sense —
 * a withdrawn reply may be approved again — so there is no "conflicting terminal state" rule here,
 * and this note should not be read as inventing one.
 *
 * <p>{@code canStartSubmissionRun} (v1.6) gates offering the guided Action Window reply-submission
 * flow. It is the same rule as {@code canCopy} — you may guide a post only for an approved reply you
 * may copy — because a guided post is the copy step performed in the seller center rather than the
 * clipboard. It never authorizes a send: SellerOps only guides and observes; the operator submits.
 */
public record ReviewReplyCapabilities(
        boolean canSave,
        boolean canApprove,
        boolean canWithdraw,
        boolean canCopy,
        boolean canStartSubmissionRun) {
}
