package com.sellerops.attention.reply.dto;

/**
 * Everything the reply-preparation surface needs for one review, in one read.
 *
 * <p>{@code redactedBody} is the review's whole body with sensitive spans tokenized by
 * {@code VocPreviewSanitizer.redactFullBody} — NOT the raw column, and NOT the attention
 * list's 60-character {@code safePreview}. The list's preview exists to let an operator
 * recognise a row; this exists to let them read a complaint well enough to answer it, which a
 * truncated snippet cannot support. Product scope v1.4 §9 records the seller-facing exception
 * that authorizes it; the collector's sanitized-output contract is a different rule about a
 * different boundary and is untouched.
 *
 * <p>{@code bodyRedacted} says whether anything was tokenized, so the surface can tell the
 * operator that something was hidden rather than leave them puzzling over a {@code [번호]}
 * in text they are about to send a customer. {@code redactedBody} is null only when the source
 * was blank.
 *
 * <p>{@code draft} is null until the operator saves one; {@code approval} is null until they
 * approve one. Both nulls mean "not yet", never "not allowed" — {@code capabilities} is where
 * permission is stated.
 *
 * <p>{@code triageDisposition} echoes the review's current decision, so the surface can
 * explain WHY an affordance is unavailable ("대응 필요일 때만 저장할 수 있습니다") instead of
 * showing a dead control with no reason. It is the same value the attention row carries.
 *
 * <p>Deliberately carries no customer identity, no order/product identifier, no channel-side
 * id, and no raw timestamp beyond the draft's and approval's own — every field it does not
 * carry is a field that cannot leak.
 */
public record ReviewReplyPrepView(
        String actionRef,
        String redactedBody,
        boolean bodyRedacted,
        String triageDisposition,
        ReviewReplySuggestionView suggestion,
        ReviewReplyDraftView draft,
        ReviewReplyApprovalView approval,
        ReviewReplyCapabilities capabilities) {
}
