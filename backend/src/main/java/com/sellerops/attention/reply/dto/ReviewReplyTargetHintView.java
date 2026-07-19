package com.sellerops.attention.reply.dto;

/**
 * The PRIVACY-SAFE review target hint the guided reply-preparation path returns for an approved review: a
 * coarse star {@code rating} (1..5), a coarse {@code recencyBucket} (KST date-only, never a raw timestamp),
 * and a one-way {@code bodyFingerprint} over the review body ({@code review-body-fingerprint/v1}).
 *
 * <p>It carries NO raw body, NO raw timestamp, NO product/author/channel-side id. The {@code bodyFingerprint}
 * here is the <b>review-body</b> fingerprint used to locate the matching row — deliberately distinct from the
 * reply-draft {@code approvedFingerprint} ({@code review-reply-v1}) that binds the submissionRef.
 */
public record ReviewReplyTargetHintView(int rating, String recencyBucket, String bodyFingerprint) {
}
