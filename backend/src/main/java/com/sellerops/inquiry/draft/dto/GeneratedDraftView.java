package com.sellerops.inquiry.draft.dto;

import com.sellerops.inquiry.reply.dto.ReplyDraftView;
import java.util.List;
import java.util.UUID;

/**
 * The result of generating one reply draft: the saved version, who wrote it, what it was grounded
 * in, and — when the day's AI budget stopped the model — why the deterministic drafter wrote instead.
 *
 * <p>{@code draft.version} and {@code draft.contentFingerprint} are the pair an approval will later
 * bind to. They are returned here so the screen that shows the draft is showing the exact version it
 * would send, rather than a preview that a subsequent read might resolve differently.
 *
 * @param draft          the saved append-only version
 * @param authorKind     {@code MODEL} / {@code RULE} — never claimed as MODEL when no model ran
 * @param knowledgeState which of the four library states this draft was written under
 * @param knowledgeNote  that state as the one sentence shown above the draft
 * @param productId      the canonical product the retrieval was scoped to, or null
 * @param evidence       the passages actually put in front of the drafter, in order
 * @param quotaMessage   set only when the day's AI budget is what stopped the model
 */
public record GeneratedDraftView(ReplyDraftView draft, String authorKind, String knowledgeState,
                                 String knowledgeNote, UUID productId, List<DraftEvidenceView> evidence,
                                 String quotaMessage) {
}
