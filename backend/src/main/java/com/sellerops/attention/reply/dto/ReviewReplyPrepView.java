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
        String reviewDate,
        /**
         * What wrote the head draft — {@code SELLER}, {@code MODEL}, {@code RULE}, or null for a
         * version written before reviewnary recorded an author (Grounded Review Drafting v1). Null is
         * «not recorded», never «a person typed it»: the screen says nothing rather than guessing.
         *
         * <p><b>{@code SELLER} became reachable when the hand-typed path began stamping
         * {@code ReviewReplyDraftService.Provenance#seller()}.</b> Before that a person's version was
         * stored with {@code author_kind IS NULL} and arrived here as null, so this field could only
         * ever carry the two machine authors and said so. It now carries three, and the distinction
         * that matters to the screen is between {@code SELLER} and the other two: a draft the seller
         * wrote is not one they have to check.
         *
         * <p><b>Null and {@code RULE} are different reports and the screen must not merge them.</b>
         * {@code RULE} says a stored template produced this text; null says nobody recorded an author.
         * The template sentence spoken over a null draft is a claim about authorship that no row
         * supports — which is exactly the shape of error this column exists to make impossible.
         */
        String draftAuthorKind,
        /**
         * What the head draft was written FROM, in the order the drafter was shown it — the stored
         * citations, with their excerpts read back from the source documents at display time.
         *
         * <p>Empty for a template-floor draft and for every version written before V90, which are
         * the same honest report: nothing was shown to a model, because none was called.
         */
        java.util.List<com.sellerops.inquiry.draft.dto.DraftEvidenceView> draftEvidence,
        /**
         * What the head draft was written FROM, as a state — {@code GROUNDED} or
         * {@code NO_ANSWER_BASIS}, or null for a version written before the column existed (or one a
         * person typed, which records no basis because none was decided).
         *
         * <p>Retrieval Runtime Closure v1 §1: the row has carried this since Grounded Review
         * Drafting v1 and nothing read it back, so 「근거 있음 / 기본 문구」 lived only in the browser
         * session that pressed the button. A seller who reloaded saw the draft and its citations with
         * no statement of whether it had been grounded — the one fact that decides whether the text
         * below is this company's knowledge or its safe default.
         */
        String draftAnswerBasis,
        /** The seller-facing sentence for {@code draftAnswerBasis}, chosen by the same rule that
         *  chose it at generation ({@code ReviewDraftComposer#basisNoteOf}). Null when the basis is. */
        String draftAnswerBasisNote,
        /**
         * Why the GUIDED reply run is not on offer for a review whose reply is otherwise ready to go —
         * a closed vocabulary, null when it IS on offer (or when there is nothing approved to send yet,
         * which the panel already explains by showing the approve step).
         *
         * <p>{@code SOURCE_NOT_EXECUTABLE}: the review did not arrive through an acquisition that can
         * prove its channel-side identity, so no run may look for it on the seller's screen — the
         * reply is copied and posted by hand instead. Before this field the server simply left
         * {@code canStartSubmissionRun} true and refused when the run asked for a target: the seller
         * pressed 「네이버에서 직접 답변하기」 and got 「답변 준비를 시작하지 못했습니다. 다시 시도해
         * 주세요.」 — an error inviting a retry that could never succeed.
         *
         * <p>{@code CHANNEL_ALREADY_ANSWERED}: the channel reports a reply already posted, so guiding
         * one more is how a public double-reply happens.
         *
         * <p>The provenance vocabulary itself ({@code ExecutableIdentity}, MARKETPLACE/NONE) stays on
         * this side of the wire; what crosses is the consequence, and the surface turns that into a
         * sentence about what the seller can do next.
         */
        String guidedUnavailableReason) {
}
