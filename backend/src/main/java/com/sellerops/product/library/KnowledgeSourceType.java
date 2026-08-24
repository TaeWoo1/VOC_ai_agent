package com.sellerops.product.library;

/**
 * What kind of thing the seller wrote — a closed set, because provenance has to be reportable.
 *
 * <p>An answer that quotes this library must be able to say WHAT it is quoting: a policy sentence and
 * a usage instruction are both true, and a customer reading one as the other is a support incident.
 * Free-text type labels would make that sentence unwritable within a release.
 *
 * <p>{@link #LINK} is a citation, not a fetch. SellerOps does not go and read the URL — automatic
 * acquisition is an approved-checkpoint action, not a side effect of saving a note — so a LINK row
 * carries the address the seller wrote down plus whatever text they pasted with it.
 */
public enum KnowledgeSourceType {

    /** 상품 설명 · 상세페이지 문장. */
    DESCRIPTION,

    /** 자주 묻는 질문과 그 답. */
    FAQ,

    /** 사용법 · 설치 · 관리 방법. */
    USAGE,

    /** 교환 · 반품 · 배송 · A/S 정책. */
    POLICY,

    /** 원문 주소를 적어 둔 것. 자동으로 가져오지 않는다. */
    LINK
}
