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
 * <p>{@code outcome} (v1.6) is the operator-reported result for the CURRENT approved reply, or null
 * if none has been recorded (or nothing is approved). It carries {@code operatorOutcome} AND
 * {@code verification} as two separate facts — the surface renders the pair, never
 * {@code UNVERIFIED} alone, and never anything that reads as "완료".
 *
 * <p>{@code triageDisposition} echoes the review's current decision, so the surface can
 * explain WHY an affordance is unavailable ("대응 필요일 때만 저장할 수 있습니다") instead of
 * showing a dead control with no reason. It is the same value the attention row carries.
 *
 * <p>{@code channelReviewIdFingerprint} is a one-way {@code review-id-fingerprint/v1} digest of the
 * review's channel-side id ({@code reviews.external_id}; for NAVER, the export's {@code 리뷰글번호}),
 * or null when the review was ingested without one. It exists so a guided runtime can prove the row
 * it is looking at in the seller center is <b>this</b> review — an identity match, rather than the
 * coarse (rating, date-bucket, body-fingerprint) narrowing the target hint supports — <b>without the
 * raw id ever crossing this boundary</b>. It is domain-separated, so it can never be confused with
 * the body fingerprint. See {@code contracts/review-id-fingerprint/v1/SPEC.md}, including its honest
 * note that a 10-digit id space is enumerable: this is leak hygiene, not a privacy guarantee.
 *
 * <p>{@code rating} is the review's coarse 1..5 star rating, or null when the source row carried none.
 * It is the non-identifying secondary fact a guided runtime asserts <b>after</b> an identity match, to
 * catch a stale candidate set. It adds no new exposure: the same value is already on the attention row
 * ({@code OperatorVocItem.rating}) and in the target hint.
 *
 * <p>{@code productName} and {@code reviewDate} exist so the operator can FIND this review in the
 * seller center. SellerOps does not post the reply and, with no guided runtime, does not navigate
 * anywhere either — so the panel telling someone to "paste it into the reply box" owes them enough to
 * locate the row. These are exactly the coarse narrowing facts this DTO's fingerprint note already
 * describes as the fallback when an identity match is unavailable.
 *
 * <p>They add NO new exposure: both are already on the attention row the operator clicked through
 * ({@code OperatorVocItem.productName} / {@code sourceCreatedDate}), and {@code productName} is a
 * DISPLAY name resolved by the same shared rule ({@code OperatorProductName}) — never a SKU, never a
 * {@code productNo}. Null when no name can be resolved honestly, or when the review carried no date.
 *
 * <p>{@code reviewDate} is a KST calendar date (date only). No time: internal timing never surfaces,
 * and a date is what a seller scans a review list by.
 *
 * <p>{@code channelReplyState} is what the CHANNEL last said about an existing reply
 * ({@code PENDING} / {@code ANSWERED} / {@code UNKNOWN}, from the import's {@code 답글여부}) — never
 * SellerOps' own record of a guided reply, which is {@code outcome}. It exists for the same reason as
 * {@code triageDisposition}: when {@code canStartSubmissionRun} is false because the channel already
 * has a reply, the surface can say so instead of showing a dead control. A closed enum name only —
 * no reply text, no reply timestamp.
 *
 * <p>Deliberately carries no customer identity, no order/product identifier, no <b>raw</b>
 * channel-side id, and no raw timestamp beyond the draft's and approval's own — every field it does
 * not carry is a field that cannot leak.
 */
public record ReviewReplyPrepView(
        String actionRef,
        String redactedBody,
        boolean bodyRedacted,
        String triageDisposition,
        ReviewReplySuggestionView suggestion,
        ReviewReplyDraftView draft,
        ReviewReplyApprovalView approval,
        ReviewReplyOutcomeView outcome,
        ReviewReplyCapabilities capabilities,
        String channelReviewIdFingerprint,
        Integer rating,
        String channelReplyState,
        String productName,
        String reviewDate) {
}
