package com.sellerops.proactive;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.UUID;

/**
 * The dedupe identity of a proactive investigation: <b>org + subject + the source state it was
 * performed against</b>.
 *
 * <p><b>Why the state is in the key.</b> Without it, "already investigated" and "still true" are the
 * same test, and the first is the wrong one: an inquiry investigated while it had no product link,
 * then bound to a product, deserves a fresh investigation — the evidence available to it changed. With
 * it, a tick over an unchanged source writes nothing at all (the unique index absorbs the retry), and
 * a changed source produces a new case while the old one is closed as {@link
 * ProactiveCloseReason#SUPERSEDED} rather than edited in place.
 *
 * <p><b>The state string is states, never content.</b> It is stored beside the hash and shown to
 * nobody; hashing content would put a customer's words into a column that outlives them for no gain,
 * since the operational fields already change whenever the meaningful state does.
 */
public final class ProactiveSignature {

    private ProactiveSignature() {
    }

    /** The state string for an inquiry candidate — every field that changes what an investigation would find. */
    public static String inquiryState(String status, String operationalState, String threadRole,
                                      UUID productId, String contentHash) {
        return "status=" + nullSafe(status)
                + ";op=" + nullSafe(operationalState)
                + ";thread=" + nullSafe(threadRole)
                + ";product=" + (productId == null ? "-" : productId)
                + ";hash=" + nullSafe(contentHash);
    }

    /** The state string for a review candidate. */
    public static String reviewState(Integer rating, String replyState, UUID productId, String contentHash) {
        return "rating=" + (rating == null ? "-" : rating)
                + ";reply=" + nullSafe(replyState)
                + ";product=" + (productId == null ? "-" : productId)
                + ";hash=" + nullSafe(contentHash);
    }

    /** sha256 of the identity, hex — the value stored in {@code proactive_case.signature}. */
    public static String of(UUID orgId, ProactiveSubjectKind kind, UUID subjectId, String sourceState) {
        String material = orgId + "|" + kind.name() + "|" + subjectId + "|" + sourceState;
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(material.getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder(64);
            for (byte b : digest) {
                hex.append(Character.forDigit((b >> 4) & 0xF, 16)).append(Character.forDigit(b & 0xF, 16));
            }
            return hex.toString();
        } catch (NoSuchAlgorithmException impossible) {
            // SHA-256 is required of every JVM. If it is genuinely absent, failing closed is the only
            // honest option: a weaker digest would make two different states share a card.
            throw new IllegalStateException("SHA-256을 사용할 수 없습니다.", impossible);
        }
    }

    /** Truncated to the column's width, so a long state can never fail the insert silently. */
    public static String truncateState(String state) {
        return state != null && state.length() > 200 ? state.substring(0, 200) : state;
    }

    private static String nullSafe(String value) {
        return value == null || value.isBlank() ? "-" : value;
    }
}
