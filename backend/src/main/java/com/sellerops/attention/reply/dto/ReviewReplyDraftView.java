package com.sellerops.attention.reply.dto;

import com.sellerops.attention.reply.ReviewReplyDraft;
import java.time.Instant;

/**
 * The current reply draft: its version, the operator-authored body, and the content
 * fingerprint (+ algorithm) so the client can pass a {@code baseVersion} on the next save and
 * bind an approval to an exact version.
 *
 * <p><b>Carries no provenance, though the row now does.</b> Since V90 the row records what wrote
 * each version — {@code SELLER}, {@code MODEL} or {@code RULE} — and this view deliberately does not
 * repeat it: the panel reads authorship and answer basis through {@code ReviewReplyPrepView}, which
 * is the read the screen actually renders, and a second copy here is a second thing to keep in step.
 * (An earlier version of this note said the row carried none. That stopped being true when V90 added
 * the columns, and stopped being true for hand-typed saves when the seller path began stamping
 * {@code ReviewReplyDraftService.Provenance#seller()} — see {@link ReviewReplyDraft}.)
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
