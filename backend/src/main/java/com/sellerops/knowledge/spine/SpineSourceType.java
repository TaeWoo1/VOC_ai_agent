package com.sellerops.knowledge.spine;

/**
 * <b>Which raw source an entry was read from</b> — a closed set, one value per kind of row the seller's
 * operation already leaves behind. Nothing here is a new store: each value names a table another package owns
 * and writes, and the spine only reads it.
 *
 * <p>The authority each type carries is decided by its adapter, not declared here, because one table can hold
 * two authorities: a product note the seller typed is confirmed product knowledge, and a manual the seller
 * uploaded into the same table is a manual.
 */
public enum SpineSourceType {

    /** {@code org_knowledge_sources} — 판매자가 쓰거나 올린 회사 운영 기준. */
    ORG_KNOWLEDGE,

    /** {@code product_knowledge_sources}, 판매자가 직접 입력한 상품 지식. */
    PRODUCT_KNOWLEDGE,

    /** {@code product_knowledge_sources}, 판매자가 올린 상품 자료(설명서 등). */
    PRODUCT_DOCUMENT,

    /** {@code product_knowledge_sources}, 판매자의 채널 상세페이지에서 읽은 글. */
    PRODUCT_DETAIL_PAGE,

    /** {@code product_facts} — 채널이 밝힌 상품 속성(규격·원산지·설명). */
    PRODUCT_FACT,

    /** {@code answer_memory} — 판매자가 실제로 보냈거나 승인한 문의 답변. */
    INQUIRY_ANSWER,

    /** {@code review_reply_approval} + {@code review_reply_draft} — 판매자가 승인한 리뷰 답글. */
    REVIEW_REPLY,

    /** {@code review_triage} — 판매자가 리뷰 하나에 내린 처리 판단. */
    REVIEW_DECISION,

    /** {@code review_triage_corrections} — 판매자가 시스템의 리뷰 판단을 고친 기록. */
    TRIAGE_CORRECTION,

    /** {@code seller_guidance} — 판매자가 초안·추천을 고치며 「다음에도 참고」로 남긴 지침. */
    SELLER_GUIDANCE
}
