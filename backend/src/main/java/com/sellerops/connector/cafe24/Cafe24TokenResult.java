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
        String refreshTokenExpiresAt,
        /**
         * The scopes the mall actually GRANTED, as returned with the token.
         *
         * <p>Requesting a scope and holding it are different facts, and until this was parsed the
         * product only had the first. The second was discovered at call time, months later, as an
         * {@code insufficient_scope} on a product read — by which point the seller had long since
         * finished consenting and the only remedy was to ask them back. Empty when the provider
         * returned none; never inferred from what was requested.
         */
        java.util.List<String> grantedScopes) {

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
                + ", refreshTokenExpiresAt=" + refreshTokenExpiresAt
                + ", grantedScopes=" + grantedScopes + "]";
    }
}
