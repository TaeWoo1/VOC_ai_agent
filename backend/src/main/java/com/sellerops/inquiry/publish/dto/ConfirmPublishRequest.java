package com.sellerops.inquiry.publish.dto;

/**
 * Seller "confirm and publish" request. {@code commandId} is the idempotency key of
 * the confirm; {@code expectedFingerprint} is the exact draft fingerprint the seller
 * reviewed — a mismatch with the current draft head is a 409 (the draft changed).
 */
public record ConfirmPublishRequest(String commandId, String expectedFingerprint) {
}
