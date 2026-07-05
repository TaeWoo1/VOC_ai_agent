package com.sellerops.connector.cafe24.onboarding;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.connector.cafe24.Cafe24HttpClient;
import com.sellerops.connector.cafe24.Cafe24TokenResult;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * Dedicated Cafe24 authorization-code OAuth client for the "Connect Cafe24" flow.
 * Two operations, both per-mall ({@code https://{mall_id}.cafe24api.com}):
 *
 * <ul>
 *   <li>{@link #authorizationUrl} builds the consent URL the seller's browser is sent
 *       to ({@code /api/v2/oauth/authorize?response_type=code&...}). Read-only scopes
 *       only — the caller passes a scope string that must never contain a write scope.</li>
 *   <li>{@link #exchangeAuthorizationCode} swaps the returned code for tokens
 *       ({@code POST /api/v2/oauth/token}, {@code grant_type=authorization_code},
 *       {@code Authorization: Basic base64(client_id:client_secret)}). The single-use
 *       refresh token in the response is what the connector later rotates.</li>
 * </ul>
 *
 * <p>No secret material — client secret, Basic credential, authorization code, or any
 * token — ever appears in logs, {@code toString}, or exception messages. There is no
 * logger in this class by design. This mirrors {@code Cafe24TokenClient}; it is kept
 * separate because onboarding (interactive code grant) is a distinct concern from
 * run-time refresh.
 */
public class Cafe24OAuthClient {

    static final String AUTHORIZE_PATH = "/api/v2/oauth/authorize";
    static final String TOKEN_PATH = "/api/v2/oauth/token";

    /** mall_id becomes a hostname label — reject anything else before any HTTP. */
    private static final Pattern MALL_ID_SHAPE = Pattern.compile("[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?");

    private final Cafe24HttpClient http;
    private final ObjectMapper mapper = new ObjectMapper();

    public Cafe24OAuthClient(Cafe24HttpClient http) {
        this.http = http;
    }

    /** Whether a mall id is a valid hostname label (used before building any URL). */
    public static boolean isValidMallId(String mallId) {
        return mallId != null && MALL_ID_SHAPE.matcher(mallId).matches();
    }

    /**
     * Build the seller-facing consent URL. {@code scopes} is a comma-separated,
     * read-only scope list; {@code state} is the random CSRF/replay guard.
     */
    public String authorizationUrl(String mallId, String clientId, String redirectUri,
                                   String scopes, String state) {
        requireMallId(mallId);
        Map<String, String> params = new LinkedHashMap<>();
        params.put("response_type", "code");
        params.put("client_id", clientId);
        params.put("state", state);
        params.put("redirect_uri", redirectUri);
        params.put("scope", scopes);
        String query = params.entrySet().stream()
                .map(e -> enc(e.getKey()) + "=" + enc(e.getValue()))
                .collect(Collectors.joining("&"));
        return "https://" + mallId + ".cafe24api.com" + AUTHORIZE_PATH + "?" + query;
    }

    /**
     * Exchange an authorization code for tokens. Never echoes the code or body.
     *
     * @throws IllegalStateException on a non-200 / unparseable response
     */
    public Cafe24TokenResult exchangeAuthorizationCode(String mallId, String clientId,
                                                       String clientSecret, String code,
                                                       String redirectUri) {
        requireMallId(mallId);
        URI tokenUri = URI.create("https://" + mallId + ".cafe24api.com" + TOKEN_PATH);

        String basic = Base64.getEncoder().encodeToString(
                (clientId + ":" + clientSecret).getBytes(StandardCharsets.UTF_8));
        Map<String, String> headers = Map.of("Authorization", "Basic " + basic);

        Map<String, String> form = new LinkedHashMap<>();
        form.put("grant_type", "authorization_code");
        form.put("code", code);
        form.put("redirect_uri", redirectUri);

        Cafe24HttpClient.Response response = http.postForm(tokenUri, headers, form);
        if (response.statusCode() != 200) {
            // The body stays out of the message — it may carry token material.
            throw new IllegalStateException(
                    "카페24 인증 코드 교환에 실패했습니다 (HTTP " + response.statusCode() + ").");
        }
        TokenResponse token = parse(response.body());
        if (token.accessToken() == null || token.accessToken().isBlank()
                || token.refreshToken() == null || token.refreshToken().isBlank()) {
            throw new IllegalStateException("카페24 인증 코드 응답을 해석할 수 없습니다.");
        }
        return new Cafe24TokenResult(token.accessToken(), token.refreshToken(),
                token.expiresAt(), token.refreshTokenExpiresAt());
    }

    private void requireMallId(String mallId) {
        if (!isValidMallId(mallId)) {
            // The raw value stays out of the message — seller-supplied, unknown provenance.
            throw new IllegalStateException("카페24 mall_id 형식이 올바르지 않습니다.");
        }
    }

    private TokenResponse parse(String body) {
        try {
            return mapper.readValue(body, TokenResponse.class);
        } catch (Exception e) {
            throw new IllegalStateException("카페24 인증 코드 응답을 해석할 수 없습니다.");
        }
    }

    private static String enc(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
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
