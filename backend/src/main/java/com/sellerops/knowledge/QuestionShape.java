package com.sellerops.knowledge;

/**
 * Whether a piece of customer writing ASKS something.
 *
 * <p><b>Grammar, not topic.</b> This says nothing about what a sentence is about and cannot be used
 * to route, rank or classify one — it answers the single question «did this person put a question to
 * the seller», which is a property of the sentence's shape. The words it reads are the interrogative
 * subset of the closed list {@link QueryWords} has carried since 2026-08-24; nothing is added to that
 * list here, it is partitioned. Adding a topic word to this class would make it the keyword taxonomy
 * it exists to avoid being.
 *
 * <p><b>Why a review needs it.</b> A review's rating is a proxy for «does answering this need facts
 * the seller alone has», and it is the wrong proxy for one common case: a five-star review that also
 * asks 「물에 닿아도 되나요?」. The customer is owed an answer and the stars say the opposite.
 */
public final class QuestionShape {

    private QuestionShape() {
    }

    /**
     * Whether this text asks something.
     *
     * <p>Deliberately conservative in one direction: it under-reports rather than over-reports, so a
     * plain compliment is never read as a demand for a company standard.
     */
    public static boolean asks(String text) {
        if (text == null || text.isBlank()) {
            return false;
        }
        if (text.indexOf('?') >= 0 || text.indexOf('？') >= 0) {
            return true;
        }
        for (String word : QueryWords.split(text)) {
            if (QueryWords.isInterrogative(word)) {
                return true;
            }
        }
        return false;
    }
}
