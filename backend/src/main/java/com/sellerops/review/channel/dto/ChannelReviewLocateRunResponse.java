package com.sellerops.review.channel.dto;

/**
 * What the seller's browser gets back when they press {@code [쿠팡에서 보기]}: an opaque, single-use
 * {@code locateRef} to put in the Action Window {@code START_RUN}, and the sanitized {@code channelCode}
 * of the screen the run will read.
 *
 * <p>Deliberately nothing else. The frontend does not receive the locate target and could not usefully
 * hold it: everything that finds the row — product, option, date, rating, body fingerprint — is resolved
 * by the Local Agent against its own backend session, so the description of the review never travels
 * through the browser or over the Action Window wire.
 */
public record ChannelReviewLocateRunResponse(String locateRef, String channelCode) {
}
