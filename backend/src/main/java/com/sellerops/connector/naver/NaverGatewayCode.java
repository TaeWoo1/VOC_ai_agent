package com.sellerops.connector.naver;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * The {@code code} scalar of a NAVER gateway error envelope — and nothing else from that envelope.
 *
 * <p>The gateway answers a refused call with {@code {"timestamp":…,"code":"GW.…","message":…,
 * "traceId":…}} (`docs/vendor/naver-commerce-api/intro-troubleshooting.md`, vendored 2026-07-22).
 * Only {@code code} is read here: it is a closed, documented set of {@code GW.}-prefixed constants,
 * so it carries no credential, no seller identifier and no page content, and the shape check below
 * refuses anything that does not look like one.
 *
 * <p><b>Why this class exists.</b> Until now the token endpoint threw every non-429 4xx away as
 * {@code CREDENTIAL_REJECTED} without ever reading the body. That collapsed two answers that call for
 * opposite actions: <em>this credential is wrong</em> (re-enter it) and <em>this caller's IP is not
 * registered</em> (the credential is fine; the environment is not). On 2026-08-24 the NAVER inquiry
 * recurrence proof stopped at exactly that fork with no way to tell which side it was on
 * (`docs/naver_inquiry_api_audit_v1.md` §12).
 *
 * <p>It is deliberately not an error taxonomy. One constant is recognised — the one the official table
 * names — and every other code is returned verbatim for diagnostics but classified as nothing.
 */
final class NaverGatewayCode {

    /**
     * 403 · "요청 IP가 API G/W 에서 허용한 IP가 아닌경우" — the official table's own row.
     *
     * <p>This is the one entry that is <b>not</b> a guess: it is read off the vendored copy of NAVER's
     * troubleshooting document rather than inferred from an observed failure. A credential is not what
     * this refuses, so nothing that sees it may ask the seller to re-enter one.
     */
    static final String IP_NOT_ALLOWED = "GW.IP_NOT_ALLOWED";

    /** Upper bound on a value we are willing to treat as a code at all. */
    private static final int MAX_CODE_LENGTH = 48;

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private NaverGatewayCode() {
    }

    /**
     * The envelope's {@code code}, or null when the body is absent, unparseable, has no scalar
     * {@code code}, or carries something that is not shaped like a gateway code.
     *
     * <p>The shape check is what keeps this safe to log: a body that answers with a free-text field
     * named {@code code} — or with a value long enough to be content rather than a constant — yields
     * null rather than a string of unknown provenance travelling into a log line.
     */
    static String of(String body) {
        if (body == null || body.isBlank()) {
            return null;
        }
        try {
            JsonNode root = MAPPER.readTree(body);
            JsonNode code = root == null ? null : root.get("code");
            if (code == null || !code.isValueNode()) {
                return null;
            }
            String value = code.asText();
            return looksLikeCode(value) ? value : null;
        } catch (Exception e) {
            return null;
        }
    }

    /** Upper-case letters, digits, underscore and dot only — the shape every documented code has. */
    private static boolean looksLikeCode(String value) {
        if (value == null || value.isBlank() || value.length() > MAX_CODE_LENGTH) {
            return false;
        }
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            boolean ok = (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c == '.';
            if (!ok) {
                return false;
            }
        }
        return true;
    }
}
