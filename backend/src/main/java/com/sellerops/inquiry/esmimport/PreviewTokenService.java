package com.sellerops.inquiry.esmimport;

import com.sellerops.common.ApiException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.Base64;
import java.util.UUID;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/**
 * Signs and verifies the ESM import preview token: a compact {@code payload.signature}
 * string where {@code payload} is a base64url-encoded canonical claim list and
 * {@code signature} is its HMAC-SHA256 under a server secret. Verification is
 * constant-time and enforces expiry. A tampered payload, a bad/absent signature, a
 * malformed token, or an expired token all fail closed with 400 — an unsigned or
 * plain hash is never accepted, because a valid token must carry a matching HMAC.
 *
 * <p>The clock is supplied by the caller (an {@link Instant}) rather than read here,
 * so issuance and expiry are fully deterministic under test.
 */
@Component
@ConditionalOnProperty(name = "sellerops.inquiry-import.esm.enabled", havingValue = "true")
public class PreviewTokenService {

    private static final String HMAC_ALG = "HmacSHA256";
    private static final String FIELD_SEP = "\n";

    /** Minimum acceptable secret length (bytes); a shorter/blank value fails closed. */
    private static final int MIN_SECRET_LENGTH = 32;

    private final byte[] secret;

    public PreviewTokenService(
            @Value("${sellerops.inquiry-import.preview-token.secret:}") String secret) {
        // Fail closed: with the import enabled, a missing or too-weak secret makes the
        // path unusable rather than signing tokens under a predictable/empty key. At
        // least 32 bytes of secret material is required.
        if (secret == null || secret.strip().getBytes(StandardCharsets.UTF_8).length < MIN_SECRET_LENGTH) {
            throw new IllegalStateException(
                    "ESM 미리보기 토큰 서명 비밀키가 없거나 너무 짧습니다 (최소 32바이트, "
                            + "SELLEROPS_INQUIRY_IMPORT_PREVIEW_TOKEN_SECRET).");
        }
        this.secret = secret.getBytes(StandardCharsets.UTF_8);
    }

    /** Encode + sign the claims into a {@code payload.signature} token. */
    public String issue(PreviewToken claims) {
        String payload = encodePayload(claims);
        String sig = base64Url(hmac(payload));
        return payload + "." + sig;
    }

    /**
     * Verify signature and expiry, returning the decoded claims. Throws {@link
     * ApiException} (400) on any tampering, malformed input, or expiry (evaluated
     * against {@code now}).
     */
    public PreviewToken verify(String token, Instant now) {
        if (token == null || token.isBlank()) {
            throw ApiException.badRequest("미리보기 토큰이 없습니다.");
        }
        int dot = token.indexOf('.');
        if (dot <= 0 || dot == token.length() - 1) {
            throw ApiException.badRequest("미리보기 토큰 형식이 올바르지 않습니다.");
        }
        String payload = token.substring(0, dot);
        String sig = token.substring(dot + 1);
        byte[] expected = hmac(payload);
        byte[] provided;
        try {
            provided = Base64.getUrlDecoder().decode(sig);
        } catch (IllegalArgumentException e) {
            throw ApiException.badRequest("미리보기 토큰 서명이 올바르지 않습니다.");
        }
        // Constant-time comparison; a mismatched or unsigned token never verifies.
        if (!MessageDigest.isEqual(expected, provided)) {
            throw ApiException.badRequest("미리보기 토큰 서명이 일치하지 않습니다.");
        }
        PreviewToken claims = decodePayload(payload);
        if (now.toEpochMilli() > claims.expiresAtEpochMs()) {
            throw ApiException.badRequest("미리보기 토큰이 만료되었습니다. 다시 미리보기를 실행해 주세요.");
        }
        return claims;
    }

    private String encodePayload(PreviewToken c) {
        String raw = String.join(FIELD_SEP,
                c.orgId().toString(),
                c.sellerAccountId().toString(),
                c.marketplace().name(),
                c.fileHash(),
                c.headerSignature(),
                Integer.toString(c.rowCount()),
                c.canonicalPreviewHash(),
                c.existingStateHash(),
                Long.toString(c.issuedAtEpochMs()),
                Long.toString(c.expiresAtEpochMs()));
        return base64Url(raw.getBytes(StandardCharsets.UTF_8));
    }

    private PreviewToken decodePayload(String payload) {
        try {
            String raw = new String(Base64.getUrlDecoder().decode(payload), StandardCharsets.UTF_8);
            String[] f = raw.split(FIELD_SEP, -1);
            if (f.length != 10) {
                throw ApiException.badRequest("미리보기 토큰 내용이 올바르지 않습니다.");
            }
            return new PreviewToken(
                    UUID.fromString(f[0]),
                    UUID.fromString(f[1]),
                    EsmMarketplace.valueOf(f[2]),
                    f[3],
                    f[4],
                    Integer.parseInt(f[5]),
                    f[6],
                    f[7],
                    Long.parseLong(f[8]),
                    Long.parseLong(f[9]));
        } catch (ApiException e) {
            throw e;
        } catch (Exception e) {
            throw ApiException.badRequest("미리보기 토큰 내용을 해석할 수 없습니다.");
        }
    }

    private byte[] hmac(String payload) {
        try {
            Mac mac = Mac.getInstance(HMAC_ALG);
            mac.init(new SecretKeySpec(secret, HMAC_ALG));
            return mac.doFinal(payload.getBytes(StandardCharsets.UTF_8));
        } catch (Exception e) {
            throw new IllegalStateException("미리보기 토큰 서명에 실패했습니다.", e);
        }
    }

    private static String base64Url(byte[] bytes) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }
}
