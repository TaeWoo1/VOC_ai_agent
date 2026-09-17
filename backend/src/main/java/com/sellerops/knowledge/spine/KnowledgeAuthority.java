package com.sellerops.knowledge.spine;

/**
 * <b>Who stands behind a piece of company knowledge, in the order a conflict is settled.</b>
 *
 * <p>The order is the product-owner's (Customer Operations Manager Demo v1 · Q1 Knowledge Spine, 2026-09-18):
 * the seller's current written policy, then product knowledge the seller confirmed, then the seller's recent
 * decisions, then the product's detail page / manual, then what the seller once answered, then anything compiled
 * from those, then an outside reference. {@link #rank()} is that order and nothing else — lower wins.
 *
 * <p><b>Authority is not relevance.</b> A shipping policy does not answer a question about 두께 because it
 * outranks the product's spec sheet. The spine ranks by whether an entry covers the question first, and only
 * among entries that do does authority decide which one speaks for the company.
 *
 * <p><b>Two values have no producer, on purpose.</b> {@link #COMPILED_KNOWLEDGE} is the authority of a derived
 * view as a whole — every claim in it keeps the authority of the raw source it came from, so compiling never
 * promotes anything. {@link #EXTERNAL_REFERENCE} is declared so that a future web or platform reference has a
 * place BELOW everything the seller wrote; nothing in Q1 writes one, and {@code KnowledgeSpineTest} proves it.
 */
public enum KnowledgeAuthority {

    /** 판매자가 지금 명시해 둔 운영 기준 — 배송·교환·세금계산서 같은 회사 전체 정책. */
    SELLER_POLICY(1, "판매자 운영 기준"),

    /** 판매자가 직접 입력해 확정한 상품 지식. */
    SELLER_CONFIRMED_PRODUCT_KNOWLEDGE(2, "판매자가 확정한 상품 지식"),

    /** 판매자가 최근에 내린 판단 — 리뷰 처리 판단, 시스템 판단 정정. */
    RECENT_SELLER_DECISION(3, "판매자 판단"),

    /** 지금의 상품 상세페이지·채널 상품 정보·판매자가 올린 설명서. */
    PRODUCT_DETAIL(4, "상품 상세 · 설명서"),

    /** 판매자가 과거에 실제로 보낸 문의 답변·리뷰 답글. 그때의 말이지 지금의 사실이 아니다. */
    PAST_SELLER_ANSWER(5, "과거 판매자 답변"),

    /** 위의 원천들로부터 정리한 파생 보기. 원천보다 높아질 수 없다. */
    COMPILED_KNOWLEDGE(6, "정리된 지식"),

    /** 외부 참고 자료. Q1에서는 생산자가 없다. */
    EXTERNAL_REFERENCE(7, "외부 참고");

    private final int rank;
    private final String labelKo;

    KnowledgeAuthority(int rank, String labelKo) {
        this.rank = rank;
        this.labelKo = labelKo;
    }

    /** Lower wins a conflict. Compared, never shown. */
    public int rank() {
        return rank;
    }

    public String labelKo() {
        return labelKo;
    }
}
