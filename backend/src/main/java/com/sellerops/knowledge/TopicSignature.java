package com.sellerops.knowledge;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;

/**
 * What a customer's question was ABOUT, in a form that is safe to keep for years.
 *
 * <p><b>The problem this solves.</b> Answer memory has to be findable by topic — "이 질문에 예전에
 * 뭐라고 답했지" — and the obvious key is the customer's question. It must not be. The question is
 * where the name, the address, the phone number and the order number are, and a long-lived index
 * keyed on it is a copy of exactly the data that should expire with the inquiry.
 *
 * <p><b>The fence, and why it holds.</b> A token survives into the signature only if the SELLER's own
 * writing already contains it — their operating policies and their product notes. A buyer's name is
 * not in the shipping policy. Their street is not in the return policy. Their order number is not
 * anywhere, and any token carrying a digit is dropped before the check runs regardless. What is left
 * is vocabulary the seller published about their own business, which is the only vocabulary this
 * needs: the signature exists to match a question to a policy, and a word absent from every policy
 * can match none of them.
 *
 * <p><b>An empty signature is a correct answer.</b> A seller who has written nothing has no
 * vocabulary, so nothing passes, and the memory row falls back to its deterministic category. That is
 * the honest outcome — it is not a reason to loosen the fence, because the loosest version of this
 * function is "store the question", which is the thing being avoided.
 *
 * <p>Deterministic and pure: the same question and the same corpus give the same signature, so a
 * memory row's key does not drift when it is recomputed.
 */
public final class TopicSignature {

    /**
     * How many words a signature keeps.
     *
     * <p>A cap rather than a filter. Twelve content words is more than any real question carries once
     * grammar is removed, and it bounds what a pathological input — a forwarded mail thread — can
     * write into one row.
     */
    public static final int MAX_TOKENS = 12;

    private TopicSignature() {
    }

    /**
     * The topic words of {@code question} that the seller's own writing also uses.
     *
     * @param question      the customer's question, raw. Never stored; only read here.
     * @param sellerCorpus  the seller's own writing, {@link KnowledgeText#normalize}d and
     *                      concatenated — org policies and product notes. Empty is allowed and
     *                      yields an empty signature.
     * @return space-joined tokens in the order the question used them, or "" when none qualify
     */
    public static String of(String question, String sellerCorpus) {
        if (question == null || question.isBlank() || sellerCorpus == null || sellerCorpus.isBlank()) {
            return "";
        }
        List<String> kept = new ArrayList<>();
        for (String word : new LinkedHashSet<>(QueryWords.content(question))) {
            if (kept.size() >= MAX_TOKENS) {
                break;
            }
            if (carriesDigit(word)) {
                // Order numbers, phone numbers, amounts, dates. Dropped before the corpus check
                // rather than after it, so a corpus that happens to quote a number cannot admit one.
                continue;
            }
            String normalized = KnowledgeText.normalize(word);
            // Prefix matching, the same rule retrieval uses: the seller wrote 배송비 and the customer
            // asked 배송비가, and those are one word. A word the corpus does not have at all scores
            // 0 and is dropped, which is the fence.
            if (normalized.length() >= 2 && KnowledgeText.prefixMatch(normalized, sellerCorpus) >= 2) {
                kept.add(normalized);
            }
        }
        return String.join(" ", kept);
    }

    private static boolean carriesDigit(String word) {
        for (int i = 0; i < word.length(); i++) {
            if (Character.isDigit(word.charAt(i))) {
                return true;
            }
        }
        return false;
    }
}
