package com.sellerops.review.channel.dto;

/**
 * The acquisition target the Local Agent resolves an {@code acquisitionRef} to: the channel, and the
 * {@code accountSlot} the existing review handoff is keyed by ({@code AgentReviewHandoffRequest}) —
 * so the run can hand its reading back through the route that already exists. No credential, no
 * review, no person.
 *
 * <p>{@code expectedStoreFingerprint} is the third thing, and the only one that is new: the digest of this
 * account's own 업체코드 ({@code WingStoreIdentity}), so a deterministic run can establish — before it reads a
 * single review — that the authenticated browser is the store this binding belongs to (PD-4). {@code null}
 * when the account holds no vendor code; the run then stops at {@code STORE_UNRESOLVED} rather than reading
 * a store nobody can name. Still no credential: a digest is not the value, and the value never leaves the
 * vault boundary.
 */
public record AgentReviewAcquisitionTargetView(String channelCode, String accountSlot,
                                               String expectedStoreFingerprint) {
}
