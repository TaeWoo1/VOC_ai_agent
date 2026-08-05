package com.sellerops.connector.cafe24;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Set;

/**
 * A non-2xx, non-429 failure from a Cafe24 OAuth token endpoint (refresh grant or
 * authorization-code exchange), classified <b>only</b> by the RFC 6749 / RFC 6750
 * <i>standard</i> {@code error} field — never by a guessed Cafe24-proprietary code.
 *
 * <p>The distinction matters for the seller. A dead/revoked/expired refresh token
 * ({@code invalid_grant}) means "reconnect"; an app whose granted scopes do not cover
 * the requested read ({@code invalid_scope} / {@code insufficient_scope}) means "the
 * connection is authorized but a permission is missing" — a different fix. Collapsing
 * both into one "reconnect" bucket (the prior behaviour) mis-guides the scope case.
 *
 * <p><b>Recognized codes are the OAuth2 standard set only</b> ({@link #RECOGNIZED}).
 * These are defined by RFC 6749 §5.2 and RFC 6750 §3.1, not invented here, so relying
 * on them is standards-based rather than a guess about Cafe24's wire format. Any other
 * or unparseable {@code error} value maps to {@link Kind#UNKNOWN}, which downstream
 * treats exactly as the old generic failure — a strictly conservative fallback that
 * assumes nothing.
 *
 * <p><b>Sanitized.</b> Only the HTTP status and the recognized standard code (which is
 * not secret) ever appear in the message. {@code error_description} — free provider text
 * that could carry arbitrary content — is never read into the message. There is no
 * logger here by design.
 */
public class Cafe24OAuthException extends RuntimeException {

    /** How the failure should be handled downstream. */
    public enum Kind {
        /** Refresh token invalid/expired/revoked (RFC 6749 {@code invalid_grant}) → reconnect. */
        INVALID_GRANT,
        /** Granted scopes insufficient for the read ({@code invalid_scope}/{@code insufficient_scope}). */
        INSUFFICIENT_SCOPE,
        /** Unrecognized or unparseable error — handled as a generic provider failure (assumes nothing). */
        UNKNOWN
    }

    /**
     * The exhaustive set of OAuth2-standard token-error codes this connector acts on.
     * Everything else is {@link Kind#UNKNOWN}. Kept deliberately small: no Cafe24-specific
     * code is added here without live confirmation, mirroring the connector's "no guessed
     * codes" discipline.
     */
    private static final Set<String> RECOGNIZED =
            Set.of("invalid_grant", "invalid_scope", "insufficient_scope");

    private static final long serialVersionUID = 1L;

    private final Kind kind;
    private final int statusCode;

    private Cafe24OAuthException(Kind kind, int statusCode, String message) {
        super(message);
        this.kind = kind;
        this.statusCode = statusCode;
    }

    public Kind kind() {
        return kind;
    }

    public int statusCode() {
        return statusCode;
    }

    /**
     * Build a classified exception from a token-endpoint error response. The body is parsed
     * only for the standard {@code error} field; a recognized value sets the kind, anything
     * else (including an unparseable body) is {@link Kind#UNKNOWN}.
     */
    public static Cafe24OAuthException fromTokenError(int statusCode, String body, ObjectMapper mapper) {
        String code = standardErrorCode(body, mapper);
        Kind kind;
        if ("invalid_grant".equals(code)) {
            kind = Kind.INVALID_GRANT;
        } else if ("invalid_scope".equals(code) || "insufficient_scope".equals(code)) {
            kind = Kind.INSUFFICIENT_SCOPE;
        } else {
            kind = Kind.UNKNOWN;
        }
        String suffix = code == null ? "" : ", error=" + code;
        return new Cafe24OAuthException(kind, statusCode,
                "카페24 인증 토큰 요청이 실패했습니다 (HTTP " + statusCode + suffix + ").");
    }

    /**
     * Extract the RFC 6749 {@code error} value only when it is one of the recognized standard
     * codes; otherwise null. Never returns {@code error_description} or any other field, so no
     * arbitrary provider text can reach a message or log.
     */
    private static String standardErrorCode(String body, ObjectMapper mapper) {
        if (body == null || body.isBlank()) {
            return null;
        }
        try {
            JsonNode root = mapper.readTree(body);
            JsonNode error = root.get("error");
            if (error != null && error.isTextual()) {
                String value = error.asText();
                if (RECOGNIZED.contains(value)) {
                    return value;
                }
            }
        } catch (Exception ignored) {
            // Unparseable / non-JSON body → treated as UNKNOWN. The body never reaches a message.
        }
        return null;
    }
}
