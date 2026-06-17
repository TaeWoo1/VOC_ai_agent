package com.sellerops.connector.naver;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.security.crypto.bcrypt.BCrypt;

/**
 * Mints and caches Naver Commerce API access tokens. Everything here follows
 * the officially confirmed flow (commerce-api discussions #611/#1862/#1313,
 * verified 2026-06-12):
 *
 * <ul>
 *   <li>Electronic signature: {@code bcrypt.hashpw(client_id + "_" + timestamp_ms,
 *       salt = client_secret)} → standard Base64 → {@code client_secret_sign}.
 *       The client secret Naver issues IS a bcrypt salt; any other shape fails
 *       closed before HTTP.</li>
 *   <li>Token endpoint: {@code POST {base-url}/external/v1/oauth2/token},
 *       {@code application/x-www-form-urlencoded} (mandatory for apps created
 *       after 2024-03-07), fields {@code client_id / timestamp /
 *       client_secret_sign / grant_type=client_credentials / type=SELF}. The
 *       signed timestamp and the sent timestamp must be the same value.</li>
 *   <li>Response: {@code access_token / expires_in (variable seconds) /
 *       token_type}. Tokens are cached per client id until
 *       {@code expires_in - skew} and re-minted after.</li>
 * </ul>
 *
 * <p>No secret material — client secret, signature, or access token — ever
 * appears in logs, toString output, or exception messages. There is no logger
 * in this class by design.
 *
 * <p>Concurrent first calls for the same client id may mint twice; both tokens
 * are valid and the last write wins — acceptable for the per-account cadence
 * this connector runs at.
 */
public class NaverTokenClient {

    static final String TOKEN_PATH = "/external/v1/oauth2/token";
    /** Re-mint this long before the reported expiry so a token never dies mid-run. */
    static final Duration EXPIRY_SKEW = Duration.ofSeconds(60);

    private final NaverHttpClient http;
    private final Clock clock;
    private final URI tokenUri;
    private final ObjectMapper mapper = new ObjectMapper();
    private final Map<String, CachedToken> cache = new ConcurrentHashMap<>();

