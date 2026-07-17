package com.sellerops.attention.reply.dto;

/**
 * A suggested reply the operator can start from — computed read-time and <b>never persisted</b>.
 *
 * <p>Recomputed on every read rather than stored, which is safe because it is a pure function
 * of the review's own (write-once) body and rating: the same review always yields the same
 * suggestion. Storing it would create a second copy of text nobody authored, and a "draft"
 * row the operator never wrote — so the drill-down would report a draft exists when all that
 * happened is that someone opened the panel.
 *
 * <p>The provenance triple is carried so the surface can label the suggestion honestly at the
 * moment it is offered (규칙 기반 — Frontend Spec §10.3). It is not carried on a saved draft,
 * because once the operator edits, the text is theirs.
 */
public record ReviewReplySuggestionView(
        String body,
        String category,
        String providerKind,
        String providerName,
        String providerVersion) {
}
