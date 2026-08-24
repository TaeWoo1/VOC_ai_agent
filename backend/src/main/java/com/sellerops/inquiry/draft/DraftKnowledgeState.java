package com.sellerops.inquiry.draft;

/**
 * What the product-knowledge library could offer this draft — the closed vocabulary behind the one
 * sentence the seller reads above a generated reply.
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

    /** At least one passage was retrieved and put in front of the drafter. */
    GROUNDED;

    /** The sentence shown above the draft. States the limitation, never apologises for it. */
    public String messageKo() {
        return switch (this) {
            case NO_PRODUCT -> "이 문의는 아직 상품과 연결되지 않아, 상품 지식을 근거로 쓰지 못했습니다.";
            case NO_LIBRARY -> "이 상품에 등록된 상품 지식이 없어, 문의 내용만 보고 쓴 초안입니다.";
            case NO_MATCH -> "등록된 상품 지식에 이 질문에 해당하는 내용이 없어, 문의 내용만 보고 쓴 초안입니다.";
            case GROUNDED -> "판매자가 등록한 상품 지식을 근거로 썼습니다.";
        };
    }

    /** Whether the draft's factual claims have a source behind them. */
    public boolean grounded() {
        return this == GROUNDED;
    }
}
