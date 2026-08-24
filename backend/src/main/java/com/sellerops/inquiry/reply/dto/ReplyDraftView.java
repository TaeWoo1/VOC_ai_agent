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
        Instant createdAt,
        String authorKind,
        String modelVersion,
        String knowledgeState,
        String knowledgeNote) {

    public static ReplyDraftView of(InquiryReplyDraft d) {
        // A version written before Inquiry Draft v1 has no author_kind. Every one of those was typed
        // by a person, so it reads as SELLER — stated at the boundary rather than backfilled into the
        // table, because a value written by a migration cannot be distinguished later from one that
        // was observed.
        String authorKind = d.getAuthorKind() == null
                ? com.sellerops.inquiry.draft.DraftAuthorKind.SELLER.name() : d.getAuthorKind();
        String note = null;
        if (d.getKnowledgeState() != null) {
            try {
                note = com.sellerops.inquiry.draft.DraftKnowledgeState.valueOf(d.getKnowledgeState()).messageKo();
            } catch (IllegalArgumentException unknown) {
                note = null; // a value this build does not know is not a sentence it can write
            }
        }
        return new ReplyDraftView(
                d.getVersion(), d.getAnswerStatus(), d.getTitle(), d.getComments(),
                d.getContentFingerprint(), d.getFingerprintAlgorithm(), d.getCreatedAt(),
                authorKind, d.getModelVersion(), d.getKnowledgeState(), note);
    }
}
