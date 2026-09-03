package com.sellerops.knowledge;

/**
 * A refusal-only opinion on whether a passage the scorer admitted actually answers the question.
 *
 * <p><b>The same shape as {@link KnowledgeTopic}, and for the same reason.</b> Similarity says a
 * passage is ABOUT the question's subject; it cannot say the passage contains the fact the answer
 * needs. 「물에 닿아도 되나요?」 and 「부착 전 표면의 유분을 제거하세요」 are about the same product and
 * the same surface, and one does not answer the other. That distinction has no threshold — the
 * closeness is real — so it is asked as a separate question, after ranking, and the answer can only
 * ever remove a passage.
 *
 * <p><b>Unknown means keep.</b> A judge that could not be reached, was not configured, or was handed
 * more passages than it will look at leaves the result exactly as the scorer left it. Absence is
 * never manufactured by a failure.
 */
public interface KnowledgeEligibility {

    /** Whether this passage carries a fact the seller could answer with. Unknown ⇒ true. */
    boolean supports(String quotable);
}
