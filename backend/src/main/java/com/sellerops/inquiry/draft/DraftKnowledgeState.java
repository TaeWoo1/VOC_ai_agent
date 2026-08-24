package com.sellerops.inquiry.draft;

import com.sellerops.knowledge.KnowledgeScope;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * What the product-knowledge library could offer this draft — the closed vocabulary behind the one
 * sentence the seller reads above a generated reply.
 *
 * <p><b>Three lanes now, one vocabulary.</b> {@link #GROUNDED} means at least one passage of ANY
 * scope reached the drafter — the product's notes, the company's operating policy, or an answer the
 * seller actually gave. The other three still describe the PRODUCT lane, because that is the lane
 * whose absence a seller can act on: bind a product, write its knowledge, or accept that this
 * question is not about a product at all. An inquiry with no product can be fully grounded in policy,
 * and reporting {@code NO_PRODUCT} for it would call a grounded draft ungrounded.
 *
 * <p>The four values are four different things to do about it, which is why they are not one boolean.
 * {@link #NO_PRODUCT} is a data problem in the queue (the Cafe24 backlog is largely 미지정 상품);
 * {@link #NO_LIBRARY} is an invitation to write something; {@link #NO_MATCH} says the library exists
 * and does not cover this question; {@link #GROUNDED} is the only one where the draft's factual
 * claims have a source. Collapsing them would let "we know nothing about this product" and "we know
 * things, none of them about this" read the same to the person about to send the reply.
 *
 * <p>None of them is a licence to invent. A draft on the first three states is written from the
 * question alone and says so.
 */
public enum DraftKnowledgeState {

    /** The inquiry does not resolve to a canonical product, so there is nothing to retrieve from. */
    NO_PRODUCT,

    /** A product resolved, and no knowledge document has been written for it. */
    NO_LIBRARY,

    /** Documents exist for the product; none of them answers this question. */
    NO_MATCH,

    /** At least one passage — of any scope — was retrieved and put in front of the drafter. */
    GROUNDED;

    /** The sentence shown above the draft. States the limitation, never apologises for it. */
    public String messageKo() {
        return switch (this) {
            case NO_PRODUCT -> "이 문의는 상품과 연결되지 않았고, 운영 정책·과거 답변에도 해당 내용이 없어 "
                    + "문의 내용만 보고 쓴 초안입니다.";
            case NO_LIBRARY -> "이 상품에 등록된 지식이 없고, 운영 정책·과거 답변에도 해당 내용이 없어 "
                    + "문의 내용만 보고 쓴 초안입니다.";
            case NO_MATCH -> "상품 지식·운영 정책·과거 답변 어디에도 이 질문에 해당하는 내용이 없어, "
                    + "문의 내용만 보고 쓴 초안입니다.";
            case GROUNDED -> "판매자가 등록한 근거를 사용해 썼습니다.";
        };
    }

    /**
     * The sentence shown above the draft, naming the evidence that was actually used.
     *
     * <p>Named rather than counted: "상품 정보와 운영 정책을 근거로 썼습니다" tells the seller where to
     * go if the reply is wrong, and "근거 2건" does not. The scopes come from the passages that
     * reached the drafter, so this sentence cannot claim a source the draft never saw.
     */
    public String messageKo(Set<KnowledgeScope> scopes) {
        if (this != GROUNDED || scopes == null || scopes.isEmpty()) {
            return messageKo();
        }
        String named = scopes.stream().map(KnowledgeScope::labelKo).collect(Collectors.joining("·"));
        return "판매자가 등록한 " + named + objectParticle(named) + " 근거로 썼습니다.";
    }

    /**
     * 을/를, chosen by whether the last syllable has a final consonant.
     *
     * <p>Written out rather than rendered as "을(를)". A seller reads this sentence every time a
     * draft appears, and a product that writes Korean with the alternatives in brackets reads like a
     * form letter — which is the opposite of what this sentence is for.
     */
    private static String objectParticle(String word) {
        if (word.isEmpty()) {
            return "를";
        }
        char last = word.charAt(word.length() - 1);
        if (last < 0xAC00 || last > 0xD7A3) {
            return "를";
        }
        return (last - 0xAC00) % 28 == 0 ? "를" : "을";
    }

    /** Whether the draft's factual claims have a source behind them. */
    public boolean grounded() {
        return this == GROUNDED;
    }
}
