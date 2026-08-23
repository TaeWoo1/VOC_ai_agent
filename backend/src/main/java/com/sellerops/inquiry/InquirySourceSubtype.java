package com.sellerops.inquiry;

/**
 * 문의가 어느 출처 리소스에서 왔는지 — 닫힌 어휘.
 *
 * <p>한 채널이 문의를 한 종류만 주지는 않는다. NAVER 커머스 API는 <b>상품 문의</b>
 * ({@code GET /v1/contents/qnas} — 스마트스토어 리스팅에 달린 Q&A)와 <b>고객 문의</b>
 * ({@code GET /v1/pay-user/inquiries} — 네이버페이 주문에 달린 문의)를 서로 다른 리소스로 준다.
 * 식별자 공간이 다르고({@code questionId} vs {@code inquiryNo}), 매달린 대상이 다르고
 * (리스팅 vs 주문), 실패도 따로 난다.
 *
 * <p><b>두 종류를 한 문의 화면에 같이 보여줄 수는 있지만 source semantics를 잃어서는 안 된다.</b>
 * 잃으면 다시 만들 수 없다 — 재수집이 자기 행을 못 찾고, 커버리지 진술이 "네이버 문의 N건"이라는
 * 합쳐진 숫자밖에 못 말하고, 한 리소스의 403이 다른 리소스의 침묵과 구별되지 않는다.
 *
 * <p>{@code null}은 정직한 값이다: 출처를 한 종류만 갖는 경로(파일 업로드, ESM, Cafe24 게시판,
 * Coupang)는 subtype을 주장하지 않는다. 소급해서 채워 넣지 않는다.
 */
public final class InquirySourceSubtype {

    /** NAVER 상품 문의 (스마트스토어 Q&A) — {@code GET /v1/contents/qnas}, 식별자 {@code questionId}. */
    public static final String NAVER_PRODUCT_QNA = "NAVER_PRODUCT_QNA";

    /** NAVER 고객 문의 (네이버페이) — {@code GET /v1/pay-user/inquiries}, 식별자 {@code inquiryNo}. */
    public static final String NAVER_CUSTOMER_INQUIRY = "NAVER_CUSTOMER_INQUIRY";

    private InquirySourceSubtype() {
    }
}
