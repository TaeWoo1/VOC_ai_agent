package com.sellerops.inquiry.draft;

import com.sellerops.inquiry.goal.CustomerGoal;
import com.sellerops.inquiry.goal.CustomerGoalSet;
import com.sellerops.knowledge.KnowledgeTopic;
import com.sellerops.knowledge.RetrievalQuery;
import java.util.List;

/**
 * <b>The noun a seller is asked to write down — and where it is allowed to come from.</b>
 *
 * <p>When a question cannot be answered from the seller's own knowledge, one word of that question is
 * quoted back to them: 「'가닥' 관련 내용이 없습니다」. That word is the whole sentence's claim about what
 * is missing, so it has to be a thing the customer ASKED ABOUT.
 *
 * <p><b>The defect this closes</b> (Full MVP E2E stage 2, 2026-09-23). A live Cafe24 post was titled
 * 「문의 드립니다」 and asked, in its body, about exchange deadlines. The subject was taken from the whole
 * of title + body and came back <b>「드립니다」</b> — a word the customer wrote, and one their goals are
 * not about. The seller would have been asked to write down 「'드립니다' 관련 내용」.
 *
 * <p><b>Two rules, both general.</b>
 * <ol>
 *   <li><b>Grounded in the request.</b> When this inquiry has an interpreted goal set, the subject is
 *   read from the goals' own evidence — the customer's sentences the interpreter selected AS the
 *   request — and not from the rest of the post. Greetings, signatures and a courtesy title are
 *   customer-written and are not what was asked.</li>
 *   <li><b>A noun, not a predicate.</b> Whatever the source text, the subject is a noun
 *   ({@link RetrievalQuery#subjectNouns}): what the customer DID (문의 드립니다 · 부담하나요) can never
 *   name what the seller is missing.</li>
 * </ol>
 *
 * <p>No word list is added for either rule, and no word is special-cased. The 규격 classifier's own word
 * still wins when it named one, because that word is already chosen from the customer's question and
 * is what the existing screens say.
 */
final class GapSubject {

    private GapSubject() {
    }

    /**
     * The subject to ask about, or null when the question named nothing askable.
     *
     * @param goals this inquiry's interpreted goals, or null when nothing read the message — then the
     *              question itself is the only evidence there is, and it is used as before
     */
    static String of(SpecApplicability.Verdict verdict, String title, String details, String productName,
                     KnowledgeTopic asked, CustomerGoalSet goals) {
        if (verdict != null && verdict.topicWord() != null && !verdict.topicWord().isBlank()) {
            return verdict.topicWord();
        }
        String requested = requestedText(goals);
        String source = requested.isBlank()
                ? ((title == null ? "" : title) + " " + (details == null ? "" : details)).strip()
                : requested;
        List<String> nouns = RetrievalQuery.subjectNouns(source, productName);
        return nouns.isEmpty() ? (asked == null ? null : asked.labelKo()) : nouns.get(0);
    }

    /** The customer's own sentences, as the goal interpreter selected them: the request and its quote. */
    private static String requestedText(CustomerGoalSet goals) {
        if (goals == null || goals.goals().isEmpty()) {
            return "";
        }
        StringBuilder out = new StringBuilder();
        for (CustomerGoal goal : goals.goals()) {
            append(out, goal.explicitRequest());
            append(out, goal.evidence());
        }
        return out.toString().strip();
    }

    private static void append(StringBuilder out, String text) {
        if (text != null && !text.isBlank()) {
            out.append(text).append(' ');
        }
    }
}
