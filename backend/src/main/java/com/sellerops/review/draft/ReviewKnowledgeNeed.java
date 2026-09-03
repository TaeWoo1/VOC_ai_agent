package com.sellerops.review.draft;

import com.sellerops.knowledge.QuestionShape;
import com.sellerops.knowledge.RetrievalOutcome;

/**
 * <b>「근거를 못 찾았다」와 「기준이 필요하다」는 다른 말이다.</b>
 * (Knowledge Sources &amp; Acquisition v1 §E, 2026-09-03)
 *
 * <p>Grounded Review Drafting v1 asked the seller for knowledge on every floor draft, which is right
 * for 「자꾸 떨어집니다」 and noise for 「좋아요 아주 만족합니다」. A compliment needs no factual basis: the
 * thank-you IS the complete, correct, publishable answer, and telling the seller to go register a
 * standard for it is telling them their library is deficient because a customer was happy.
 *
 * <p><b>What separates them is not the retrieval result.</b> The retrieval says the same thing about
 * both — nothing covered this review. So the question is not «did we find evidence» but «was an answer
 * OWED», and the honest way to decide that is from signals the product already has and the seller can
 * already see:
 *
 * <ol>
 *   <li><b>The product has no knowledge at all.</b> Worth saying once, whatever the review says — this
 *       is onboarding, not a complaint about this review.</li>
 *   <li><b>This review is recorded evidence for a repeated problem.</b> The issue extractor decided
 *       that; it is on the reviews screen; it means the customer described something that keeps
 *       happening.</li>
 *   <li><b>The rating is below the praise threshold.</b> The same threshold the template selection has
 *       used since it was written — at ★4+ this product does not read a review as a complaint, and
 *       {@code RuleBasedReviewReplyProvider} explains at length why a topic keyword must not overturn
 *       that.</li>
 * </ol>
 *
 * <p><b>What this deliberately does NOT do is detect polarity.</b> A ★4 review that is plainly a
 * complaint, on a product whose library is full of unrelated documents, produces no request — the
 * product cannot tell it from a ★4 compliment, and the two previous packages measured that wall from
 * both sides. Under-asking is the safe direction: a seller who wants to add knowledge has a button on
 * every knowledge screen, and a seller told they are missing a standard for 「좋아요」 learns to ignore
 * the message.
 *
 * <p>Pure: no I/O, no model, no seller-facing words.
 */
public enum ReviewKnowledgeNeed {

    /** Evidence applied. Nothing is missing. */
    GROUNDED,

    /**
     * Nothing was retrieved, and nothing suggests an answer was owed.
     *
     * <p>The draft is the seller's own template and it is a complete reply. The screen says what it
     * used; it does not ask for anything.
     */
    NO_EVIDENCE,

    /** Nothing was retrieved, and something says an answer was owed. Ask — once, specifically. */
    KNOWLEDGE_NEEDED;

    /** At or above this rating this product does not read a review as a complaint. */
    public static final int PRAISE_MIN_RATING = 4;

    /**
     * @param grounded       whether any current passage reached the drafter
     * @param hasProduct     whether this review resolves to a product knowledge could be registered on
     * @param productOutcome the product lane's own verdict — {@code ABSENT} means the library is empty
     * @param rating         the review's star rating, or null when the source carried none
     * @param boundToIssue   whether this review is recorded evidence for a repeated problem
     * @param asksSomething  whether the customer put a question to the seller ({@link QuestionShape})
     */
    public static ReviewKnowledgeNeed of(boolean grounded, boolean hasProduct,
                                         RetrievalOutcome productOutcome, Integer rating,
                                         boolean boundToIssue, boolean asksSomething) {
        if (grounded) {
            return GROUNDED;
        }
        if (!hasProduct) {
            // Nothing to register knowledge ON. Binding the review to a product is a different fix,
            // and asking for a standard here would point at a form that cannot be opened.
            return NO_EVIDENCE;
        }
        boolean owed = productOutcome == RetrievalOutcome.ABSENT
                || asksSomething
                || boundToIssue
                || (rating != null && rating < PRAISE_MIN_RATING);
        return owed ? KNOWLEDGE_NEEDED : NO_EVIDENCE;
    }

    /** Whether the screen should ask the seller for anything. */
    public boolean asks() {
        return this == KNOWLEDGE_NEEDED;
    }
}
