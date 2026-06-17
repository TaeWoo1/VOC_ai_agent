package com.sellerops.connector.naver;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Token response of {@code POST /external/v1/oauth2/token}. Confirmed shape
 * (official commerce-api discussions, 2026-06-12):
 * {@code {"access_token": "...", "expires_in": <seconds, variable>, "token_type": "Bearer"}}.
 * {@code expires_in} varies per response and must be honored, never assumed
 * constant.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record NaverTokenResponse(
        @JsonProperty("access_token") String accessToken,
        @JsonProperty("expires_in") Long expiresIn,
        @JsonProperty("token_type") String tokenType) {

    /** Masked — a stray log statement must not leak the access token. */
    @Override
    public String toString() {
        return "NaverTokenResponse[accessToken=" + (accessToken != null ? "<masked>" : "null")
                + ", expiresIn=" + expiresIn
                + ", tokenType=" + tokenType + "]";
    }
}
