package com.sellerops.review.draft;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * <b>A public reply may promise only what the seller's own text already promises.</b>
 * (Grounded Review Drafting v1, 2026-09-03)
 *
 * <p>The prompt asks for this. This checks it — the same relationship {@code AnswerStyleInstruction}
 * has with the org's forbidden phrases, and for the same reason: asking politely is not a control. A
 * review reply is public and irreversible, and the sentence that does the damage is never a wrong
 * specification. It is 「교환 도와드리겠습니다」 written for a seller who never agreed to an exchange.
 *
 * <p><b>What it looks for is a COMMITMENT, not a topic.</b> The seven classes the product refuses to
 * invent (cause, usage, delivery timing, exchange/refund, compensation, re-shipment, internal action)
 * are not all detectable in text, and pretending otherwise would be the sentiment heuristic
 * {@code RuleBasedReviewReplyProvider} refuses to grow. Five of them share one observable shape: a
 * named remedy. Those five are checked here by their nouns, and the check is deliberately narrow —
 * it can miss an invented cause and it will never call a plain thank-you a promise.
 *
 * <p><b>The test is not "did the model use a forbidden word".</b> It is «did the model promise
 * something the evidence does not mention». A seller whose exchange policy is in front of the
 * drafter may absolutely have an exchange written into the reply — that is the whole point of
 * grounding. So a term is a violation only when it appears in the draft and appears in NONE of the
 * passages the drafter was shown.
 *
 * <p><b>The response is refusal, never editing.</b> Deleting 「교환」 out of a sentence leaves a reply
 * whose meaning nobody chose; keeping it makes the rule a preference. The caller falls back to the
 * seller's own template, which promises nothing by construction.
 *
 * <p>Pure: no I/O, no model, no state.
 */
public final class ReviewClaimGuard {

    /**
     * The remedies a reply may not offer unprompted, by the nouns a Korean seller writes them with.
     *
     * <p>Stems rather than full words: 「환불」 catches 환불해, 환불을, 환불 드리 — Korean attaches
     * particles and verb endings to the noun, and a whole-word list would miss every real sentence.
     * Short and reviewable on purpose; a longer list is a classifier by another name.
     */
    static final List<String> COMMITMENT_TERMS = List.of(
            "환불", "반품", "교환", "재발송", "재배송", "보상", "배상", "할인", "쿠폰", "적립금", "회수");

    private ReviewClaimGuard() {
    }

    /**
     * Which commitment terms the draft makes that the evidence does not support.
     *
     * @param body     the generated reply
     * @param evidence the passage texts the drafter was actually shown — the ONLY thing that can
     *                 authorize a commitment. An empty list means nothing may be promised at all.
     * @return the unsupported terms, in the order they are declared; empty when the draft is clean
     */
    public static List<String> unsupportedClaims(String body, List<String> evidence) {
        if (body == null || body.isBlank()) {
            return List.of();
        }
        String draft = normalize(body);
        String grounds = evidence == null ? "" : normalize(String.join(" ", evidence));
        List<String> found = new ArrayList<>();
        for (String term : COMMITMENT_TERMS) {
            if (draft.contains(term) && !grounds.contains(term)) {
                found.add(term);
            }
        }
        return List.copyOf(found);
    }

    /** Whitespace collapsed and lower-cased, so spacing between a noun and its particle cannot hide it. */
    private static String normalize(String text) {
        return text.replaceAll("\\s+", "").toLowerCase(Locale.ROOT);
    }
}
