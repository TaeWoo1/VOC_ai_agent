package com.sellerops.review.publish.cafe24;

import java.security.SecureRandom;

/**
 * The per-comment {@code password} the Cafe24 comments POST requires — outcome <b>A</b> of the audit
 * in {@code docs/cafe24_review_comment_execution_v1.md}: an author-chosen per-object secret, not an
 * account credential.
 *
 * <p>So it is generated fresh for the ONE request that needs it, used once, and discarded. It is never
 * stored, never hashed "for later", never logged: reviewnary never edits or deletes a comment, and a
 * secret nobody will ever present again is a secret nobody should be able to find. The contract's
 * bound is 1–20 characters; this emits 20 from an unambiguous alphabet.
 */
final class Cafe24CommentPassword {

    private static final SecureRandom RANDOM = new SecureRandom();
    private static final char[] ALPHABET =
            "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789".toCharArray();
    /** The contract's maximum. */
    static final int LENGTH = 20;

    private Cafe24CommentPassword() {
    }

    static String fresh() {
        StringBuilder sb = new StringBuilder(LENGTH);
        for (int i = 0; i < LENGTH; i++) {
            sb.append(ALPHABET[RANDOM.nextInt(ALPHABET.length)]);
        }
        return sb.toString();
    }
}
