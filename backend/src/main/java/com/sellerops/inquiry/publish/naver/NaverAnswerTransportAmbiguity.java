package com.sellerops.inquiry.publish.naver;

/**
 * The answer request left and nothing came back.
 *
 * <p>Its own type because the publish core must treat it as {@code DELIVERY_UNKNOWN} and verify —
 * never as a failure to retry. A second answer to a real customer is not a retry; it is a second
 * answer, and on 상품 문의 it is worse than that: {@code PUT /v1/contents/qnas/{questionId}} is an
 * UPSERT, so a blind retry silently overwrites whatever is there.
 */
public class NaverAnswerTransportAmbiguity extends RuntimeException {

    public NaverAnswerTransportAmbiguity() {
        super("네이버 답변 등록 응답을 확인하지 못했습니다.");
    }
}