    public NaverTokenClient(NaverHttpClient http, Clock clock, String baseUrl) {
        this.http = http;
        this.clock = clock;
        String trimmed = baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length() - 1) : baseUrl;
        this.tokenUri = URI.create(trimmed + TOKEN_PATH);
    }

    /**
     * A valid access token for the client, from cache when fresh, minted when
     * absent or within {@link #EXPIRY_SKEW} of expiry.
     *
     * @throws NaverRateLimitedException on HTTP 429 from the token endpoint
     */
    public String accessToken(String clientId, String clientSecret) {
        Instant now = clock.instant();
        String key = cacheKey(clientId, clientSecret);
        CachedToken cached = cache.get(key);
        if (cached != null && now.isBefore(cached.expiresAt())) {
            return cached.accessToken();
        }
        return mint(clientId, clientSecret, key, now);
    }

    /**
     * Rotating the secret must invalidate the cached token immediately, so the
     * key carries a one-way fingerprint of the secret — never the secret itself.
     */
    private static String cacheKey(String clientId, String clientSecret) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(clientSecret.getBytes(StandardCharsets.UTF_8));
            return clientId + ":" + HexFormat.of().formatHex(digest, 0, 8);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256을 사용할 수 없는 환경입니다.");
        }
    }

    /**
     * The confirmed electronic signature: bcrypt over
     * {@code clientId + "_" + timestampMillis} with the client secret as salt,
     * Base64-encoded. Deterministic for fixed inputs (bcrypt randomness lives in
     * salt generation, and the salt here is the fixed client secret).
     */
    static String signature(String clientId, String clientSecret, long timestampMillis) {
        String password = clientId + "_" + timestampMillis;
        String hashed;
        try {
            hashed = BCrypt.hashpw(password, clientSecret);
        } catch (IllegalArgumentException | StringIndexOutOfBoundsException e) {
            // BCrypt's own message can quote the salt — i.e. the client secret.
            // Replace it wholesale; never propagate the original.
            throw new IllegalStateException("네이버 client_secret이 전자서명 솔트 형식이 아닙니다.");
        }
        return Base64.getEncoder().encodeToString(hashed.getBytes(StandardCharsets.UTF_8));
    }

    /** Status-aware result of an auth-only credential check (test-connection). */
    public enum AuthCheck {
        /** Token minted — the credential is accepted by the provider. */
        OK,
        /** Credential/signature rejected (bad salt or 4xx other than 429). */
        INVALID,
        /** Throttled (HTTP 429) — transient, may succeed if retried. */
        RATE_LIMITED,
        /** Provider 5xx, network error, or an unreadable token body. */
        UNAVAILABLE
    }

    /**
     * Live, no-cache auth check for the test-connection verifier: mint a fresh
     * token to prove the provider accepts the credential, then discard it (the
     * token is never cached or returned). Status-aware so the caller can tell a
     * rejected credential from a transient provider problem. Never logs or
     * returns secret/token material; provider error bodies are never surfaced.
     */
    public AuthCheck verify(String clientId, String clientSecret) {
        long timestamp = clock.instant().toEpochMilli();
        String sign;
        try {
            sign = signature(clientId, clientSecret, timestamp);
        } catch (IllegalStateException e) {
            // client_secret is not a valid signature salt — a credential problem, pre-HTTP.
            return AuthCheck.INVALID;
        }
        Map<String, String> form = new LinkedHashMap<>();
        form.put("client_id", clientId);
        form.put("timestamp", String.valueOf(timestamp));
        form.put("client_secret_sign", sign);
        form.put("grant_type", "client_credentials");
        form.put("type", "SELF");

        NaverHttpClient.Response response;
        try {
            response = http.postForm(tokenUri, form);
        } catch (IllegalStateException e) {
            // JdkNaverHttpClient wraps network/interrupt failures as IllegalStateException.
            return AuthCheck.UNAVAILABLE;
        }

        int status = response.statusCode();
        if (status == 200) {
            try {
                NaverTokenResponse token = parse(response.body());
                boolean valid = token.accessToken() != null && !token.accessToken().isBlank();
                return valid ? AuthCheck.OK : AuthCheck.UNAVAILABLE;
            } catch (IllegalStateException e) {
                return AuthCheck.UNAVAILABLE;
            }
        }
        if (status == 429) {
            return AuthCheck.RATE_LIMITED;
        }
        if (status >= 500) {
            return AuthCheck.UNAVAILABLE;
        }
        // Other 4xx (400/401/403/…) — credential or signature rejected.
        return AuthCheck.INVALID;
    }

    private String mint(String clientId, String clientSecret, String cacheKey, Instant now) {
        long timestamp = now.toEpochMilli();
        Map<String, String> form = new LinkedHashMap<>();
        form.put("client_id", clientId);
        form.put("timestamp", String.valueOf(timestamp));
        form.put("client_secret_sign", signature(clientId, clientSecret, timestamp));
        form.put("grant_type", "client_credentials");
        form.put("type", "SELF");

        NaverHttpClient.Response response = http.postForm(tokenUri, form);
        if (response.statusCode() == 429) {
            throw NaverRateLimitedException.fromResponse(response);
        }
        if (response.statusCode() != 200) {
            throw new IllegalStateException(
                    "네이버 인증 토큰 발급에 실패했습니다 (HTTP " + response.statusCode() + ").");
        }

        NaverTokenResponse token = parse(response.body());
        if (token.accessToken() == null || token.accessToken().isBlank()
                || token.expiresIn() == null || token.expiresIn() <= 0) {
            throw new IllegalStateException("네이버 인증 토큰 응답을 해석할 수 없습니다.");
        }
        Instant expiresAt = now.plusSeconds(token.expiresIn()).minus(EXPIRY_SKEW);
        // A sub-skew TTL would cache an already-expired entry; serve it once instead.
        if (expiresAt.isAfter(now)) {
            cache.put(cacheKey, new CachedToken(token.accessToken(), expiresAt));
        }
        return token.accessToken();
    }

    private NaverTokenResponse parse(String body) {
        try {
            return mapper.readValue(body, NaverTokenResponse.class);
        } catch (Exception e) {
            // The body stays out of the message — a partially valid body could
            // already contain token material.
            throw new IllegalStateException("네이버 인증 토큰 응답을 해석할 수 없습니다.");
        }
    }

    private record CachedToken(String accessToken, Instant expiresAt) {

        @Override
        public String toString() {
            return "CachedToken[accessToken=<masked>, expiresAt=" + expiresAt + "]";
        }
    }
}
