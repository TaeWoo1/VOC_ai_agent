package com.sellerops.inquiry.reply.dto;

import com.sellerops.inquiry.reply.InquiryReplyDraft;
import java.time.Instant;

/**
 * Seller-visible view of the current reply draft: the version, the fixed {@code
 * answerStatus}, the seller-owned {@code title}/{@code comments}, and the content
 * fingerprint (+ its algorithm) so the client can pass a {@code baseVersion} on the
 * next save and later bind an approval to an exact version. No token, author, or
 * buyer data.
 */
public record ReplyDraftView(
        int version,
        int answerStatus,
        String title,
        String comments,
        String contentFingerprint,
        String fingerprintAlgorithm,
        Instant createdAt) {

    public static ReplyDraftView of(InquiryReplyDraft d) {
        return new ReplyDraftView(
                d.getVersion(), d.getAnswerStatus(), d.getTitle(), d.getComments(),
                d.getContentFingerprint(), d.getFingerprintAlgorithm(), d.getCreatedAt());
    }
}
