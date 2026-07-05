package com.sellerops.inquiry.reply;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Deterministic content fingerprint for a reply draft. It hashes a canonical JSON
 * form with a <b>stable key order</b>:
 *
 * <pre>{"schema":"esm-answer-v1","answerStatus":2,"title":&lt;t&gt;,"comments":&lt;c&gt;}</pre>
 *
 * where {@code title}/{@code comments} are already normalized. The digest is
 * SHA-256 (hex) and the scheme is tagged {@link EsmAnswerValidation#FINGERPRINT_ALGORITHM}.
 *
 * <p>The fingerprint deliberately covers <b>only</b> the seller-editable answer
 * fields plus the fixed schema/answerStatus — it never includes a token, messageNo,
 * author, or any buyer data, so it is safe to store, compare, and (later) bind an
 * approval to.
 */
public final class ReplyDraftFingerprint {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private ReplyDraftFingerprint() {
    }

    /** Fingerprint the normalized {@code title}/{@code comments}. */
    public static String of(String normalizedTitle, String normalizedComments) {
        Map<String, Object> canonical = new LinkedHashMap<>();
        canonical.put("schema", EsmAnswerValidation.SCHEMA);
        canonical.put("answerStatus", EsmAnswerValidation.ANSWER_STATUS);
        canonical.put("title", normalizedTitle);
        canonical.put("comments", normalizedComments);
        try {
            String json = MAPPER.writeValueAsString(canonical);
            return sha256Hex(json);
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
