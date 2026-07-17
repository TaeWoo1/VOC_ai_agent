package com.sellerops.attention.reply;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Deterministic content fingerprint for a review reply draft. It hashes a canonical JSON form
 * with a <b>stable key order</b>:
 *
 * <pre>{"schema":"review-reply-v1","body":&lt;b&gt;}</pre>
 *
 * where {@code body} is already normalized. The digest is SHA-256 (hex) and the scheme is
 * tagged {@link ReviewReplyValidation#FINGERPRINT_ALGORITHM}.
 *
 * <p>A near-duplicate of {@code inquiry.reply.ReplyDraftFingerprint} — same algorithm, same
 * canonical-JSON approach, different schema and fields — and that duplication is chosen rather
 * than overlooked. Generalising the two would mean editing a class that a live, tested
 * inquiry publish path binds its approvals to, in order to save a few lines on a surface that
 * publishes nothing. The schema tag is what keeps them from ever being confused for one
 * another; the shared shape is what keeps them readable side by side. If a third fingerprint
 * appears, extracting the digest helper then will be safe in a way it is not now.
 *
 * <p>The fingerprint covers only the operator-authored body plus the schema tag — no review
 * id, no actor, no timestamp — so identical text fingerprints identically, which is exactly
 * what an idempotent re-save needs to recognise.
 */
public final class ReviewReplyFingerprint {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private ReviewReplyFingerprint() {
    }

    /** Fingerprint the normalized {@code body}. */
    public static String of(String normalizedBody) {
        Map<String, Object> canonical = new LinkedHashMap<>();
        canonical.put("schema", ReviewReplyValidation.SCHEMA);
        canonical.put("body", normalizedBody);
        try {
            return sha256Hex(MAPPER.writeValueAsString(canonical));
        } catch (Exception e) {
            // Message only — never echo the content.
            throw new IllegalStateException("초안 지문을 생성할 수 없습니다.");
        }
    }

    private static String sha256Hex(String input) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(input.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder(digest.length * 2);
            for (byte b : digest) {
                sb.append(Character.forDigit((b >> 4) & 0xF, 16));
                sb.append(Character.forDigit(b & 0xF, 16));
            }
            return sb.toString();
        } catch (Exception e) {
            throw new IllegalStateException("초안 지문을 생성할 수 없습니다.");
        }
    }
}
