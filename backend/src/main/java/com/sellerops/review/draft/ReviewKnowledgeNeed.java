package com.sellerops.review.draft;

import com.sellerops.knowledge.QuestionShape;

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
 *   <li><b>This review is recorded evidence for a repeated problem.</b> The issue extractor decided
 *       that; it is on the reviews screen; it means the customer described something that keeps
 *       happening.</li>
 *   <li><b>The rating is below the praise threshold.</b> The same threshold the template selection has
 *       used since it was written — at ★4+ this product does not read a review as a complaint, and
 *       {@code RuleBasedReviewReplyProvider} explains at length why a topic keyword must not overturn
 *       that.</li>
 * </ol>
 *
 * <p><b>An empty library is not one of them, and measurement is why</b> (Pilot QA, 2026-09-06). This
 * used to ask on ANY review of a product with no knowledge registered — «worth saying once, whatever
 * the review says». On the live org that fired on 「항상 만족하며 잘 사용하고있어요」, a ★5 compliment,
 * and put it in 확인 필요 as a missing operating standard: half of the seller's highest-intent inbox
 * was noise. The clause was defended as protecting ★4 「괜찮긴한데 잘떨어지네요」 — a complaint the rating
 * cannot see — and the live rows say it does not: that review sits on a product with ten registered
 * documents, so its outcome is never {@code ABSENT} and this clause never reached it. What the clause
 * did reach was <b>2,747</b> ★4+ reviews on knowledge-less products with no issue binding.
 *
 * <p>So whether an answer was owed is decided by the three signals that are ABOUT the review, and an
 * empty library changes nothing about that. The cost is named rather than hidden: a ★4 complaint that
 * no issue caught, on a product with no library, now asks for nothing — exactly as the identical
 * review on a product WITH a library already did. Asking or not asking must not depend on a fact
 * about the library.
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
     * @param rating         the review's star rating, or null when the source carried none
     * @param boundToIssue   whether this review is recorded evidence for a repeated problem
     * @param asksSomething  whether the customer put a question to the seller ({@link QuestionShape})
     */
    public static ReviewKnowledgeNeed of(boolean grounded, boolean hasProduct, Integer rating,
                                         boolean boundToIssue, boolean asksSomething) {
        if (grounded) {
            return GROUNDED;
        }
        if (!hasProduct) {
            // Nothing to register knowledge ON. Binding the review to a product is a different fix,
            // and asking for a standard here would point at a form that cannot be opened.
            return NO_EVIDENCE;
        }
        // Three signals, and every one of them is about THIS review: the customer asked something, the
        // issue extractor recorded it as evidence, or the rating is below the praise threshold. The
        // state of the library is not a fourth — it says nothing about whether an answer was owed.
        boolean owed = asksSomething
                || boundToIssue
                || (rating != null && rating < PRAISE_MIN_RATING);
        return owed ? KNOWLEDGE_NEEDED : NO_EVIDENCE;
    }

    /** Whether the screen should ask the seller for anything. */
    public boolean asks() {
        return this == KNOWLEDGE_NEEDED;
    }
}
