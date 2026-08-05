package com.sellerops.connector.cafe24;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Renews Cafe24 access tokens with the refresh-token grant, exactly as the
 * official developer docs specify (developers.cafe24.com, verified
 * 2026-06-12):
 *
 * <ul>
 *   <li>Endpoint: {@code POST https://{mall_id}.cafe24api.com/api/v2/oauth/token}
 *       — the host is per-mall; {@code mall_id} comes from the vault.</li>
 *   <li>Client auth: {@code Authorization: Basic base64(client_id:client_secret)}
 *       with an {@code application/x-www-form-urlencoded} body of
 *       {@code grant_type=refresh_token&refresh_token={token}}.</li>
 *   <li>Response: {@code access_token}, {@code expires_at} (ISO-8601 datetime,
 *       NOT an {@code expires_in} second count), {@code refresh_token},
 *       {@code refresh_token_expires_at}. The refresh token is single-use:
 *       the response carries the replacement, and the old one is dead — the
 *       caller must persist the rotation immediately.</li>
 * </ul>
 *
 * <p>The official {@code expires_at} sample carries no timezone offset, so its
 * zone interpretation is deliberately NOT decided here: expiry strings are
 * passed through raw, nothing is cached client-side, and every invocation
 * refreshes (which suits single-use rotation). Zone semantics are a live-smoke
 * item.
 *
 * <p>The initial refresh token comes from the interactive authorization-code
 * consent flow — an operator/manual setup step outside this connector.
 *
 * <p>No secret material — client secret, Basic credential, tokens — ever
 * appears in logs, toString output, or exception messages. There is no logger
 * in this class by design.
 */
public class Cafe24TokenClient {

    static final String TOKEN_PATH = "/api/v2/oauth/token";
    /**
     * mall_id becomes a hostname label; anything else is rejected before HTTP
     * so a malformed stored value can never redirect the request.
     */
    private static final Pattern MALL_ID_SHAPE = Pattern.compile("[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?");

    private final Cafe24HttpClient http;
    private final ObjectMapper mapper = new ObjectMapper();

    public Cafe24TokenClient(Cafe24HttpClient http) {
        this.http = http;
    }

    /**
     * Exchange the stored refresh token for a fresh access token.
     *
     * @throws Cafe24RateLimitedException on HTTP 429 from the token endpoint
     * @throws Cafe24OAuthException on any other non-200 response, classified by the RFC 6749
     *     standard {@code error} field ({@code invalid_grant} = reconnect, {@code invalid_scope}/
     *     {@code insufficient_scope} = missing permission, anything else = generic/unknown)
     */
    public Cafe24TokenResult refresh(String mallId, String clientId, String clientSecret,
                                     String refreshToken) {
        URI tokenUri = tokenUri(mallId);

        String basic = Base64.getEncoder().encodeToString(
                (clientId + ":" + clientSecret).getBytes(StandardCharsets.UTF_8));
        Map<String, String> headers = Map.of("Authorization", "Basic " + basic);

        Map<String, String> form = new LinkedHashMap<>();
        form.put("grant_type", "refresh_token");
        form.put("refresh_token", refreshToken);

        Cafe24HttpClient.Response response = http.postForm(tokenUri, headers, form);
        if (response.statusCode() == 429) {
            throw Cafe24RateLimitedException.fromResponse(response);
        }
        if (response.statusCode() != 200) {
            // Classify by the OAuth2-standard error code so a dead token (reconnect) and an
            // insufficient scope (missing permission) are distinguishable downstream. The body
            // is parsed only for the standard `error` field; nothing else reaches the message.
            throw Cafe24OAuthException.fromTokenError(response.statusCode(), response.body(), mapper);
        }

        TokenResponse token = parse(response.body());
        if (token.accessToken() == null || token.accessToken().isBlank()) {
            throw new IllegalStateException("카페24 인증 토큰 응답을 해석할 수 없습니다.");
        }
        return new Cafe24TokenResult(
                token.accessToken(), token.refreshToken(),
                token.expiresAt(), token.refreshTokenExpiresAt());
    }

    static URI tokenUri(String mallId) {
        if (mallId == null || !MALL_ID_SHAPE.matcher(mallId).matches()) {
            // The raw value stays out of the message — it is operator-stored
            // credential material of unknown provenance.
            throw new IllegalStateException("카페24 mall_id 형식이 올바르지 않습니다.");
        }
        return URI.create("https://" + mallId + ".cafe24api.com" + TOKEN_PATH);
    }

    private TokenResponse parse(String body) {
        try {
            return mapper.readValue(body, TokenResponse.class);
        } catch (Exception e) {
            // The body stays out of the message — a partially valid body could
            // already contain token material.
            throw new IllegalStateException("카페24 인증 토큰 응답을 해석할 수 없습니다.");
        }
    }

    /** Officially confirmed response fields; everything else ignored. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    private record TokenResponse(
            @JsonProperty("access_token") String accessToken,
            @JsonProperty("expires_at") String expiresAt,
            @JsonProperty("refresh_token") String refreshToken,
            @JsonProperty("refresh_token_expires_at") String refreshTokenExpiresAt) {

        @Override
        public String toString() {
            return "TokenResponse[access_token=<masked>, refresh_token=<masked>"
                    + ", expires_at=" + expiresAt
                    + ", refresh_token_expires_at=" + refreshTokenExpiresAt + "]";
        }
    }
}
