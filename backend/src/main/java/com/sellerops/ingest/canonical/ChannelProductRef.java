package com.sellerops.ingest.canonical;

/**
 * "이 행의 상품은 채널이 준 식별자로만 정한다" 는 선언.
 *
 * <p><b>있다는 것 자체가 규칙이다.</b> {@link CanonicalInquiry#productRef()} 가 null이 아니면
 * ingest는 {@code channel_products (channel_id, external_product_id)} 정확 일치로만 상품을 찾고,
 * 찾지 못하면 <b>귀속하지 않는다</b>. 이름으로 다시 시도하지 않고, placeholder 상품을 만들지 않는다.
 * {@link #externalProductId()} 가 null인 ref는 모순이 아니라 정확히 필요한 값이다 — "이 source는
 * 식별자로 귀속하는데, 이 행에는 식별자가 없다" 는 말이며, 그 답은 무귀속이다.
 *
 * <p><b>왜 별도 타입인가.</b> 문자열 하나를 더 놓았다면 규칙은 "값이 있으면 식별자로" 가 되고,
 * 식별자가 빠진 행은 조용히 이름 경로로 떨어져 상품을 만들어 냈을 것이다 — NAVER 고객 문의는
 * {@code productNo} 가 선택 필드이므로 그 행이 실제로 존재한다. 규칙을 source가 선언하게 만들면
 * 그 낙하가 불가능해진다.
 *
 * <p>이름 매칭은 여기서 일어나지 않는다. 동명이인 상품이 canonical Demo Org에 실제로 있고,
 * 이름은 판매자가 언제든 바꾸는 값이다.
 */
public record ChannelProductRef(String externalProductId) {

    /** 채널이 준 식별자. null/공백이면 "식별자 없음" 으로 정규화된다. */
    public static ChannelProductRef of(String externalProductId) {
        return new ChannelProductRef(
                externalProductId == null || externalProductId.isBlank() ? null : externalProductId);
    }

    /** 이 source는 식별자로 귀속하는데 이 행에는 식별자가 없다. */
    public static ChannelProductRef absent() {
        return new ChannelProductRef(null);
    }

    public boolean hasIdentifier() {
        return externalProductId != null;
    }
}
