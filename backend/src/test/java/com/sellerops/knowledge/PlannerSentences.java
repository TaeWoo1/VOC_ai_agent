package com.sellerops.knowledge;

/**
 * The sentences the live planner actually wrote about the return document 「교환 및 반품 안내」
 * (2026-08-30, runs `I`, `I2`, `I-before`) — the fixture Retrieval Query Selection v1 pins: the
 * seller's noun finds the document, and each of these must find the same one.
 */
public final class PlannerSentences {

    private PlannerSentences() {
    }

    public static final String[] ABOUT_THE_RETURN_DOCUMENT = {
        "‘QA 전선몰딩’의 상품 설명/FAQ/정책 문서 중 반품(교환·반품·환불) 조건이 명시된 문장이 있는가",
        "‘QA 전선몰딩’ 상품의 판매자 작성 문서(상품 설명·FAQ·정책) 중 반품 조건이 명시돼 있는지 확인",
        "‘QA 전선몰딩’에 대해 판매자가 작성한 상품 설명/FAQ/안내문에 반품 조건(가능/불가 기준, 기간, 상태 요건, 비용 부담 등)이 "
                + "명시돼 있는가? 해당 문구의 위치와 핵심 내용을 확인한다.",
    };
}
