package com.sellerops.attention.reply;

import java.nio.charset.StandardCharsets;

/**
 * Validation contract + constants for a review reply draft.
 *
 * <p><b>{@link #BODY_MAX_BYTES} is a SellerOps storage-sanity bound, NOT a channel limit.</b>
 * That distinction is the whole reason this class exists separately from
 * {@code EsmAnswerValidation}, which can say its {@code COMMENTS_MAX_BYTES} is "the official
 * ESM answer body limit" because ESM documents one. NAVER's review-reply limit is not
 * verified in this repository, and inventing a number here would encode a channel fact
 * nobody checked — the operator would then trust a limit the product made up, and discover
 * the real one by having their reply rejected when they pasted it. So this bounds what
 * SellerOps will store and claims nothing about what any marketplace accepts. If a real
 * limit is ever verified, it belongs here with a citation, and the UI can say so.
 *
 * <p>The body is normalized (CRLF/CR &rarr; LF, outer whitespace trimmed) before validation,
 * persistence, and fingerprinting, so the same intent always yields the same stored value and
 * the same fingerprint — which is what lets an approval bind to content rather than to a
 * keystroke sequence.
 */
public final class ReviewReplyValidation {

    /**
     * Storage-sanity cap for a reply body in UTF-8 bytes. Not a marketplace limit (see the
     * class note). Generous on purpose: it exists to stop a pathological write, not to shape
     * what an operator may say.
     */
    public static final int BODY_MAX_BYTES = 4000;

    /** Fingerprint scheme + algorithm tag (see {@link ReviewReplyFingerprint}). */
    public static final String SCHEMA = "review-reply-v1";
    public static final String FINGERPRINT_ALGORITHM = "review-reply-v1";

    private ReviewReplyValidation() {
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
