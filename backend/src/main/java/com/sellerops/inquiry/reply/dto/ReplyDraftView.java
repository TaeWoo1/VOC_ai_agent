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
        String knowledgeNote,
        String answerBasis,
        String answerBasisNote,
        String answerBasisAction) {

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
        // What this version WAS. Read back rather than re-derived: the state depends on whether the
        // customer had settled their 규격, which this row does not hold and the screen must not guess.
        // A version written before the column existed carries null, and every field below stays null
        // — "not recorded" is a different statement from any of the three states.
        com.sellerops.inquiry.draft.AnswerBasisState basis = null;
        if (d.getAnswerBasis() != null) {
            try {
                basis = com.sellerops.inquiry.draft.AnswerBasisState.valueOf(d.getAnswerBasis());
            } catch (IllegalArgumentException unknown) {
                basis = null;   // a value this build does not know is not a state it can describe
            }
        }
        com.sellerops.inquiry.draft.DraftKnowledgeState knowledge = null;
        if (d.getKnowledgeState() != null) {
            try {
                knowledge = com.sellerops.inquiry.draft.DraftKnowledgeState.valueOf(d.getKnowledgeState());
            } catch (IllegalArgumentException unknown) {
                knowledge = null;
            }
        }
        // The general line, never the one that quotes the customer's own noun: the word they used is
        // not stored here and re-deriving it would mean re-reading their message. A vaguer sentence
        // on a reload is the honest form of a fact we recorded vaguely.
        String basisAction = basis == null ? null : basis.actionKo(knowledge);
        return new ReplyDraftView(
                d.getVersion(), d.getAnswerStatus(), d.getTitle(), d.getComments(),
                d.getContentFingerprint(), d.getFingerprintAlgorithm(), d.getCreatedAt(),
                authorKind, d.getModelVersion(), d.getKnowledgeState(), note,
                basis == null ? null : basis.name(),
                basis == null ? null : basis.messageKo(),
                basisAction);
    }
}
