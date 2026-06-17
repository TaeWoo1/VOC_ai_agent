package com.sellerops.connector.cafe24;

/**
 * Result of one refresh-token grant. {@code refreshToken} is the replacement
 * token when the provider rotated (officially: every successful refresh —
 * the old token is single-use), or null if the response omitted it. Expiry
 * fields are the raw official strings ({@code expires_at} /
 * {@code refresh_token_expires_at}, ISO-8601 with no offset) — zone
 * interpretation is deliberately deferred, see {@link Cafe24TokenClient}.
 */
public record Cafe24TokenResult(
        String accessToken,
        String refreshToken,
        String expiresAt,
        String refreshTokenExpiresAt) {

    /** True when the provider returned a replacement for the given token. */
    public boolean rotatedFrom(String previousRefreshToken) {
        return refreshToken != null && !refreshToken.isBlank()
                && !refreshToken.equals(previousRefreshToken);
    }

    /** Masked — a stray log statement must not leak token material. */
    @Override
    public String toString() {
        return "Cafe24TokenResult[accessToken=<masked>"
                + ", refreshToken=" + (refreshToken != null ? "<masked>" : "null")
                + ", expiresAt=" + expiresAt
                + ", refreshTokenExpiresAt=" + refreshTokenExpiresAt + "]";
    }
}
