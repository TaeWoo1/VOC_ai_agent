package com.sellerops.attention.reply.dto;

import com.sellerops.attention.reply.ReviewReplyDraft;
import java.time.Instant;

/**
 * The current reply draft: its version, the operator-authored body, and the content
 * fingerprint (+ algorithm) so the client can pass a {@code baseVersion} on the next save and
 * bind an approval to an exact version.
 *
 * <p>Carries no provenance triple, because the row carries none — once an operator has edited,
 * the text is theirs (see {@link ReviewReplyDraft}). The suggestion reports its provenance at
 * the moment it is offered, which is when the claim is true.
 */
public record ReviewReplyDraftView(
        int version,
        String body,
        String contentFingerprint,
        String fingerprintAlgorithm,
        Instant createdAt) {

    public static ReviewReplyDraftView of(ReviewReplyDraft d) {
        return new ReviewReplyDraftView(d.getVersion(), d.getBody(), d.getContentFingerprint(),
                d.getFingerprintAlgorithm(), d.getCreatedAt());
    }
}
