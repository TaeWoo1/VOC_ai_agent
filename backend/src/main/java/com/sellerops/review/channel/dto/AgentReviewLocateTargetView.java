package com.sellerops.review.channel.dto;

import java.time.LocalDate;

/**
 * The locate target the Local Agent resolves a {@code locateRef} to — exactly the fields
 * {@code review-locate.ts} compares a live WING row against, and nothing more.
 *
 * <p><b>No buyer.</b> The screen prints the 구매자 column and the agent resolves it only so it can be
 * excluded; there is no field for it here, on the wire, or in the database. Matching on the buyer's name
 * would make a person's name the handle SellerOps holds to re-find a review, which is the storage the
 * approval contract §5d refuses.
 *
 * <p><b>The body travels as a fingerprint</b> ({@code review-body-fingerprint/v1}), computed from the
 * STORED body, so the target and the row on the screen are compared under one rule and the review text
 * itself never leaves the database on this path.
 *
 * <p>{@code vendorItemId} is nullable because the real screen prints it on some rows and not others; the
 * matcher narrows on it only when both sides have one.
 */
public record AgentReviewLocateTargetView(
        String channelCode,
        String productId,
        String vendorItemId,
        LocalDate writtenOn,
        Integer rating,
        String bodyFingerprint) {
}
