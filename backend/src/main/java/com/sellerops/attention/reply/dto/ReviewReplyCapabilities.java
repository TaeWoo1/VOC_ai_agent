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
 * ({@code canSave}, {@code canApprove}, {@code canCopy}) but never {@code canWithdraw}:
 * withdrawal is the one operation that reduces commitment, and blocking it would strand a
 * review in APPROVED with no exit — frozen against editing by its own approval, and frozen
 * against withdrawal by the gate.
 */
public record ReviewReplyCapabilities(
        boolean canSave,
        boolean canApprove,
        boolean canWithdraw,
        boolean canCopy) {
}
