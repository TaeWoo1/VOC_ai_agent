package com.sellerops.knowledge.org;

/**
 * What kind of operating rule the seller wrote down — a closed set, because a citation has to say
 * what it is citing.
 *
 * <p><b>Chosen from a real backlog, not from a taxonomy.</b> The Demo Org's 69 REAL unanswered Cafe24
 * inquiries are 세금계산서 25 · 현금영수증 17 · 배송 21 · 취소 3 · 교환/반품 2. Every value here
 * except {@link #OTHER} is a topic that backlog actually asks about; a set invented before looking
 * would have had "브랜드 스토리" and no {@link #TAX_INVOICE}, and the one document that could have
 * closed a quarter of the queue would have had nowhere to go.
 *
 * <p><b>The seller never types these names.</b> They are a storage vocabulary; the screen shows
 * {@link #labelKo()}. A seller writing their return policy should not have to choose between
 * {@code EXCHANGE_REFUND_POLICY} and {@code CANCELLATION_POLICY} in English.
 */
public enum OrgKnowledgeType {

    /** 배송 기간, 배송비, 지역·도서산간, 택배사. */
    SHIPPING_POLICY("배송"),

    /** 주문 취소를 언제 어떻게 받는가. */
    CANCELLATION_POLICY("주문 취소"),

    /** 교환 · 반품 · 환불 조건과 절차. */
    EXCHANGE_REFUND_POLICY("교환 · 반품 · 환불"),

    /** 결제 수단, 입금 확인, 부분 결제. */
    PAYMENT_POLICY("결제"),

    /** 세금계산서 발행 조건과 절차. */
    TAX_INVOICE("세금계산서"),

    /** 현금영수증 발급 조건과 절차. */
    CASH_RECEIPT("현금영수증"),

    /** 위 어디에도 속하지 않는 공통 CS 안내. */
    GENERAL_CS_FAQ("공통 안내"),

    /** 판매자가 분류를 고르지 않았거나, 아직 이름이 없는 정책. */
    OTHER("기타");

    private final String labelKo;

    OrgKnowledgeType(String labelKo) {
        this.labelKo = labelKo;
    }

    /** The seller-facing name. The only form that reaches a screen. */
    public String labelKo() {
        return labelKo;
    }
}
