package com.sellerops.operationscase;

import com.sellerops.inquiry.Inquiry;
import com.sellerops.review.Review;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.UUID;

/**
 * The identity of a customer signal: <b>what the customer's side of the record says</b>, not where the work stands.
 *
 * <p><b>Status is deliberately not in it.</b> An inquiry going from UNANSWERED to ANSWERED, a review getting a
 * reply, a work item moving on — those are the seller's work progressing, and the reconciler reads them against the
 * case that already exists. Putting them in the signal would turn «the seller answered» into «a new signal arrived»
 * and open a second case to say there is nothing to do. What IS here is what makes the customer's matter a
 * different matter: the content, the rating, the product it was tied to, and whether it is a question at all.
 *
 * <p>States and digests only — never content. The state string is stored beside its hash so a changed case can be
 * explained; hashing a sentence keeps the sentence out of the column.
 */
public final class OperationsSignal {

    private OperationsSignal() {
    }

    public static String inquiryState(Inquiry inquiry) {
        String content = inquiry.getContentHash() != null && !inquiry.getContentHash().isBlank()
                ? inquiry.getContentHash()
                : digest(nullSafe(inquiry.getTitle()) + "\n" + nullSafe(inquiry.getBody()));
        return "rr:inquiry;content=" + shortDigest(content)
                + ";product=" + (inquiry.getProductId() == null ? "-" : inquiry.getProductId())
                + ";thread=" + (inquiry.getThreadRole() == null ? "-" : inquiry.getThreadRole());
    }

    public static String reviewState(Review review) {
        // Cafe24 reviews are deduplicated by external id and carry no content hash, so the body is digested here.
        return "rr:review;rating=" + (review.getRating() == null ? "-" : review.getRating())
                + ";content=" + shortDigest(digest(nullSafe(review.getBody())))
                + ";product=" + (review.getProductId() == null ? "-" : review.getProductId());
    }

    /** A gap's state: its failure family and the data types it blocked. */
    public static String gapState(String family, String dataTypes) {
        return "rr:gap;family=" + family + ";types=" + dataTypes;
    }

    /**
     * sha256 over org + kind + subject + state (+ an episode id for a gap), hex.
     *
     * <p>A gap carries the run that first saw it: the same source failing for the same reason after a recovery is a
     * new episode and must be allowed a new case, while repeats inside one episode must find the open one.
     */
    public static String signature(UUID orgId, OperationsSubjectKind kind, UUID subjectId, String state,
                                   UUID episode) {
        return digest("rr|" + orgId + "|" + kind.name() + "|" + subjectId + "|" + state
                + (episode == null ? "" : "|" + episode));
    }

    static String truncate(String state) {
        return state != null && state.length() > 200 ? state.substring(0, 200) : state;
    }

    static String digest(String material) {
        try {
            byte[] bytes = MessageDigest.getInstance("SHA-256").digest(material.getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder(64);
            for (byte b : bytes) {
                hex.append(Character.forDigit((b >> 4) & 0xF, 16)).append(Character.forDigit(b & 0xF, 16));
            }
            return hex.toString();
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException("SHA-256을 사용할 수 없습니다.", impossible);
        }
    }

    private static String shortDigest(String value) {
        return value.length() > 16 ? value.substring(0, 16) : value;
    }

    private static String nullSafe(String value) {
        return value == null ? "" : value;
    }
}
