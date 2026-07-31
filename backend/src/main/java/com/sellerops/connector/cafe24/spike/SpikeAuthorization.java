package com.sellerops.connector.cafe24.spike;

/**
 * The spike's own authorization result — a fresh access token bound to its mall,
 * plus the closed-vocabulary answer to "was {@code mall.write_community} granted?".
 *
 * <p>This is produced by the <b>spike-only</b> OAuth path (a separate consent that
 * requests read + write, against a disposable spike credential) — never from the
 * production onboarding authorizer, whose token is read-only by construction. The
 * {@code mallId}/{@code accessToken} are used only to call the transport and are
 * never placed in a {@link SpikeReplyResult}, a log line, or the proof.
 */
public record SpikeAuthorization(String mallId, String accessToken, boolean writeCommunityGranted) {

    /** Masked — the token/mall must not leak via accidental rendering. */
    @Override
    public String toString() {
        return "SpikeAuthorization[mallId=<masked>, accessToken=<masked>, writeCommunityGranted="
                + writeCommunityGranted + "]";
    }
}
