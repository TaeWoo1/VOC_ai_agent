package com.sellerops.connector.cafe24.spike;

/**
 * The spike token-exchange result. Holds the access token and the rotated refresh
 * token (both memory-only, never logged) plus the closed-vocabulary grant answers.
 * The raw scope string is parsed and immediately discarded — only these booleans
 * survive.
 */
public record SpikeToken(String accessToken, String refreshToken,
                         boolean writeCommunityGranted, boolean readCommunityGranted) {

    /** Masked — tokens must not leak via accidental rendering. */
    @Override
    public String toString() {
        return "SpikeToken[accessToken=<masked>, refreshToken=<masked>, writeCommunityGranted="
                + writeCommunityGranted + ", readCommunityGranted=" + readCommunityGranted + "]";
    }
}
