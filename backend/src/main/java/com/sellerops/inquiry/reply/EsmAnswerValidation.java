package com.sellerops.inquiry.reply;

import java.nio.charset.StandardCharsets;

/**
 * Validation contract + constants for a seller ESM answer reply-draft. This slice
 * persists the draft only — no ESM send, no token — so these bound what the seller
 * may save, mirroring the official ESM answer contract where it is documented.
 *
 * <ul>
 *   <li>{@link #ANSWER_STATUS} is <b>backend-fixed</b> to {@code 2}; the seller
 *       edits only title/comments. (The reply {@code answerStatus} enum is {@code
 *       1|2}; the DB check allows both.)</li>
 *   <li>{@link #COMMENTS_MAX_BYTES} = 1000 is the <b>official</b> ESM answer body
 *       limit (UTF-8 bytes).</li>
 *   <li>{@link #TITLE_MAX_BYTES} is a <b>SellerOps internal safety cap</b>, not an
 *       official ESM limit — the official title limit is undocumented, so we do not
 *       invent one and instead bound the title conservatively.</li>
 * </ul>
 *
 * <p>Both fields are normalized (CRLF/CR &rarr; LF, outer whitespace trimmed) before
 * validation, persistence, and fingerprinting, so the same intent always yields the
 * same stored value and fingerprint.
 */
public final class EsmAnswerValidation {

    /** Backend-fixed reply answerStatus for this slice (EsmCsReplyAnswerStatus). */
    public static final int ANSWER_STATUS = 2;

    /** Official ESM answer-body limit in UTF-8 bytes (ESM_CS_ANSWER_MAX_BYTES). */
    public static final int COMMENTS_MAX_BYTES = 1000;

    /**
     * SellerOps internal safety cap for the title in UTF-8 bytes. NOT an official
     * ESM limit (the official title limit is undocumented); a conservative bound to
     * keep titles short without inventing a spec value.
     */
    public static final int TITLE_MAX_BYTES = 200;

    /** Fingerprint scheme + algorithm tag (see {@link ReplyDraftFingerprint}). */
    public static final String SCHEMA = "esm-answer-v1";
    public static final String FINGERPRINT_ALGORITHM = "esm-answer-v1";

    private EsmAnswerValidation() {
    }

    /** Normalize line endings to {@code \n} and trim outer whitespace. */
    public static String normalize(String value) {
        if (value == null) {
            return "";
        }
        return value.replace("\r\n", "\n").replace("\r", "\n").strip();
    }

    public static int utf8Bytes(String value) {
        return value.getBytes(StandardCharsets.UTF_8).length;
    }

    public static boolean isBlank(String value) {
        return value == null || value.isEmpty();
    }
}
