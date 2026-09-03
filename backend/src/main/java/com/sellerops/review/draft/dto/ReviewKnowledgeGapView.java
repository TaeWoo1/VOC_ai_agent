package com.sellerops.review.draft.dto;

/**
 * One thing reviewnary could not find, said as a question the seller can answer by registering it.
 *
 * <p><b>It is a closed structure, not a sentence to parse</b> (Grounded Review Drafting v1). The
 * screen renders {@code question} and routes on {@code scope} + {@code productId}; nothing reads the
 * Korean back out.
 *
 * <p><b>Nothing here is classified by a model, and nothing is invented.</b> {@code subject} is
 * whichever of three already-shipped signals was available, in order:
 * <ol>
 *   <li>the title of a repeated {@code ReviewIssue} this exact review is recorded evidence for —
 *       extracted by the issue pipeline, visible to the seller on the reviews screen;</li>
 *   <li>the seller-facing label of the {@code ReviewReplyTemplateKey} whose keyword matched — the
 *       same topic vocabulary the Template Settings screen shows;</li>
 *   <li>the customer's own words, quoted. Not a classification at all, and the reason this record
 *       can always be specific: the seller reads the sentence their customer wrote and knows exactly
 *       what knowledge is missing.</li>
 * </ol>
 * Tier 3 is where most reviews land, and that is correct rather than a shortfall — 「괜찮긴한데 잘
 * 떨어지네요」 matches no shipped keyword and belongs to no repeated issue, and guessing 「접착」 from
 * it would be the classifier this package refuses to build.
 *
 * @param scope      {@code PRODUCT} or {@code ORG} — which corpus is missing the answer
 * @param subject    what the ask is about, from the three tiers above
 * @param subjectKind {@code ISSUE} / {@code TOPIC} / {@code REVIEW_TEXT} — which tier {@code subject}
 *                   came from, so the screen can say where it got the words rather than implying
 *                   reviewnary understood the review
 * @param question   the seller-facing ask, composed from closed templates and {@code subject}
 * @param productId  the product to register it on, or null when this review resolves to none
 * @param candidateId the 확인 필요 row this ask was filed as, or null when nothing was filed —
 *                    <b>the identity that lets answering it here close exactly it</b> (Knowledge Gap
 *                    Continuity v1). An id and nothing else: closing is done by identity, never by
 *                    deciding that a sentence the seller just wrote resembles an ask.
 */
public record ReviewKnowledgeGapView(String scope, String subject, String subjectKind,
                                     String question, String productId, String candidateId) {

    /** The same ask, now carrying the 확인 필요 row it was filed as. */
    public ReviewKnowledgeGapView filedAs(String candidateId) {
        return new ReviewKnowledgeGapView(scope, subject, subjectKind, question, productId, candidateId);
    }
}
