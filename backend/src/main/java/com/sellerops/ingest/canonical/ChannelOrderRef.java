package com.sellerops.ingest.canonical;

/**
 * "이 문의가 가리키는 주문은 <b>source가 말해 준 식별자로만</b> 정한다" 는 선언.
 *
 * <p><b>{@link ChannelProductRef} 와 같은 모양인 것이 요점이다.</b> 상품 귀속에서 이미 배운 것을
 * 주문에 다시 적용한다 — ref가 선언되면 ingest는 채널이 준 식별자로만 묶고, 없으면 <b>묶지 않는다</b>.
 * 본문에서 숫자를 뽑지 않고, 이름·날짜·금액으로 후보를 고르지 않으며, 후보가 하나뿐이라고 해서
 * 자동 선택하지 않는다. "1234번 주문 문의드립니다" 의 1234는 전화번호일 수도, 상품 코드일 수도,
 * 작년 주문일 수도 있다.
 *
 * <p><b>두 개의 식별자를 함께 싣는다.</b> 채널은 결제 단위(NAVER {@code orderId}, Cafe24
 * {@code order_id})와 상품주문 단위(NAVER {@code productOrderIdList})를 다르게 부르고,
 * {@code channel_orders} 는 상품주문 단위를 {@code external_order_id}, 결제 단위를
 * {@code parent_order_id} 로 이미 나눠 저장한다. 둘을 한 문자열로 합치면 어느 쪽 열에 붙여야 하는지
 * 나중에 다시 추측해야 한다.
 *
 * <p><b>고객 식별자는 여기 오지 않는다.</b> NAVER 고객 문의는 {@code customerId}/{@code customerName}
 * 을 필수로 돌려주지만 이 타입에는 그 자리가 없다 — 주문 참조는 "어느 주문인가" 이고 "누구인가" 가
 * 아니며, 이 둘을 한 record에 담는 순간 그 구분은 규칙이 아니라 관습이 된다.
 */
public record ChannelOrderRef(String orderId, String productOrderId) {

    /** 결제 단위 주문 식별자만 있는 source (Cafe24 board article). */
    public static ChannelOrderRef of(String orderId) {
        return of(orderId, null);
    }

    /**
     * 채널이 준 식별자들. null/공백은 "식별자 없음" 으로 정규화된다.
     *
     * <p>{@code productOrderId} 는 <b>단수</b>다. NAVER의 {@code productOrderIdList} 처럼 쉼표로 묶인
     * 값은 호출부가 분해하며, 문의 하나가 여러 상품주문을 가리키면 그 문의는 <b>결제 단위로만</b>
     * 묶인다 — 여러 개 중 하나를 골라 "이 주문" 이라고 말하는 것이 바로 이 타입이 막으려는 추측이다.
     */
    public static ChannelOrderRef of(String orderId, String productOrderId) {
        return new ChannelOrderRef(blankToNull(orderId), blankToNull(productOrderId));
    }

    /** 이 source는 식별자로 묶는데, 이 행에는 식별자가 없다. */
    public static ChannelOrderRef absent() {
        return new ChannelOrderRef(null, null);
    }

    public boolean hasIdentifier() {
        return orderId != null || productOrderId != null;
    }

    /**
     * 저장되는 한 개의 참조 문자열 — 상품주문 단위가 있으면 그것, 없으면 결제 단위.
     *
     * <p>좁은 쪽을 먼저 쓴다. 상품주문 식별자는 {@code channel_orders} 의 고유 키와 정확히 일치하고,
     * 결제 단위 식별자는 여러 행을 가리킬 수 있다. 좁은 것이 있는데 넓은 것을 저장하면 정확 일치가
     * 가능한 문의를 스스로 모호하게 만든다.
     */
    public String preferredRef() {
        return productOrderId != null ? productOrderId : orderId;
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value;
    }
}
