package com.sellerops.connector.cafe24.spike;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.connector.cafe24.Cafe24HttpClient;
import java.net.URI;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Spike-only token exchange. It performs the same {@code refresh_token} grant as the
 * production {@code Cafe24TokenClient}, but additionally parses the {@code scope}/
 * {@code scopes} field the production DTO deliberately drops — so the spike can
 * VERIFY that {@code mall.write_community} was actually granted before it ever tries
 * a comment POST. Kept separate from production so the production token parsing is
 * untouched.
 *
 * <p>Reuses the production {@link Cafe24HttpClient} (the single vetted network
 * boundary) for the form POST. The raw scope string is turned into booleans by
 * {@link SpikeGrantedScope} and never logged or returned.
 */
public class SpikeTokenClient {

    private static final String TOKEN_PATH = "/api/v2/oauth/token";
    private static final Pattern MALL_ID_SHAPE =
            Pattern.compile("[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?");

    private final Cafe24HttpClient http;
    private final ObjectMapper mapper = new ObjectMapper();

    public SpikeTokenClient(Cafe24HttpClient http) {
        this.http = http;
    }

    /**
     * Refresh the spike credential and report the access token, the rotated refresh
     * token, and the granted-scope booleans.
     *
     * @throws SpikeTransportException on network / non-200 / unparseable response
     */
    public SpikeToken refresh(String mallId, String clientId, String clientSecret, String refreshToken) {
        URI uri = tokenUri(mallId);
        String basic = Base64.getEncoder()
                .encodeToString((clientId + ":" + clientSecret).getBytes(java.nio.charset.StandardCharsets.UTF_8));
        Map<String, String> headers = Map.of("Authorization", "Basic " + basic);
        Map<String, String> form = Map.of(
                "grant_type", "refresh_token",
                "refresh_token", refreshToken);

        Cafe24HttpClient.Response response = http.postForm(uri, headers, form);
        if (response.statusCode() != 200) {
            // Coarse, secret-free category — never the body.
            throw new SpikeTransportException("SPIKE_TOKEN_REFRESH_FAILED_HTTP_" + response.statusCode());
        }
        return parse(response.body());
    }

    /** The granted-scope string, space-joined from {@code scopes}[] or {@code scope}. */
    static String scopeString(TokenResponse token) {
        if (token.scopes() != null && !token.scopes().isEmpty()) {
            return String.join(" ", token.scopes());
        }
        return token.scope() == null ? "" : token.scope();
    }

    private SpikeToken parse(String body) {
        TokenResponse token;
        try {
            token = mapper.readValue(body, TokenResponse.class);
        } catch (Exception e) {
            // Body stays out of the message — it carries tokens.
            throw new SpikeTransportException("SPIKE_TOKEN_RESPONSE_UNPARSEABLE");
        }
        String scopes = scopeString(token);
        return new SpikeToken(token.accessToken(), token.refreshToken(),
                SpikeGrantedScope.writeCommunityGranted(scopes),
                SpikeGrantedScope.readCommunityGranted(scopes));
    }

    static URI tokenUri(String mallId) {
        if (mallId == null || !MALL_ID_SHAPE.matcher(mallId).matches()) {
            throw new SpikeTransportException("SPIKE_MALL_ID_SHAPE_INVALID");
        }
        return URI.create("https://" + mallId + ".cafe24api.com" + TOKEN_PATH);
    }

    /** Captures scope in addition to the tokens (unlike the production DTO). */
    @JsonIgnoreProperties(ignoreUnknown = true)
    record TokenResponse(
            @JsonProperty("access_token") String accessToken,
            @JsonProperty("refresh_token") String refreshToken,
            @JsonProperty("scopes") List<String> scopes,
            @JsonProperty("scope") String scope) {
    }
}
